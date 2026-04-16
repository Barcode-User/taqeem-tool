import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getReportById, updateReport } from "@workspace/db";
import {
  createSession,
  closeSession,
  addLog,
  type AutomationSession,
} from "./session-manager";
import { createIsolatedAutomationContext } from "./taqeem-session-store";
import type { Page } from "playwright";

const TAQEEM_URL = "https://qima.taqeem.gov.sa";
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export type AutomationOptions = { headless?: boolean };

// ─────────────────────────────────────────────────────────────────────────────
// واجهة عامة — بدء الأتمتة
// ─────────────────────────────────────────────────────────────────────────────
export async function startAutomation(
  reportId: number,
  options: AutomationOptions = {},
): Promise<string> {
  // ── إنشاء سياق معزول خاص بهذه العملية فقط ──────────────────────────────
  // لا يتداخل مع أي جلسة مستخدم أو عملية أتمتة أخرى
  const isolated = await createIsolatedAutomationContext();
  if (!isolated) {
    throw new Error("لا توجد جلسة مسجّلة. يرجى تسجيل الدخول أولاً من صفحة الإعدادات.");
  }

  const { context, cleanup } = isolated;
  const sessionId = randomUUID();
  const page = await context.newPage();
  const session = createSession(sessionId, reportId, null as any, context, page);

  await updateReport(reportId, {
    automationStatus: "running",
    automationError: null,
    automationSessionId: sessionId,
  });

  // شغّل الأتمتة وأغلق السياق المعزول عند الانتهاء (نجاح أو فشل)
  runAutomation(session, reportId)
    .catch(async (err) => {
      addLog(session, `Fatal error: ${err.message}`);
      await updateReport(reportId, { automationStatus: "failed", automationError: err.message });
      closeSession(sessionId);
    })
    .finally(async () => {
      // إغلاق السياق المعزول — لا يؤثر على الجلسة الرئيسية أو أي مستخدم آخر
      await cleanup();
    });

  return sessionId;
}

// ─────────────────────────────────────────────────────────────────────────────
// المنسّق الرئيسي — يمر على صفحة تلو الأخرى
// ─────────────────────────────────────────────────────────────────────────────
async function runAutomation(session: AutomationSession, reportId: number): Promise<void> {
  const { page } = session;

  try {
    const report = await getReportById(reportId);
    if (!report) throw new Error(`التقرير ${reportId} غير موجود`);

    addLog(session, "بدء عملية الرفع الآلي...");

    // ── تتبع كل تغييرات URL تلقائياً ──────────────────────────────────────
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        addLog(session, `🔀 URL → ${frame.url()}`);
      }
    });

    // ════════════════════════════════════════════════════════════════════════
    // تحضير الجلسة: مسح أي حالة Angular متبقية من جلسات سابقة
    // ════════════════════════════════════════════════════════════════════════
    addLog(session, "🧹 تنظيف جلسة TAQEEM من بيانات التقارير السابقة...");

    // ① انتقل للصفحة الرئيسية أولاً لإعادة ضبط Angular router
    await page.goto(`${TAQEEM_URL}/`, { waitUntil: "domcontentloaded", timeout: 20000 })
      .catch(() => {}); // تجاهل الفشل — الهدف تحديد السياق فقط
    await page.waitForTimeout(1000);

    // ② امسح localStorage/sessionStorage الخاصة بـ TAQEEM
    await page.evaluate(() => {
      try {
        // احذف مفاتيح النماذج المؤقتة التي قد يخزنها Angular
        const keysToRemove: string[] = [];
        for (let i = 0; i < localStorage.length; i++) {
          const k = localStorage.key(i) ?? "";
          if (k.includes("report") || k.includes("draft") || k.includes("form") ||
              k.includes("asset") || k.includes("attribute")) {
            keysToRemove.push(k);
          }
        }
        keysToRemove.forEach(k => localStorage.removeItem(k));

        // امسح sessionStorage بالكامل (أكثر أماناً)
        sessionStorage.clear();
      } catch { /* تجاهل إذا منعت CORS */ }
    }).catch(() => {});
    addLog(session, "✅ تم مسح بيانات الجلسة السابقة");

    // ════════════════════════════════════════════════════════════════════════
    // الصفحة 1: /report/create/1/13
    // البيانات الأساسية للتقرير
    // ════════════════════════════════════════════════════════════════════════
    addLog(session, "═══════════════════════════════════════");
    addLog(session, "▶ الصفحة 1: البيانات الأساسية للتقرير");
    addLog(session, "═══════════════════════════════════════");

    await page.goto(`${TAQEEM_URL}/report/create/1/13`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    await page.waitForTimeout(2000);

    if (page.url().includes("/login") || page.url().includes("sso.taqeem")) {
      throw new Error("انتهت الجلسة — يرجى تسجيل الدخول مجدداً من صفحة الإعدادات.");
    }

    // ── تحقق: إذا أعاد التوجيه لتقرير موجود بدلاً من نموذج جديد ──────────
    const landedUrl = page.url();
    const isOnCreate = landedUrl.includes("/report/create/");
    const redirectedToExisting = !isOnCreate && landedUrl.includes("/report/");

    if (redirectedToExisting) {
      // TAQEEM أعاد التوجيه لتقرير موجود — هذا هو التداخل!
      const existingId = landedUrl.match(/\/report\/(\d+)/)?.[1] ?? "مجهول";
      addLog(session, `⚠️ TAQEEM أعاد التوجيه لتقرير موجود [ID: ${existingId}] بدل نموذج جديد!`);
      addLog(session, `⚠️ URL: ${landedUrl}`);
      addLog(session, `🔄 إعادة المحاولة: التنقل المباشر لنموذج إنشاء جديد...`);

      // انتظر قليلاً ثم أعد المحاولة
      await page.waitForTimeout(2000);
      await page.goto(`${TAQEEM_URL}/report/create/1/13`, {
        waitUntil: "networkidle",
        timeout: 30000,
      });
      await page.waitForTimeout(2000);

      if (!page.url().includes("/report/create/")) {
        throw new Error(
          `TAQEEM يُعيد التوجيه دائماً لتقرير موجود [${landedUrl}] — ` +
          `يُرجى إغلاق التقرير المفتوح على منصة TAQEEM يدوياً أو إنهاء التقرير المعلّق.`
        );
      }
    }

    addLog(session, `✅ الصفحة 1 جاهزة (نموذج جديد): ${page.url()}`);

    // ── تحقق: هل الحقل الأول فارغ؟ (ضمان عدم وجود بيانات سابقة) ──────────
    const titlePreFilled = await page.$eval(
      '[name="title"]',
      (el: HTMLInputElement) => el.value?.trim() ?? "",
    ).catch(() => "");
    if (titlePreFilled) {
      addLog(session, `⚠️ النموذج يحتوي بيانات مسبقة في حقل العنوان: "${titlePreFilled.slice(0, 40)}"`);
      addLog(session, `🧹 مسح بيانات النموذج المسبقة...`);
      // امسح جميع حقول النص
      await page.evaluate(() => {
        document.querySelectorAll<HTMLInputElement>("input[type='text'], input:not([type]), textarea")
          .forEach(el => { el.value = ""; el.dispatchEvent(new Event("input", { bubbles: true })); });
      });
      await page.waitForTimeout(500);
    } else {
      addLog(session, "✅ النموذج فارغ — لا يوجد تداخل مع تقارير سابقة");
    }

    const pdfState = { pdfUploaded: false };
    const elsPage1 = await scanElements(page);
    await saveDebug(reportId, "page1", elsPage1);
    await screenshot(page, `p1_before_${reportId}`);
    addLog(session, `📋 عدد حقول الصفحة 1: ${elsPage1.length}`);

    await fillFormPage(session, report, elsPage1, pdfState);
    // انتظر قصير لتستقر Angular form validation قبل الحفظ
    await page.waitForTimeout(600);

    // ── إعادة محاولة رفع PDF ──────────────────────────────────────────────
    if (!pdfState.pdfUploaded) {
      addLog(session, "🔄 إعادة محاولة رفع PDF...");
      for (let r = 1; r <= 3 && !pdfState.pdfUploaded; r++) {
        await page.waitForTimeout(1000);
        await uploadPdf(session, report, pdfState);
      }
    }

    await screenshot(page, `p1_after_${reportId}`);

    // ── ضغط زر "continue" للانتقال للصفحة 2 ──────────────────────────────
    const urlBeforePage2 = page.url();
    await clickContinueButton(session);

    // ── انتظار الانتقال لـ /report/asset/create/{id} ─────────────────────
    addLog(session, "⏳ انتظار الانتقال لصفحة الأصل...");
    await page
      .waitForURL(`${TAQEEM_URL}/report/asset/create/**`, { timeout: 30000 })
      .catch(async () => {
        // fallback: انتظر أي تغيير في URL
        await page.waitForFunction(
          (prev: string) => window.location.href !== prev,
          urlBeforePage2,
          { timeout: 30000 },
        ).catch(() => {});
      });

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    // ── استخراج رقم التقرير من URL الصفحة 2 والتحقق منه ─────────────────
    const page2Url = page.url();
    addLog(session, `🔗 URL الصفحة 2: ${page2Url}`);

    // نمط: /report/asset/create/1694177
    const taqeemIdMatch = page2Url.match(/\/report\/(?:asset\/)?create\/(\d+)/);
    if (!taqeemIdMatch) {
      addLog(session, `⚠️ URL غير متوقع: ${page2Url}`);
      addLog(session, "⚠️ قد يكون هناك خطأ في التحقق بالصفحة 1 — تحقق من الحقول المطلوبة");
      throw new Error(`لم يُعثر على رقم التقرير في URL: ${page2Url}`);
    }
    const taqeemReportId = taqeemIdMatch[1];
    addLog(session, `🆔 رقم التقرير في TAQEEM: ${taqeemReportId}  ← سيُستخدم في كل الخطوات`);

    // ── حفظ رقم التقرير في قاعدة البيانات فوراً ──────────────────────────
    await updateReport(reportId, { taqeemReportNumber: taqeemReportId });
    addLog(session, `💾 تم حفظ taqeemReportId=${taqeemReportId} في قاعدة البيانات`);

    // ── التأكد من أننا على صفحة الأصل الصحيحة ────────────────────────────
    const expectedPage2 = `${TAQEEM_URL}/report/asset/create/${taqeemReportId}`;
    if (!page2Url.includes(`/report/asset/create/${taqeemReportId}`)) {
      addLog(session, `↩️ التنقل المباشر لصفحة الأصل: ${expectedPage2}`);
      await page.goto(expectedPage2, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1500);
    }
    addLog(session, `✅ تأكيد URL الصفحة 2: ${page.url()}`);

    // ════════════════════════════════════════════════════════════════════════
    // الصفحة 2: /report/asset/create/{taqeemReportId}
    // بيانات الأصل والموقع
    // ════════════════════════════════════════════════════════════════════════
    addLog(session, "═══════════════════════════════════════════════");
    addLog(session, `▶ الصفحة 2 [ID: ${taqeemReportId}]: بيانات الأصل والموقع`);
    addLog(session, "═══════════════════════════════════════════════");

    const elsPage2 = await scanElements(page);
    await saveDebug(reportId, "page2", elsPage2);
    await screenshot(page, `p2_before_${reportId}`);
    addLog(session, `📋 عدد حقول الصفحة 2: ${elsPage2.length}`);

    await fillAssetPage(session, report, elsPage2);
    // انتظر قصير لتستقر Angular form validation قبل الحفظ
    await page.waitForTimeout(600);
    await screenshot(page, `p2_after_${reportId}`);

    // ── ضغط زر "continue" — حفظ الصفحة 2 ──────────────────────────────────
    const urlBeforeSave = page.url();
    await clickContinueButton(session);

    // ── انتظار أي انتقال بعد الحفظ (TAQEEM قد يُعيد رقماً جديداً للأصل) ──
    addLog(session, "⏳ انتظار الانتقال بعد حفظ الصفحة 2...");
    await page.waitForFunction(
      (prev: string) => window.location.href !== prev,
      urlBeforeSave,
      { timeout: 30000 },
    ).catch(() => addLog(session, "⚠️ URL لم يتغير بعد 30 ثانية"));

    await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1200);

    const afterSavePage2Url = page.url();
    addLog(session, `🔗 URL بعد حفظ الصفحة 2: ${afterSavePage2Url}`);

    // ── استخرج الـ ID الصحيح من URL الانتقال ──────────────────────────────
    // المسارات المتوقعة من TAQEEM:
    //   /report/asset/{assetId}/edit         ← رقم الأصل الجديد
    //   /report/attribute/create/{assetId}   ← انتقل مباشرة للصفحة 3
    //   /report/asset/create/{reportId}      ← لم يتغير (خطأ في التحقق)
    let assetId: string = taqeemReportId; // احتياط: استخدم الـ ID الأصلي

    const assetEditMatch = afterSavePage2Url.match(/\/report\/asset\/(\d+)\/edit/);
    const attrCreateMatch = afterSavePage2Url.match(/\/report\/attribute\/create\/(\d+)/);
    const anyIdMatch = afterSavePage2Url.match(/\/(\d+)(?:\/|$)/);

    if (assetEditMatch) {
      assetId = assetEditMatch[1];
      addLog(session, `🆔 رقم الأصل الجديد (asset/edit): ${assetId}`);
    } else if (attrCreateMatch) {
      assetId = attrCreateMatch[1];
      addLog(session, `🆔 انتقل مباشرة لصفحة السمات — ID: ${assetId}`);
    } else if (anyIdMatch && anyIdMatch[1] !== taqeemReportId) {
      assetId = anyIdMatch[1];
      addLog(session, `🆔 رقم مختلف في URL: ${assetId} (بدلاً من ${taqeemReportId})`);
    } else {
      addLog(session, `ℹ️ لم يتغير الـ ID — يُستخدم: ${taqeemReportId}`);
    }

    // ── رابط الصفحة 3 بالـ ID الصحيح ────────────────────────────────────
    const expectedPage3 = `${TAQEEM_URL}/report/attribute/create/${assetId}`;
    addLog(session, `🔗 الصفحة 3 المتوقعة: ${expectedPage3}`);

    // إذا لم نكن على صفحة attribute/create بعد → انتقل إليها
    if (!afterSavePage2Url.includes("/report/attribute/create/")) {
      addLog(session, "↩️ الانتقال المباشر لصفحة السمات...");
      await page.goto(expectedPage3, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);
    }
    addLog(session, `✅ تأكيد URL الصفحة 3 [assetId: ${assetId}]: ${page.url()}`);

    // ════════════════════════════════════════════════════════════════════════
    // الصفحة 3: /report/attribute/create/{assetId}
    // البيانات الإضافية وسمات الأصل
    // ════════════════════════════════════════════════════════════════════════
    addLog(session, "═══════════════════════════════════════════════");
    addLog(session, `▶ الصفحة 3 [assetId: ${assetId}]: السمات والبيانات الإضافية`);
    addLog(session, "═══════════════════════════════════════════════");

    // ── تحقق أننا فعلاً على صفحة 3 قبل البدء ──────────────────────────────
    const p3CurrentUrl = page.url();
    if (!p3CurrentUrl.includes("/report/attribute/create/")) {
      addLog(session, `⚠️ URL غير متوقع قبل تعبئة الصفحة 3: ${p3CurrentUrl}`);
      addLog(session, "↩️ محاولة الانتقال المباشر لصفحة 3...");
      await page.goto(expectedPage3, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(2000);
    }
    addLog(session, `✅ URL الصفحة 3 مؤكد: ${page.url()}`);

    const elsPage3 = await scanElements(page);
    await saveDebug(reportId, "page3", elsPage3);
    await screenshot(page, `p3_before_${reportId}`);
    addLog(session, `📋 عدد حقول الصفحة 3: ${elsPage3.length}`);

    // ── تعبئة الصفحة 3 مع حماية من الانتقال المفاجئ ────────────────────
    const urlAtStartP3 = page.url();
    try {
      await fillAttributePage(session, report, elsPage3);
    } catch (fillErr: any) {
      addLog(session, `⚠️ خطأ أثناء تعبئة الصفحة 3 (نتابع): ${fillErr.message}`);
    }

    // تحقق من أن الصفحة لم تنتقل أثناء التعبئة
    const urlAfterFillP3 = page.url();
    if (urlAfterFillP3 !== urlAtStartP3 && !urlAfterFillP3.includes("/report/attribute/create/")) {
      addLog(session, `⚠️ تغيّر URL أثناء تعبئة الصفحة 3: ${urlAfterFillP3}`);
      addLog(session, "↩️ إعادة الانتقال لصفحة 3...");
      await page.goto(expectedPage3, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForTimeout(1500);
    }

    // انتظر قصير لتستقر Angular form validation قبل الحفظ
    await page.waitForTimeout(800);
    await screenshot(page, `p3_after_${reportId}`);

    // ── ضغط زر "حفظ واستمرار" أولاً ثم "continue" كاحتياط ───────────────
    const urlBeforeSaveP3 = page.url();
    await clickSaveAndContinue(session);
    await page.waitForTimeout(1000);
    // إذا لم يتغير URL → جرب clickContinueButton أيضاً
    if (page.url() === urlBeforeSaveP3) {
      addLog(session, "ℹ️ URL لم يتغير بعد حفظ واستمرار — أجرب زر المتابعة");
      await clickContinueButton(session);
    }
    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(2000);

    await screenshot(page, `review_${reportId}`);
    const finalUrl = page.url();
    const finalIdMatch = finalUrl.match(/\/(\d+)(?:\/|$)/);
    const finalId = finalIdMatch ? finalIdMatch[1] : "غير معروف";
    addLog(session, `✅ الانتهاء — URL: ${finalUrl}`);
    addLog(session, `🆔 تأكيد التسلسل: TAQEEM ID = ${taqeemReportId} | ID في URL النهائي = ${finalId}`);
    addLog(session, "🔵 اكتمل الإدخال — راجع البيانات ثم أرسل التقرير يدوياً.");

    await updateReport(reportId, { automationStatus: "waiting_review", automationError: null });
    closeSession(session.sessionId);

  } catch (err: any) {
    addLog(session, `❌ خطأ: ${err.message}`);
    await updateReport(reportId, { automationStatus: "failed", automationError: err.message });
    try { await page.close(); } catch {}
    closeSession(session.sessionId);
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// أدوات مساعدة مشتركة
// ─────────────────────────────────────────────────────────────────────────────

async function waitForAngular(page: Page, extra = 2000): Promise<void> {
  await page.waitForTimeout(extra);
}

// ينتظر انتهاء الانتقال بين الصفحات
async function waitForPageTransition(
  page: Page,
  session: AutomationSession,
  prevUrl: string,
  label: string,
): Promise<void> {
  addLog(session, `⏳ انتظار الانتقال إلى ${label}...`);

  // انتظر تغيير الـ URL أولاً
  const transitioned = await page
    .waitForFunction(
      (prev: string) => window.location.href !== prev,
      prevUrl,
      { timeout: 20000 },
    )
    .then(() => true)
    .catch(() => false);

  if (!transitioned) {
    addLog(session, `⚠️ URL لم يتغير بعد 20 ثانية — نتابع على نفس الصفحة`);
  }

  // انتظر استقرار الشبكة
  await page
    .waitForLoadState("networkidle", { timeout: 15000 })
    .catch(() => {});

  // انتظر إضافي ليُكمل Angular تهيئة النموذج
  await page.waitForTimeout(2500);
  addLog(session, `✅ ${label} جاهزة: ${page.url()}`);
}

// استخراج رقم الخطوة من الـ URL
// مثال: /report/create/3/13  →  3
//        /report/edit/12345/4 →  4
function extractStepFromUrl(url: string): number | null {
  // نمط: /report/create/{step}/{typeId} — مثل /report/create/2/13
  const m1 = url.match(/\/report\/create\/(\d+)\/\d+/);
  if (m1) return parseInt(m1[1], 10);
  // نمط: /report/edit/{reportId}/{step}
  const m2 = url.match(/\/report\/edit\/\d+\/(\d+)/);
  if (m2) return parseInt(m2[1], 10);
  // نمط: /report/update/{step}/...
  const m3 = url.match(/\/report\/[a-z]+\/\d+\/(\d+)/);
  if (m3) return parseInt(m3[1], 10);
  return null;
}

// إذا تخطّى الـ wizard خطوة معينة، انتقل إليها مباشرة
async function ensureOnStep(
  page: Page,
  session: AutomationSession,
  expectedStep: number,
): Promise<boolean> {
  const currentUrl = page.url();
  const currentStep = extractStepFromUrl(currentUrl);

  addLog(session, `🔍 URL الحالي: ${currentUrl} | الخطوة المكتشفة: ${currentStep ?? "غير معروف"} | المتوقعة: ${expectedStep}`);

  if (currentStep === null || currentStep === expectedStep) {
    return true; // لا تدخل لازم
  }

  if (currentStep > expectedStep) {
    // الـ wizard تخطّى الخطوة — حاول الانتقال إليها مباشرة
    const targetUrl = currentUrl.replace(
      new RegExp(`(\/report\/(?:create|edit|update)\/)?(\\d+)(\/)(\\d+)`),
      (_, prefix, a, sep, b) => {
        // نعرّف أيّ الرقمين هو رقم الخطوة
        const aNum = parseInt(a, 10);
        const bNum = parseInt(b, 10);
        if (aNum === currentStep) {
          return `${prefix ?? ""}${expectedStep}${sep}${b}`;
        } else if (bNum === currentStep) {
          return `${prefix ?? ""}${a}${sep}${expectedStep}`;
        }
        return _;
      },
    );

    // أو: ابنِ URL مباشر باستبدال رقم الخطوة فقط
    const directUrl = currentUrl.replace(`/${currentStep}/`, `/${expectedStep}/`);
    addLog(session, `↩️ الـ wizard تخطّى الخطوة — أحاول الانتقال المباشر: ${directUrl}`);
    try {
      await page.goto(directUrl, { waitUntil: "networkidle", timeout: 20000 });
      await page.waitForTimeout(2000);
      const newStep = extractStepFromUrl(page.url());
      addLog(session, `🔗 بعد الانتقال: ${page.url()} | الخطوة: ${newStep}`);
      return newStep === expectedStep;
    } catch (e: any) {
      addLog(session, `⚠️ فشل الانتقال المباشر: ${e.message}`);
    }
  }
  return false;
}

async function scanElements(page: Page): Promise<any[]> {
  return page.evaluate(() => {
    const getLabelText = (el: Element): string => {
      // 1. label[for=id]
      const id = (el as HTMLElement).id;
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) return lbl.textContent?.trim() ?? "";
      }

      // 2. aria-label مباشرة
      const ariaLbl = (el as HTMLElement).getAttribute("aria-label");
      if (ariaLbl && ariaLbl.trim()) return ariaLbl.trim();

      // 3. aria-labelledby
      const labelledBy = (el as HTMLElement).getAttribute("aria-labelledby");
      if (labelledBy) {
        const parts = labelledBy.split(" ").map(id => document.getElementById(id)?.textContent?.trim() ?? "");
        const joined = parts.join(" ").trim();
        if (joined) return joined;
      }

      // 4. mat-label داخل mat-form-field الأب (حتى 10 مستويات)
      let parent: Element | null = el.parentElement;
      for (let i = 0; i < 10 && parent; i++) {
        // توقف عند mat-form-field
        if (parent.tagName === "MAT-FORM-FIELD" || parent.classList.contains("mat-form-field")) {
          const matLabel = parent.querySelector("mat-label, label, .mat-form-field-label");
          if (matLabel) {
            const t = matLabel.textContent?.trim() ?? "";
            if (t && t.length < 100) return t;
          }
        }
        // label عادي
        const lbl = parent.querySelector(":scope > label, :scope > mat-label");
        if (lbl) {
          const t = lbl.textContent?.trim() ?? "";
          if (t && t.length < 100) return t;
        }
        parent = parent.parentElement;
      }

      // 5. النص المباشر من الأب الأول الذي يحتوي نصاً
      let p: Element | null = el.parentElement;
      for (let i = 0; i < 5 && p; i++) {
        const directText = Array.from(p.childNodes)
          .filter(n => n.nodeType === Node.TEXT_NODE)
          .map(n => n.textContent?.trim() ?? "")
          .filter(t => t.length > 0)
          .join(" ").trim();
        if (directText && directText.length < 100) return directText;
        p = p.parentElement;
      }
      return "";
    };

    const result: any[] = [];

    // 1. عناصر HTML العادية: input, select, textarea
    document.querySelectorAll("input, select, textarea").forEach((el: any) => {
      const rect = el.getBoundingClientRect();
      // أظهر حقول الملفات حتى لو مخفية (لأغراض التشخيص)
      if (rect.width === 0 && rect.height === 0 && el.type !== "file") return;
      result.push({
        tag: el.tagName,
        type: el.type ?? "",
        name: el.name ?? "",
        id: el.id ?? "",
        placeholder: el.placeholder ?? "",
        formControlName: el.getAttribute("formcontrolname") ?? "",
        ariaLabel: el.getAttribute("aria-label") ?? "",
        value: el.value ?? "",
        labelText: getLabelText(el),
        isMat: false,
        y: Math.round(rect.y),
      });
    });

    // 2. Angular Material: mat-select (قائمة منسدلة مخصصة)
    document.querySelectorAll("mat-select").forEach((el: any) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;

      // حاول قراءة aria-labelledby
      let ariaLabel = el.getAttribute("aria-label") ?? "";
      const labelledBy = el.getAttribute("aria-labelledby");
      if (!ariaLabel && labelledBy) {
        ariaLabel = labelledBy.split(" ")
          .map((id: string) => document.getElementById(id)?.textContent?.trim() ?? "")
          .join(" ").trim();
      }

      result.push({
        tag: "MAT-SELECT",
        type: "select",
        name: el.getAttribute("name") ?? "",
        id: el.id ?? "",
        placeholder: el.getAttribute("placeholder") ?? "",
        formControlName: el.getAttribute("formcontrolname") ?? "",
        ariaLabel,
        value: el.querySelector(".mat-select-value-text, .mat-mdc-select-value-text, .mat-select-placeholder")?.textContent?.trim() ?? "",
        labelText: getLabelText(el),
        isMat: true,
        y: Math.round(rect.y),
      });
    });

    // 3. Angular Material: mat-checkbox
    document.querySelectorAll("mat-checkbox").forEach((el: any) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const input = el.querySelector("input[type='checkbox']") as HTMLInputElement | null;
      result.push({
        tag: "INPUT",
        type: "checkbox",
        name: el.getAttribute("name") ?? input?.getAttribute("name") ?? "",
        id: el.id ?? input?.id ?? "",
        placeholder: "",
        formControlName: el.getAttribute("formcontrolname") ?? "",
        ariaLabel: el.getAttribute("aria-label") ?? "",
        value: input?.checked ? "true" : "false",
        labelText: el.textContent?.trim().split("\n")[0] ?? getLabelText(el),
        isMat: false,
        isMatCheckbox: true,
        matCheckboxEl: true,
        y: Math.round(rect.y),
      });
    });

    // 4. Angular Material: mat-radio-button
    document.querySelectorAll("mat-radio-button, mat-radio-group").forEach((el: any) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      const input = el.querySelector("input[type='radio']") as HTMLInputElement | null;
      result.push({
        tag: "INPUT",
        type: "radio",
        name: el.getAttribute("name") ?? input?.getAttribute("name") ?? "",
        id: el.id ?? input?.id ?? "",
        placeholder: "",
        formControlName: el.getAttribute("formcontrolname") ?? el.parentElement?.getAttribute("formcontrolname") ?? "",
        ariaLabel: el.getAttribute("aria-label") ?? "",
        value: el.getAttribute("value") ?? "",
        labelText: el.textContent?.trim().split("\n")[0] ?? getLabelText(el),
        isMat: false,
        isMatRadio: true,
        y: Math.round(rect.y),
      });
    });

    return result.sort((a: any, b: any) => a.y - b.y);
  });
}

function buildSelector(el: any): string {
  const tag = el.isMat ? "mat-select" : el.tag?.toLowerCase() ?? "";
  if (el.formControlName) return `[formcontrolname="${el.formControlName}"]`;
  if (el.name && tag)     return `${tag}[name="${el.name}"]`;
  if (el.id)              return `#${el.id}`;
  if (el.placeholder)     return `[placeholder="${el.placeholder}"]`;
  return "";
}

async function saveDebug(reportId: number, tag: string, els: any[]): Promise<void> {
  const p = path.join(UPLOADS_DIR, `debug_${tag}_${reportId}_${Date.now()}.json`);
  fs.writeFileSync(p, JSON.stringify(els, null, 2));
}

async function screenshot(page: Page, name: string): Promise<void> {
  const p = path.join(UPLOADS_DIR, `${name}_${Date.now()}.png`);
  await page.screenshot({ path: p, fullPage: true }).catch(() => {});
}

// تحويل التاريخ إلى YYYY-MM-DD (المطلوب من حقول <input type="date"> في قيمة)
function formatDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  // الصيغة المثالية YYYY-MM-DD — لا تعديل
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // صيغة DD/MM/YYYY → YYYY-MM-DD
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) return `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  // صيغة MM/DD/YYYY → YYYY-MM-DD (احتياطي)
  const mdy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) return `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
  return s;
}

// ─── حقن قيمة مباشرة في حقل Angular بدون كتابة حرف بحرف ────────────────────
// يستخدم native property setter لضمان التوافق مع Angular reactive forms
async function setInputValue(page: Page, selector: string, val: string): Promise<boolean> {
  return page.evaluate(({ sel, v }: { sel: string; v: string }) => {
    const el = document.querySelector(sel) as HTMLInputElement | null;
    if (!el) return false;
    // استخدم native setter لإعلام Angular بالتغيير
    const nativeSetter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, "value"
    )?.set;
    if (nativeSetter) nativeSetter.call(el, v);
    else el.value = v;
    el.dispatchEvent(new Event("input",  { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("blur",   { bubbles: true }));
    return true;
  }, { sel: selector, v: val });
}

async function fillAngular(
  session: AutomationSession, selector: string,
  value: string | number | null | undefined, label: string,
): Promise<void> {
  if (value === null || value === undefined || String(value).trim() === "") {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }
  const val = String(value).trim();
  const { page } = session;
  try {
    await page.waitForSelector(selector, { timeout: 800 });

    // طريقة 1: page.click + page.fill — سريع وآمن مع Angular zone.js
    try {
      await page.click(selector, { timeout: 800 });
      await page.fill(selector, val, { timeout: 800 });
      await page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) return;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur",   { bubbles: true }));
      }, selector);
      addLog(session, `✅ ${label}: ${val}`);
      return;
    } catch { /* ننتقل للطريقة 2 */ }

    // طريقة 2: native setter — احتياطية
    const ok = await setInputValue(page, selector, val);
    if (ok) {
      addLog(session, `✅ ${label}: ${val} (js)`);
      return;
    }

    // طريقة 3: keyboard typing — آخر خيار
    await page.click(selector, { clickCount: 3 });
    await page.keyboard.press("Control+a");
    await page.keyboard.type(val, { delay: 0 });
    await page.keyboard.press("Tab");
    addLog(session, `✅ ${label}: ${val} (keyboard)`);
  } catch (err: any) {
    addLog(session, `⚠️ لم يُعبَّأ "${label}": ${(err as Error).message}`);
  }
}

// تعبئة حقل تاريخ — سريع بدون تأخير بالأحرف
async function fillDate(
  session: AutomationSession, selector: string,
  rawValue: string | null | undefined, label: string,
): Promise<void> {
  const formatted = formatDate(rawValue);
  if (!formatted) {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }
  const { page } = session;
  try {
    await page.waitForSelector(selector, { timeout: 800 });

    // طريقة 1: page.click + page.fill — سريع وآمن مع Angular zone.js
    try {
      await page.click(selector, { timeout: 800 });
      await page.fill(selector, formatted, { timeout: 800 });
      await page.evaluate((args: { sel: string; v: string }) => {
        const el = document.querySelector(args.sel) as HTMLInputElement | null;
        if (!el) return;
        const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
        if (setter) setter.call(el, args.v); else el.value = args.v;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur",   { bubbles: true }));
      }, { sel: selector, v: formatted });
      addLog(session, `✅ ${label}: ${formatted}`);
      return;
    } catch { /* ننتقل للطريقة 2 */ }

    // طريقة 2: native setter — احتياطية
    const ok = await setInputValue(page, selector, formatted);
    if (ok) {
      addLog(session, `✅ ${label}: ${formatted} (js)`);
      return;
    }

    // طريقة 3: keyboard typing — آخر خيار بلا delay
    await page.click(selector);
    await page.keyboard.press("Control+a");
    await page.keyboard.type(formatted, { delay: 0 });
    await page.keyboard.press("Escape");
    addLog(session, `✅ ${label}: ${formatted} (keyboard)`);
  } catch {
    addLog(session, `⚠️ لم يُعبَّأ تاريخ "${label}"`);
  }
}

// ─── تطبيع النص العربي الشامل ───────────────────────────────────────────────
// يحل مشكلة الياء الفارسية + الحركات + الحروف غير المرئية + التطويل
const NORM_INVISIBLE = /[\u200B-\u200F\u202A-\u202E\uFEFF\u200C\u200D]/g;
const NORM_TATWEEL   = /\u0640/g; // tatweel (ـ)
const NORM_DIACRIT   = /[\u0610-\u061A\u064B-\u065F\u0670\u06D6-\u06DC\u06DF-\u06E8\u06EA-\u06ED]/g;
const NORM_YA        = /[يىیے]/g;
const NORM_KAF       = /[كکڪ]/g;
const NORM_ALEF      = /[أإآٱ]/g;

function normalizeAr(s: string): string {
  return (s ?? "")
    .replace(NORM_INVISIBLE, "")
    .replace(NORM_TATWEEL, "")
    .replace(NORM_DIACRIT, "")
    .replace(NORM_ALEF, "ا")   // توحيد الهمزات
    .replace(NORM_YA, "ي")     // توحيد الياء
    .replace(NORM_KAF, "ك")    // توحيد الكاف
    .replace(/ة/g, "ه")        // تاء مربوطة
    .replace(/\s+/g, " ")
    .trim();
}

// دالة مطابقة عربية مرنة: نص + تجريد "ال" + مطابقة جزئية
function arMatches(a: string, b: string): boolean {
  const na = normalizeAr(a);
  const nb = normalizeAr(b);
  const sa = na.replace(/^ال/, "");
  const sb = nb.replace(/^ال/, "");
  return na === nb || na.includes(nb) || nb.includes(na)
    || sa === sb || sa.includes(sb) || sb.includes(sa);
}

// دالة تطبيع نص عربي داخل page.evaluate (مُعرَّفة كسلسلة نصية لحقنها في المتصفح)
const EVAL_NORM_FN = `
function _norm(s){
  return (s||'')
    .replace(/[\\u200B-\\u200F\\u202A-\\u202E\\uFEFF\\u200C\\u200D]/g,'')
    .replace(/\\u0640/g,'')
    .replace(/[\\u0610-\\u061A\\u064B-\\u065F\\u0670\\u06D6-\\u06DC\\u06DF-\\u06E8\\u06EA-\\u06ED]/g,'')
    .replace(/[\\u0623\\u0625\\u0622\\u0671]/g,'\\u0627')
    .replace(/[\\u064A\\u0649\\u06CC\\u06D2]/g,'\\u064A')
    .replace(/[\\u0643\\u06A9\\u06AA]/g,'\\u0643')
    .replace(/\\u0629/g,'\\u0647')
    .replace(/\\s+/g,' ').trim();
}
function _matches(a,b){
  var na=_norm(a), nb=_norm(b);
  var sa=na.replace(/^\\u0627\\u0644/,''), sb=nb.replace(/^\\u0627\\u0644/,'');
  return na===nb||na.includes(nb)||nb.includes(na)||sa===sb||sa.includes(sb)||sb.includes(sa);
}
`;

// اختيار من قائمة منسدلة — يدعم native select و mat-select
// fallback: خيار احتياطي يُختار إذا لم يُعثر على value الأصلية
async function selectAngular(
  session: AutomationSession, selector: string,
  value: string | null | undefined, label: string,
  isMat = false,
  fallback?: string,
): Promise<void> {
  if (!value || value.trim() === "") {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }
  const { page } = session;
  const normVal = normalizeAr(value);

  // ── محاولة 1: native HTML select ──────────────────────────────────────────
  if (!isMat) {
    try {
      await page.waitForSelector(selector, { timeout: 800 });
      const chosen = await page.selectOption(selector, { label: value }).catch(() =>
        page.selectOption(selector, { value }).catch(() => []),
      );
      if (Array.isArray(chosen) && chosen.length > 0) {
        await page.evaluate((sel) => {
          document.querySelector(sel)?.dispatchEvent(new Event("change", { bubbles: true }));
        }, selector);
        addLog(session, `✅ ${label}: ${value} (native select)`);
        return;
      }
    } catch { /* ننتقل لـ mat-select */ }
  }

  // ── محاولة 2: Angular Material mat-select — Playwright native click ────────
  try {
    await page.waitForSelector(selector, { timeout: 800 });
    await page.click(selector);
    await page.waitForSelector(
      "mat-option, .mat-option, .mat-mdc-option",
      { timeout: 3000 },
    );
    await page.waitForTimeout(200);

    // ابحث بمطابقة مرنة مع تطبيع شامل (داخل المتصفح)
    const optionText = await page.evaluate(
      new Function("nv", "fb", `
        ${EVAL_NORM_FN}
        var opts = Array.from(document.querySelectorAll('mat-option,.mat-option,.mat-mdc-option'));
        var t = opts.find(function(o){ return _matches(o.textContent||'', nv); });
        if(t) return {found:(t.textContent||'').trim(), usedFallback:false};
        if(fb){
          var ft = opts.find(function(o){ return _matches(o.textContent||'', fb); });
          if(ft) return {found:(ft.textContent||'').trim(), usedFallback:true};
        }
        return {found:null, usedFallback:false,
          available:opts.map(function(o){return (o.textContent||'').trim();}).filter(Boolean)};
      `) as (nv: string, fb: string) => {found:string|null, usedFallback:boolean, available?:string[]},
      normVal, fallback ? normalizeAr(fallback) : "",
    );

    if (optionText.found !== null) {
      const optLoc = page.locator("mat-option, .mat-option, .mat-mdc-option")
        .filter({ hasText: optionText.found });
      await optLoc.first().click({ timeout: 2000 });
      await page.waitForTimeout(300);
      if (optionText.usedFallback) {
        addLog(session, `⚠️ "${label}": "${value}" غير موجود — تم اختيار "${optionText.found}" كبديل`);
      } else {
        addLog(session, `✅ ${label}: ${optionText.found}`);
      }
      return;
    }

    const avail = (optionText.available ?? []).slice(0, 8).join(" | ");
    addLog(session, `⚠️ "${label}": "${value}" غير موجود — المتاح: ${avail}`);
    await page.keyboard.press("Escape");
  } catch (e: any) {
    addLog(session, `⚠️ لم يُحدَّد "${label}": ${value} — ${e.message}`);
  }
}

// تحديد checkbox
async function checkBox(
  session: AutomationSession, selector: string,
  checked: boolean, label: string,
): Promise<void> {
  const { page } = session;
  try {
    await page.waitForSelector(selector, { timeout: 2000 });
    const current = await page.$eval(selector, (el: any) => el.checked).catch(() => false);
    if (current !== checked) {
      await page.click(selector);
    }
    addLog(session, `✅ ${label}: ${checked ? "محدد" : "غير محدد"}`);
  } catch {
    addLog(session, `⚠️ لم يتم تحديد "${label}"`);
  }
}

// تحديد radio
async function selectRadio(
  session: AutomationSession, selector: string, label: string,
): Promise<void> {
  const { page } = session;
  try {
    await page.waitForSelector(selector, { timeout: 2000 });
    await page.check(selector);
    addLog(session, `✅ راديو "${label}" محدد`);
  } catch {
    addLog(session, `⚠️ لم يُحدَّد راديو "${label}"`);
  }
}

// ضغط زر "حفظ واستمرار" — مع إزالة disabled إجباراً إن لزم
async function clickSaveAndContinue(session: AutomationSession): Promise<void> {
  const { page } = session;
  addLog(session, "🖱️ ضغط «حفظ واستمرار»...");

  // ── محاولة 1: ابحث بالنص مع force click ──────────────────────────────────
  const textPatterns = ["حفظ واستمرار", "حفظ و استمرار", "Save & Continue", "حفظ", "Save"];
  for (const txt of textPatterns) {
    try {
      const loc = page.locator(`button:has-text("${txt}"), input[value*="${txt}"]`).first();
      if (await loc.count().catch(() => 0) > 0) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ force: true, timeout: 4000 });
        await page.waitForTimeout(500);
        addLog(session, `✅ تم الضغط: "${txt}" (force)`);
        return;
      }
    } catch { /* تابع */ }
  }

  // ── محاولة 2: إزالة disabled وإجبار النقر ─────────────────────────────────
  try {
    const result = await page.evaluate(() => {
      const keywords = ["حفظ", "save", "استمرار", "continue"];
      const btns = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        "button, input[type='submit'], input[type='button']"
      ));
      const target = btns.find(b => {
        const t = (b.textContent ?? (b as HTMLInputElement).value ?? "").toLowerCase().trim();
        return keywords.some(k => t.includes(k));
      }) ?? btns.find(b => (b as HTMLButtonElement).type === "submit") ?? btns[btns.length - 1];
      if (!target) return null;
      // أزل disabled
      target.removeAttribute("disabled");
      (target as HTMLButtonElement).disabled = false;
      const mat = target.closest("[mat-button],[mat-raised-button],[mat-flat-button]");
      if (mat) { (mat as HTMLElement).removeAttribute("disabled"); }
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      target.click();
      return target.textContent?.trim().slice(0, 30) ?? (target as HTMLInputElement).value ?? "?";
    });
    if (result) {
      await page.waitForTimeout(500);
      addLog(session, `✅ تم إجبار النقر: "${result}"`);
      return;
    }
  } catch { /* تابع */ }

  // ── محاولة 3: form submit event ───────────────────────────────────────────
  try {
    const ok = await page.evaluate(() => {
      const form = document.querySelector<HTMLFormElement>("form");
      if (!form) return false;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return true;
    });
    if (ok) {
      await page.waitForTimeout(500);
      addLog(session, "✅ تم إرسال النموذج (form submit)");
      return;
    }
  } catch { /* تجاهل */ }

  addLog(session, "⚠️ لم يُعثر على زر «حفظ واستمرار»");
}

// ─────────────────────────────────────────────────────────────────────────────
// ضغط زر "continue" تحديداً — input[name="continue"]
// ─────────────────────────────────────────────────────────────────────────────
async function clickContinueButton(session: AutomationSession): Promise<void> {
  const { page } = session;
  addLog(session, "🖱️ ضغط زر «المتابعة» (continue)...");

  // ── سجّل جميع أزرار الإرسال الموجودة في الصفحة ─────────────────────────
  const btnDebug = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
      "input[type='submit'], button[type='submit'], button",
    )).map(b => ({
      tag: b.tagName,
      name: (b as HTMLInputElement).name ?? "",
      value: (b as HTMLInputElement).value ?? "",
      text: b.textContent?.trim().slice(0, 40) ?? "",
      disabled: (b as HTMLInputElement).disabled,
    }))
  ).catch(() => []);
  btnDebug.forEach((b, i) =>
    addLog(session, `  [btn${i}] name="${b.name}" value="${b.value}" text="${b.text}" disabled=${b.disabled}`)
  );

  // ── الأولوية 1: input[name="continue"] مباشرة ────────────────────────────
  try {
    const btn = page.locator('input[name="continue"]').first();
    const exists = await btn.count().catch(() => 0);
    if (exists > 0) {
      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click({ force: true, timeout: 5000 });
      addLog(session, `✅ تم الضغط: input[name="continue"]`);
      return;
    }
    addLog(session, `  ↳ input[name="continue"] غير موجود في DOM`);
  } catch (e: any) {
    addLog(session, `  ↳ خطأ input[name="continue"]: ${e.message}`);
  }

  // ── الأولوية 2: button[name="continue"] ──────────────────────────────────
  try {
    const btn = page.locator('button[name="continue"]').first();
    if (await btn.count().catch(() => 0) > 0) {
      await btn.click({ force: true });
      addLog(session, `✅ تم الضغط: button[name="continue"]`);
      return;
    }
  } catch { /* تابع */ }

  // ── الأولوية 3: زر يحتوي نص "continue" / "استمرار" / "التالي" ──────────
  const txtPatterns = ["continue", "استمرار", "التالي", "next", "متابعة"];
  for (const txt of txtPatterns) {
    try {
      const loc = page.locator(`input[value*="${txt}" i], button:has-text("${txt}")`).first();
      if (await loc.count().catch(() => 0) > 0) {
        await loc.click({ force: true });
        addLog(session, `✅ تم الضغط: زر يحتوي "${txt}"`);
        return;
      }
    } catch { /* تابع */ }
  }

  // ── الأولوية 4: آخر زر submit في الصفحة (استثناء) ───────────────────────
  try {
    const clicked = await page.evaluate(() => {
      const all = Array.from(document.querySelectorAll<HTMLInputElement | HTMLButtonElement>(
        "input[type='submit'], button[type='submit']",
      ));
      const cont = all.find(b => ((b as HTMLInputElement).name ?? "").toLowerCase() === "continue");
      const target = cont ?? all[all.length - 1];
      if (target) { target.click(); return (target as HTMLInputElement).name ?? "?"; }
      return null;
    });
    if (clicked) {
      addLog(session, `✅ تم الضغط (آخر زر submit): name="${clicked}"`);
      return;
    }
  } catch { /* تابع */ }

  // ── الأولوية 5: إزالة disabled من زر Angular وإجبار النقر ────────────────
  // Angular يُعطّل الزر عند وجود أخطاء في النموذج — نتخطى ذلك
  addLog(session, "ℹ️ محاولة إزالة disabled وإجبار النقر...");
  try {
    const forcedResult = await page.evaluate(() => {
      const keywords = ["حفظ", "استمرار", "متابعة", "تالي", "save", "continue", "next", "submit"];

      // ابحث عن أي زر (حتى disabled) يطابق النصوص
      const allBtns = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        "button, input[type='submit'], input[type='button']"
      ));

      const target = allBtns.find(b => {
        const txt = (b.textContent ?? (b as HTMLInputElement).value ?? "").toLowerCase().trim();
        return keywords.some(k => txt.includes(k));
      }) ?? allBtns.find(b => (b as HTMLButtonElement).type === "submit")
        ?? allBtns[allBtns.length - 1];

      if (!target) return null;

      // أزل disabled
      target.removeAttribute("disabled");
      (target as HTMLButtonElement).disabled = false;

      // أزل disabled من Angular Material wrapper إن وجد
      const matBtn = target.closest("[mat-button],[mat-raised-button],[mat-flat-button]");
      if (matBtn) {
        (matBtn as HTMLElement).removeAttribute("disabled");
        (matBtn as HTMLElement).setAttribute("aria-disabled", "false");
      }

      // أطلق click events
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      target.click();

      return target.textContent?.trim().slice(0, 30) ?? (target as HTMLInputElement).value ?? "?";
    });

    if (forcedResult) {
      await page.waitForTimeout(800);
      addLog(session, `✅ تم إجبار النقر على: "${forcedResult}"`);
      return;
    }
  } catch (e: any) {
    addLog(session, `⚠️ فشل إجبار النقر: ${e.message}`);
  }

  // ── الأولوية 6: إرسال النموذج مباشرة عبر Angular form ────────────────────
  try {
    const submitted = await page.evaluate(() => {
      // ابحث عن Angular NgForm أو form عادي
      const form = document.querySelector<HTMLFormElement>("form");
      if (!form) return false;
      form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
      return true;
    });
    if (submitted) {
      await page.waitForTimeout(800);
      addLog(session, "✅ تم إرسال النموذج مباشرة (form submit event)");
      return;
    }
  } catch { /* تابع */ }

  // ── تشخيص: اعرض أخطاء التحقق إن وجدت ──────────────────────────────────
  const validationErrs = await page.evaluate(() => {
    const errs = Array.from(document.querySelectorAll(
      ".alert-danger, .text-danger, [class*='error'], mat-error, .invalid-feedback"
    ));
    return errs.map(e => e.textContent?.trim()).filter(Boolean).slice(0, 5);
  }).catch(() => [] as string[]);
  if (validationErrs.length > 0) {
    addLog(session, "⚠️ أخطاء تحقق في النموذج:");
    validationErrs.forEach(e => addLog(session, `   • ${e}`));
  }

  addLog(session, "⚠️ لم يُعثر على زر «المتابعة» — قد يحتاج تدخل يدوي");
}

// ─────────────────────────────────────────────────────────────────────────────
// تعبئة نموذج إنشاء التقرير — كل الحقول في صفحة واحدة
// الحقول المعروفة من السجل الفعلي:
//   title, purpose_id, value_premise_id, value_base_id, report_type (radio)
//   valued_at, submitted_at, assumptions, special_assumptions, value, currency_id
//   report_file, client[0][name], client[0][telephone], client[0][email]
//   has_user (checkbox), valuer[0][id], valuer[0][contribution]
// ─────────────────────────────────────────────────────────────────────────────
async function fillFormPage(
  session: AutomationSession,
  report: any,
  els: any[],
  pdfState: { pdfUploaded: boolean },
): Promise<void> {
  logElements(session, els, "نموذج التقرير");

  // helper: ملء حقل بـ name مباشرة
  const fillByName = (name: string, value: any, label: string) =>
    fillAngular(session, `[name="${name}"]`, value, label);

  const selectByName = (name: string, value: any, label: string) =>
    selectNativeByName(session, name, value, label);

  // ── عنوان التقرير ────────────────────────────────────────────────────────
  await fillByName("title", report.reportNumber, "عنوان التقرير");

  // ── الغرض من التقييم ─────────────────────────────────────────────────────
  await selectByName("purpose_id", report.valuationPurpose, "الغرض من التقييم");

  // ── فرضية القيمة ─────────────────────────────────────────────────────────
  await selectByName("value_premise_id", report.valuationHypothesis, "فرضية القيمة");

  // ── أساس القيمة ──────────────────────────────────────────────────────────
  await selectByName("value_base_id", report.valuationBasis, "أساس القيمة");

  // ── نوع التقرير (أزرار راديو) ────────────────────────────────────────────
  if (report.reportType) {
    const rt = String(report.reportType).trim();
    try {
      const clicked = await session.page.evaluate((rt: string) => {
        const radios = Array.from(
          document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="report_type"]'),
        );
        const target = radios.find(r => {
          const lbl = (r.closest("label")?.textContent ?? r.labels?.[0]?.textContent ?? "").trim();
          return lbl === rt || lbl.includes(rt) || rt.includes(lbl);
        }) ?? radios[0]; // fallback: التقرير المفصل
        if (target) { target.click(); return target.value || "ok"; }
        return null;
      }, rt);
      if (clicked) addLog(session, `✅ نوع التقرير: ${clicked}`);
    } catch { addLog(session, `⚠️ تعذّر تحديد نوع التقرير`); }
  }

  // ── تاريخ التقييم ─────────────────────────────────────────────────────────
  await fillDate(session, '[name="valued_at"]', report.valuationDate, "تاريخ التقييم");

  // ── تاريخ إصدار التقرير ───────────────────────────────────────────────────
  await fillDate(session, '[name="submitted_at"]', report.reportDate, "تاريخ إصدار التقرير");

  // ── الافتراضات ────────────────────────────────────────────────────────────
  if (report.assumptions) {
    await fillByName("assumptions", report.assumptions, "الافتراضات");
  }

  // ── الافتراضات الخاصة ────────────────────────────────────────────────────
  if (report.specialAssumptions) {
    await fillByName("special_assumptions", report.specialAssumptions, "الافتراضات الخاصة");
  }

  // ── الرأي النهائي في القيمة ───────────────────────────────────────────────
  await fillByName("value", report.finalValue, "الرأي النهائي في القيمة");

  // ── عملة التقييم (افتراضي: ريال سعودي) ──────────────────────────────────
  await selectByName("currency_id", report.currency ?? "ريال سعودي", "عملة التقييم");

  // ── اسم العميل ───────────────────────────────────────────────────────────
  await fillByName("client[0][name]", report.clientName, "اسم العميل");

  // ── رقم الهاتف ───────────────────────────────────────────────────────────
  await fillByName("client[0][telephone]", report.clientPhone, "رقم الهاتف");

  // ── البريد الإلكتروني ─────────────────────────────────────────────────────
  await fillByName("client[0][email]", report.clientEmail, "البريد الإلكتروني");

  // ── بيانات المقيمين ──────────────────────────────────────────────────────
  // دالة مساعدة: اختيار المقيم من الـ dropdown بـ رقم العضوية أو الاسم
  const selectValuerById = async (index: number, membershipNum: string | null | undefined, valuerName: string | null | undefined, label: string) => {
    const selName = `valuer[${index}][id]`;
    const sel = `[name="${selName}"]`;
    try {
      await session.page.waitForSelector(sel, { timeout: 5000 });
      // انتظر تحميل الخيارات من API
      await session.page.waitForFunction(
        (s: string) => { const el = document.querySelector<HTMLSelectElement>(s); return el ? el.options.length > 1 : false; },
        sel, { timeout: 8000 }
      ).catch(() => {});

      const searchTerm = membershipNum?.trim() || valuerName?.trim() || "";
      if (!searchTerm) { addLog(session, `⏭️ تخطي "${label}" — لا توجد بيانات`); return; }

      const matched = await session.page.evaluate((s: string, term: string) => {
        const el = document.querySelector<HTMLSelectElement>(s);
        if (!el) return null;
        // ابحث عن خيار يحتوي على رقم العضوية أو الاسم
        const opts = Array.from(el.options);
        let found = opts.find(o => o.text.includes(term) || o.value === term);
        if (!found && term.length > 4) {
          // بحث جزئي
          found = opts.find(o => o.text.replace(/\s/g, "").includes(term.replace(/\s/g, "")));
        }
        if (found) {
          el.value = found.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return found.text.trim();
        }
        return null;
      }, sel, searchTerm);

      if (matched) addLog(session, `✅ ${label}: ${matched}`);
      else addLog(session, `⚠️ ${label}: لم يُعثر على "${searchTerm}" — تحقق من رقم العضوية`);
    } catch (e) { addLog(session, `⚠️ ${label}: فشل الاختيار`); }
  };

  // دالة مساعدة: ضبط نسبة المساهمة
  const setContribution = async (index: number, pct: number | null | undefined) => {
    const pctStr = pct != null ? `${Math.round(pct)}%` : "100%";
    await selectByName(`valuer[${index}][contribution]`, pctStr, `نسبة المساهمة [${index}]`);
  };

  // ── المقيم الأول ──
  await selectValuerById(0, report.membershipNumber, report.valuerName, "المقيم الأول");
  await setContribution(0, report.valuerPercentage);

  // ── المقيم الثاني (إن وُجد) ──
  if (report.secondValuerMembershipNumber || report.secondValuerName) {
    try {
      // اضغط على زر "إضافة مقيم آخر"
      const clicked = await session.page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll<HTMLElement>("button, a"));
        const btn = btns.find(b => (b.textContent ?? "").includes("إضافة مقيم"));
        if (btn) { btn.click(); return true; }
        return false;
      });
      if (clicked) {
        addLog(session, "✅ ضغط زر إضافة مقيم آخر");
        await session.page.waitForTimeout(1500);
      } else {
        addLog(session, "⚠️ لم يُعثر على زر إضافة مقيم آخر");
      }
    } catch { addLog(session, "⚠️ فشل الضغط على زر إضافة مقيم آخر"); }

    await selectValuerById(1, report.secondValuerMembershipNumber, report.secondValuerName, "المقيم الثاني");
    await setContribution(1, report.secondValuerPercentage);
  }

  // ── رفع PDF ───────────────────────────────────────────────────────────────
  await uploadPdf(session, report, pdfState);
}

// تعبئة native select بالـ name مباشرة (بالنص أو بالقيمة)
// fallback: خيار احتياطي يُختار إذا لم تُوجد قيمة value
async function selectNativeByName(
  session: AutomationSession,
  name: string,
  value: string | null | undefined,
  label: string,
  fallback?: string,
): Promise<void> {
  if (!value || value.trim() === "") {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }

  const normVal  = normalizeAr(value);
  const normFb   = fallback ? normalizeAr(fallback) : "";
  const sel = `[name="${name}"]`;

  try {
    await session.page.waitForSelector(sel, { timeout: 5000 });

    // انتظار تحميل الخيارات من API (Angular يحمّلها بشكل غير متزامن)
    // نحتاج options.length > 1 حتى نختار — وإلا نختار من قائمة فارغة فيعود "اختر"
    await session.page.waitForFunction(
      (s: string) => {
        const el = document.querySelector<HTMLSelectElement>(s);
        return !!el && el.options.length > 1;
      },
      sel,
      { timeout: 10000 },
    ).catch(() => addLog(session, `⚠️ "${label}": الخيارات لم تُحمَّل — سأحاول على أي حال`));

    // محاولة 1: page.selectOption بالنص الأصلي ثم القيمة
    const chosen = await session.page
      .selectOption(sel, { label: value })
      .catch(() => session.page.selectOption(sel, { value }).catch(() => []));
    if (Array.isArray(chosen) && chosen.length > 0) {
      await session.page.evaluate((s: string) => {
        document.querySelector(s)?.dispatchEvent(new Event("change", { bubbles: true }));
      }, sel);
      addLog(session, `✅ ${label}: ${value}`);
      return;
    }

    // محاولة 2: مطابقة مرنة شاملة + fallback
    const result = await session.page.evaluate(
      new Function("args", `
        ${EVAL_NORM_FN}
        var el = document.querySelector(args.sel);
        if(!el) return {matched:null, usedFallback:false, available:[]};
        var opts = Array.from(el.options);
        var available = opts.map(function(o){return o.text.trim();}).filter(Boolean);

        var opt = opts.find(function(o){ return _matches(o.text, args.nv); });
        if(!opt && args.fb){
          opt = opts.find(function(o){ return _matches(o.text, args.fb); });
          if(opt){
            el.value = opt.value;
            el.dispatchEvent(new Event('change',{bubbles:true}));
            return {matched:opt.text, usedFallback:true, available:available};
          }
        }
        if(opt){
          el.value = opt.value;
          el.dispatchEvent(new Event('change',{bubbles:true}));
          return {matched:opt.text, usedFallback:false, available:available};
        }
        return {matched:null, usedFallback:false, available:available};
      `) as (args: {sel:string; nv:string; fb:string}) => {matched:string|null; usedFallback:boolean; available:string[]},
      { sel, nv: normVal, fb: normFb },
    );

    if (result.matched) {
      if (result.usedFallback) {
        addLog(session, `⚠️ "${label}": "${value}" غير موجود — تم اختيار "${result.matched}" كبديل`);
      } else {
        addLog(session, `✅ ${label}: ${result.matched} (من "${value}")`);
      }
    } else {
      addLog(session, `⚠️ "${label}": "${value}" غير موجود — المتاح: ${result.available.slice(0, 8).join(" | ")}`);
    }
  } catch (e: any) {
    addLog(session, `⚠️ لم يُحدَّد "${label}": ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 2: /report/asset/create/{id}
// ─────────────────────────────────────────────────────────────────────────────
// [Legacy helper - kept for reference only, not called]
async function fillOneApproach(
  session: AutomationSession,
  els: any[],
  statusNames: string[],         // أسماء محتملة لـ select الحالة
  statusLabelRx: RegExp,         // regex للبحث بالـ label إن لم يوجد name
  valueNames: string[],          // أسماء محتملة لـ input القيمة
  valueLabelRx: RegExp,
  approachValue: number | null | undefined,
  approachLabel: string,
): Promise<void> {
  const findEl2 = (names: string[], rx: RegExp) => {
    for (const n of names) {
      const el = els.find(e => e.name === n || e.formControlName === n);
      if (el) return el;
    }
    return findEl(els, rx);
  };

  const statusEl = findEl2(statusNames, statusLabelRx);
  const valueEl  = findEl2(valueNames,  valueLabelRx);

  const hasValue = approachValue != null && Number(approachValue) !== 0;
  const usage    = hasValue ? "مستخدم أساسي" : "غير مستخدم";

  if (statusEl) {
    const sel = buildSelector(statusEl);
    if (statusEl.tag === "SELECT" || statusEl.isMat) {
      await selectAngular(session, sel, usage, `${approachLabel} (حالة)`, statusEl.isMat);
    }
  } else {
    addLog(session, `⚠️ لم يُعثر على select حالة ${approachLabel}`);
  }

  if (hasValue && valueEl) {
    await fillAngular(session, buildSelector(valueEl), approachValue, `${approachLabel} (قيمة)`);
  } else if (hasValue && !valueEl) {
    addLog(session, `⚠️ لم يُعثر على input قيمة ${approachLabel}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// تعبئة أساليب التقييم الثلاثة (السوق / الدخل / التكلفة)
//
// القاعدة (من سيناريو المستخدم):
//   - إذا كانت قيمة الأسلوب > 0 → اختر "أساسي لتقدير القيمة" من القائمة المنسدلة
//     ثم عبّئ أول حقل "القيمة" تحت نفس الأسلوب بالمبلغ
//   - إذا لا قيمة → تخطّ (أو غير مستخدم)
//
// الاستراتيجية:
//   1. DOM scan: إيجاد قسم كل أسلوب بنص عنوانه → nth index للـ mat-select + input
//   2. احتياط بـ formControlName/name من scanElements
// ─────────────────────────────────────────────────────────────────────────────
async function fillApproachFields(
  session: AutomationSession,
  els: any[],
  report: any,
): Promise<void> {
  const { page } = session;

  /* ═══════════════════════════════════════════════════════════════════════
     أساليب التقييم الثلاثة في TAQEEM هي native <select> وليس mat-select.
     القاعدة:
       - إذا قيمة الأسلوب > 0 → اختر "أساسي لتقدير القيمة"
         ثم عبّئ أول input يظهر بعد هذا الـ select في DOM بالقيمة.
       - إذا لا قيمة → تخطّ (يبقى "غير مستخدم").
     ═══════════════════════════════════════════════════════════════════════ */

  // ── تحديد النسب (تدعم القيم كـ 70 أو 0.7 وتحوّلها لـ 0-100) ──────────────
  const normPct = (v: any): number => {
    const n = Number(v);
    if (!n || isNaN(n)) return 0;
    return n <= 1 ? n * 100 : n; // 0.7 → 70, 70 → 70
  };

  const mktPct  = normPct(report.marketApproachPercentage);
  const incPct  = normPct(report.incomeApproachPercentage);
  const cstPct  = normPct(report.costApproachPercentage);

  // إذا لا توجد نسب مخزنة → استخدم القيمة المالية لتحديد النوع (الفلبكّ القديم)
  const hasPct = mktPct + incPct + cstPct > 0;

  const approaches = [
    {
      key: "market", label: "أسلوب السوق",   textRx: /السوق/i,
      value:      Number(report.marketValue) || 0,
      percentage: mktPct,
    },
    {
      key: "income", label: "أسلوب الدخل",   textRx: /الدخل/i,
      value:      Number(report.incomeValue) || 0,
      percentage: incPct,
    },
    {
      key: "cost",   label: "أسلوب التكلفة", textRx: /التكلفة/i,
      value:      Number(report.costValue)   || 0,
      percentage: cstPct,
    },
  ];

  // تحديد الأسلوب الأساسي (الأعلى نسبة من النسب غير الصفرية)
  const maxPct = Math.max(mktPct, incPct, cstPct);

  // دالة: ماذا يكون حالة الأسلوب؟
  const getApproachStatus = (ap: typeof approaches[0]): "أساسي" | "مساعد" | "غير مستخدم" => {
    if (hasPct) {
      if (ap.percentage <= 0)   return "غير مستخدم";
      if (ap.percentage >= maxPct) return "أساسي";
      return "مساعد";
    } else {
      // الفلبكّ: إذا لا نسب → أي أسلوب بقيمة موجبة = أساسي
      return ap.value > 0 ? "أساسي" : "غير مستخدم";
    }
  };

  addLog(session,
    `📊 أساليب — سوق: ${approaches[0].value} (${mktPct}%) | دخل: ${approaches[1].value} (${incPct}%) | تكلفة: ${approaches[2].value} (${cstPct}%) | hasPct=${hasPct}`,
  );

  // ── المرحلة 1: اكتشاف كل select أسلوب من native <select> ─────────────────
  const nativeCount = await page.locator("select").count();
  const matCount    = await page.locator("mat-select").count();
  addLog(session, `🔍 <select>: ${nativeCount} | mat-select: ${matCount}`);

  // map: approach key → { type, index }
  type SelType = "native" | "mat";
  const approachMap: Record<string, { type: SelType; index: number }> = {};

  // ── فحص native selects أولاً (الأكثر شيوعاً في TAQEEM) ─────────────────
  for (let i = 0; i < nativeCount && Object.keys(approachMap).length < 3; i++) {
    const info = await page.locator("select").nth(i).evaluate((el: HTMLSelectElement) => {
      const opts = Array.from(el.options).map(o => o.text.trim());
      const hasApproach = opts.some(o => /أساسي.*(?:لتقدير|القيمة)/i.test(o));
      if (!hasApproach) return null;
      // استخرج النص المحيط (نصعد 8 مستويات للوصول لعنوان القسم)
      let surround = "";
      let p: Element | null = el;
      for (let d = 0; d < 8 && p; d++) {
        const t = (p.textContent || "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
        if (t.length > 5 && t.length < 500) surround = t;
        p = p.parentElement;
      }
      return { surround, opts };
    });
    if (!info) continue;

    const ap = approaches.find(a =>
      a.textRx.test(info.surround) && !approachMap[a.key],
    );
    if (ap) {
      approachMap[ap.key] = { type: "native", index: i };
      addLog(session, `✅ ${ap.label} → native select[${i}] | نص: "${info.surround.slice(0, 60)}"`);
    }
  }

  // ── احتياط: فحص mat-select إذا لم يكتمل الاكتشاف ──────────────────────
  if (Object.keys(approachMap).length < 3) {
    for (let i = 0; i < Math.min(matCount, 20) && Object.keys(approachMap).length < 3; i++) {
      try {
        await page.locator("mat-select").nth(i).click({ timeout: 1200 });
        await page.waitForTimeout(200);

        const info = await page.evaluate((idx: number) => {
          const opts = Array.from(document.querySelectorAll("mat-option, .mat-mdc-option"))
            .map(o => (o.textContent || "").trim()).filter(Boolean);
          if (!opts.some(o => /أساسي.*(?:لتقدير|القيمة)/i.test(o))) return null;
          const allMS = Array.from(document.querySelectorAll("mat-select"));
          let el: Element | null = allMS[idx];
          let surround = "";
          for (let d = 0; d < 7 && el; d++) {
            const t = (el.textContent || "").replace(/\s+/g, " ").trim();
            if (t.length > 5 && t.length < 400) surround = t;
            el = el.parentElement;
          }
          return { surround };
        }, i);

        await page.keyboard.press("Escape");
        await page.waitForTimeout(150);
        if (!info) continue;

        const ap = approaches.find(a => a.textRx.test(info.surround) && !approachMap[a.key]);
        if (ap) {
          approachMap[ap.key] = { type: "mat", index: i };
          addLog(session, `✅ ${ap.label} → mat-select[${i}]`);
        }
      } catch {
        await page.keyboard.press("Escape").catch(() => {});
      }
    }
  }

  addLog(session, `📌 الأساليب المكتشفة: ${JSON.stringify(approachMap)}`);

  // ── أنماط regex لنصوص الخيارات الثلاثة ──────────────────────────────────
  const STATUS_RX: Record<string, RegExp> = {
    "أساسي":        /أساسي.*(?:لتقدير|القيمة)/i,
    "مساعد":        /مساعد.*(?:لتقدير|القيمة)/i,
    "غير مستخدم":  /غير.*مستخدم/i,
  };

  // ── المرحلة 2: تعبئة كل أسلوب ──────────────────────────────────────────
  for (const ap of approaches) {
    const desiredStatus = getApproachStatus(ap);

    if (desiredStatus === "غير مستخدم") {
      addLog(session, `⏭️ ${ap.label}: ${hasPct ? `${ap.percentage}%` : "لا قيمة"} — غير مستخدم، تخطّي`);
      continue;
    }

    const found = approachMap[ap.key];
    if (!found) {
      addLog(session, `⚠️ ${ap.label}: لم يُكتشف dropdown — تخطّي`);
      continue;
    }

    const statusLabel = desiredStatus === "أساسي" ? "أساسي لتقدير القيمة" : "مساعد لتقدير القيمة";
    addLog(session, `🎯 ${ap.label}: ${ap.percentage}% → "${statusLabel}" | type=${found.type}[${found.index}]`);

    // ── أ) اختيار حالة الأسلوب ────────────────────────────────────────────
    let statusDone = false;
    const statusRx = STATUS_RX[desiredStatus];

    if (found.type === "native") {
      // native <select>: استخدم locator.selectOption — مرئي لـ Angular
      try {
        const optValue = await page.locator("select").nth(found.index).evaluate(
          (el: HTMLSelectElement, rxSrc: string) => {
            const rx = new RegExp(rxSrc, "i");
            const opt = Array.from(el.options).find(o => rx.test(o.text));
            return opt?.value ?? null;
          },
          statusRx.source,
        );
        if (optValue !== null) {
          await page.locator("select").nth(found.index).selectOption({ value: optValue });
          addLog(session, `✅ ${ap.label}: "${statusLabel}" (native selectOption)`);
          statusDone = true;
          await page.waitForTimeout(700);
        }
      } catch (e: any) {
        addLog(session, `⚠️ ${ap.label}: native selectOption فشل — ${e.message}`);
      }
    } else {
      // mat-select: click + Playwright locator click على mat-option
      try {
        await page.locator("mat-select").nth(found.index).click({ timeout: 2000 });
        await page.waitForSelector("mat-option, .mat-mdc-option", { timeout: 3000 });
        await page.waitForTimeout(200);

        const optLoc = page.locator("mat-option, .mat-mdc-option")
          .filter({ hasText: statusRx });
        if (await optLoc.count() > 0) {
          await optLoc.first().click({ timeout: 2000 });
          addLog(session, `✅ ${ap.label}: "${statusLabel}" (mat-option click)`);
          statusDone = true;
          await page.waitForTimeout(700);
        } else {
          await page.keyboard.press("Escape").catch(() => {});
          addLog(session, `⚠️ ${ap.label}: خيار "${statusLabel}" غير موجود في mat-select`);
        }
      } catch (e: any) {
        await page.keyboard.press("Escape").catch(() => {});
        addLog(session, `⚠️ ${ap.label}: mat-select فشل — ${e.message}`);
      }
    }

    if (!statusDone) {
      addLog(session, `ℹ️ ${ap.label}: اختيار الحالة لم يتم — تخطّي تعبئة القيمة`);
      continue;
    }

    // ── ب) تعبئة أول input يظهر بعد الـ select في DOM ────────────────────
    const selTag = found.type === "native" ? "select" : "mat-select";
    const valueNth: number = await page.evaluate(
      ({ tag, idx }: { tag: string; idx: number }) => {
        const allSels   = Array.from(document.querySelectorAll(tag));
        const allInputs = Array.from(document.querySelectorAll("input"));
        const sel       = allSels[idx];
        if (!sel) return -1;
        const first = allInputs.find(inp => {
          if (["radio", "checkbox", "hidden"].includes((inp as HTMLInputElement).type)) return false;
          return (sel.compareDocumentPosition(inp) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
        });
        return first ? allInputs.indexOf(first) : -1;
      },
      { tag: selTag, idx: found.index },
    );

    addLog(session, `🔍 ${ap.label}: أول input بعد الـ select → nth=${valueNth}`);

    if (valueNth >= 0) {
      try {
        const inputLoc = page.locator("input").nth(valueNth);
        await inputLoc.click({ timeout: 2000 });
        await inputLoc.selectText().catch(() => {});
        await inputLoc.fill(String(ap.value));
        addLog(session, `✅ ${ap.label}: قيمة=${ap.value} → input[${valueNth}]`);
      } catch (e: any) {
        addLog(session, `⚠️ ${ap.label}: فشل تعبئة القيمة — ${e.message}`);
      }
    } else {
      addLog(session, `⚠️ ${ap.label}: لم يُعثر على input للقيمة (قد تظهر بعد التأخير)`);
    }
  }
}


// ─────────────────────────────────────────────────────────────────────────────
// بيانات الأصل والموقع
// (أسماء الحقول تُكتشف من scanElements — نستخدم name إن عُرف أو labelText كاحتياط)
// ─────────────────────────────────────────────────────────────────────────────
async function fillAssetPage(
  session: AutomationSession,
  report: any,
  els: any[],
): Promise<void> {
  logElements(session, els, "الصفحة 2 — بيانات الأصل والموقع");

  const selects   = els.filter(e => e.tag === "SELECT" || e.tag === "MAT-SELECT");
  const inputs    = els.filter(e => e.tag === "INPUT" && !["file","radio","checkbox"].includes(e.type));
  const checkboxes = els.filter(e => e.type === "checkbox");

  // دالة مساعدة: ابحث بـ name أولاً ثم بـ label
  const byName = (name: string) => els.find(e => e.name === name);
  const byLabel = (rx: RegExp) => findEl(els, rx);

  // ── نوع الأصل ────────────────────────────────────────────────────────────
  const assetTypeEl = byName("asset_type_id") ?? byName("property_type_id") ??
    byLabel(/asset.?type|property.?type|نوع.*أصل|نوع.*عقار/i);
  if (assetTypeEl) {
    await (assetTypeEl.isMat
      ? selectAngular(session, buildSelector(assetTypeEl), report.propertyType, "نوع الأصل", true)
      : selectNativeByName(session, assetTypeEl.name || "", report.propertyType, "نوع الأصل"));
  } else addLog(session, "⚠️ لم يُعثر على «نوع الأصل»");

  // ── انتظار انتهاء كاسكاد نوع الأصل → استخدام/قطاع الأصل ────────────────
  // TAQEEM تُطلق API call بعد اختيار نوع الأصل لتحديث قائمة استخدام/قطاع الأصل
  // نمنح 2 ثانية لانتهاء الطلب قبل الاختيار
  addLog(session, "⏳ انتظار انتهاء كاسكاد نوع الأصل...");
  await session.page.waitForTimeout(2000);

  // ── استخدام/قطاع الأصل ───────────────────────────────────────────────────
  // الاسم الفعلي: asset_usage_id — نفس أسلوب المنطقة (selectNativeByName)
  await selectNativeByName(session, "asset_usage_id", report.propertyUse, "استخدام/قطاع الأصل", "أخرى");

  // ── تاريخ المعاينة ────────────────────────────────────────────────────────
  const inspEl = byName("inspection_date") ?? byName("inspected_at") ??
    byLabel(/inspection.?date|معاينة|تاريخ.*معاينة/i);
  if (inspEl) await fillDate(session, buildSelector(inspEl), report.inspectionDate, "تاريخ المعاينة");
  else addLog(session, "⚠️ لم يُعثر على «تاريخ المعاينة»");

  // ── أساليب التقييم ─── تُعبَّأ في الصفحة 3 (fillAttributePage) ───────────

  // ── الدولة (ثابت: المملكة العربية السعودية) ──────────────────────────────
  const countryEl = byName("country_id") ?? byLabel(/country|دولة|بلد/i);
  if (countryEl) {
    await (countryEl.isMat
      ? selectAngular(session, buildSelector(countryEl), "المملكة العربية السعودية", "الدولة", true)
      : selectNativeByName(session, countryEl.name || "", "المملكة العربية السعودية", "الدولة"));
  }

  // ── المنطقة ───────────────────────────────────────────────────────────────
  const regionEl = byName("region_id") ?? byLabel(/region|province|منطقة|محافظة/i);
  if (regionEl) {
    await (regionEl.isMat
      ? selectAngular(session, buildSelector(regionEl), report.region, "المنطقة", true)
      : selectNativeByName(session, regionEl.name || "", report.region, "المنطقة"));
    await session.page.waitForTimeout(1000); // انتظر تحميل المدن
  } else addLog(session, "⚠️ لم يُعثر على «المنطقة»");

  // ── المدينة ───────────────────────────────────────────────────────────────
  const cityEl = byName("city_id") ?? byLabel(/city|مدينة/i);
  if (cityEl) {
    await (cityEl.isMat
      ? selectAngular(session, buildSelector(cityEl), report.city, "المدينة", true)
      : selectNativeByName(session, cityEl.name || "", report.city, "المدينة"));
    await session.page.waitForTimeout(800);
  } else addLog(session, "⚠️ لم يُعثر على «المدينة»");

  // ── الحي ─────────────────────────────────────────────────────────────────
  const districtEl = byName("district") ?? byName("neighborhood") ??
    byLabel(/district|neighborhood|حي/i);
  if (districtEl) await fillAngular(session, buildSelector(districtEl), report.district, "الحي");

  // ── الشارع ────────────────────────────────────────────────────────────────
  const streetEl = byName("street") ?? byName("street_name") ??
    byLabel(/street|شارع/i);
  if (streetEl) await fillAngular(session, buildSelector(streetEl), report.street, "الشارع");

  // ── الرأي النهائي في القيمة ──────────────────────────────────────────────
  const finalValEl =
    byName("final_opinion_value") ?? byName("opinion_value") ??
    byName("final_value")         ?? byName("finalopinionvalue") ??
    byName("final_opinion")       ?? byName("total_value") ??
    byLabel(/final.?opinion|opinion.?value|final.?value|الرأي.*قيمة|رأي.*نهائي|القيمة.*نهائية|رأي.*المقيّم|رأي.*مقيم/i);
  if (finalValEl) {
    await fillAngular(session, buildSelector(finalValEl), report.finalValue, "الرأي النهائي في القيمة");
  } else {
    addLog(session, "⚠️ لم يُعثر على حقل «الرأي النهائي في القيمة»");
  }

  // ── الإحداثيات (خط العرض / خط الطول) ───────────────────────────────────
  // استخرج lat/lng من الحقل المباشر أو من coordinates
  let lat: string | null = report.latitude != null ? String(report.latitude) : null;
  let lng: string | null = report.longitude != null ? String(report.longitude) : null;

  if ((!lat || !lng) && report.coordinates) {
    // يدعم: "24.7136, 46.6753" أو "24.7136،46.6753" أو "24.7136  46.6753" (فراغ)
    const parts = String(report.coordinates)
      .trim()
      .split(/[,،\s]+/)
      .map((s: string) => s.trim())
      .filter((s: string) => /^-?\d+(\.\d+)?$/.test(s));
    if (parts.length >= 2) {
      if (!lat) lat = parts[0];
      if (!lng) lng = parts[1];
    }
  }

  const latEl =
    byName("latitude")  ?? byName("lat")  ??
    byName("property_latitude") ?? byName("asset_latitude") ??
    byLabel(/latitude|lat\b|خط.*عرض|عرض.*جغرافي/i);
  if (latEl && lat) {
    await fillAngular(session, buildSelector(latEl), lat, "خط العرض");
  } else if (!latEl) {
    addLog(session, "⚠️ لم يُعثر على حقل «خط العرض»");
  } else if (!lat) {
    addLog(session, "⚠️ لا توجد قيمة لخط العرض في التقرير");
  }

  const lngEl =
    byName("longitude")  ?? byName("lng") ?? byName("lon") ??
    byName("property_longitude") ?? byName("asset_longitude") ??
    byLabel(/longitude|lng\b|lon\b|خط.*طول|طول.*جغرافي/i);
  if (lngEl && lng) {
    await fillAngular(session, buildSelector(lngEl), lng, "خط الطول");
  } else if (!lngEl) {
    addLog(session, "⚠️ لم يُعثر على حقل «خط الطول»");
  } else if (!lng) {
    addLog(session, "⚠️ لا توجد قيمة لخط الطول في التقرير");
  }

  // ── أساليب التقييم (السوق / الدخل / التكلفة) — موجودة في الصفحة 2 ────────
  try {
    await fillApproachFields(session, els, report);
  } catch (e: any) {
    addLog(session, `⚠️ fillApproachFields: ${e.message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// مسح مباشر للصفحة: يبحث عن native <select> بنص التسمية (label) المجاورة
// كل العمل داخل page.evaluate واحد — لا مشاكل في محددات Playwright
// يعمل مع name="attribute[N]" وأي تسمية أخرى
// ─────────────────────────────────────────────────────────────────────────────
async function fillSelectByPageScan(
  session: AutomationSession,
  labelRxSource: string,
  value: string | null | undefined,
  fieldLabel: string,
  fallback?: string,
): Promise<void> {
  if (!value || value.trim() === "") {
    addLog(session, `⏭️ تخطي «${fieldLabel}» — لا قيمة`);
    return;
  }
  const normVal = normalizeAr(value);
  const normFb  = fallback ? normalizeAr(fallback) : "";

  const { page } = session;
  try {
    type ScanResult = {
      found: boolean;
      matched: string | null;
      usedFallback: boolean;
      available: string[];
      allSelects: Array<{ label: string; name: string; id: string; opts: string[] }>;
    };
    const result: ScanResult = await page.evaluate(
      new Function("args", `
        ${EVAL_NORM_FN}
        var nl = function(t){ return (t||"").replace(/\\s+/g," ").trim(); };

        // جمع معلومات كل select في الصفحة للتشخيص
        var allSelects = Array.from(document.querySelectorAll("select")).map(function(s){
          var lbl = "";
          if(s.id){ var el=document.querySelector('label[for="'+s.id+'"]'); if(el) lbl=el.textContent||""; }
          if(!lbl){ var c=s.closest(".form-group,.field,.col,.ng-star-inserted,.row,div"); if(c){ var l=c.querySelector("label"); if(l) lbl=l.textContent||""; } }
          return {
            label: nl(lbl),
            name:  s.name||"",
            id:    s.id||"",
            opts:  Array.from(s.options).map(function(o){return o.text.trim();}).filter(Boolean).slice(0,6)
          };
        });

        // إيجاد الـ select بالـ label
        var rx = new RegExp(args.rxSrc, "i");
        var target = null;
        var selects = document.querySelectorAll("select");
        for(var i=0;i<selects.length;i++){
          var s = selects[i];
          var lbl = "";
          if(s.id){ var el=document.querySelector('label[for="'+s.id+'"]'); if(el) lbl=el.textContent||""; }
          if(!lbl){
            // نبحث في الـ containers بشكل متصاعد
            var c = s.parentElement;
            while(c && c !== document.body){
              var l = c.querySelector("label");
              if(l && rx.test(nl(l.textContent||""))){ lbl=l.textContent||""; break; }
              c = c.parentElement;
            }
          }
          if(rx.test(nl(lbl))){ target=s; break; }
        }

        if(!target){
          return {found:false, matched:null, usedFallback:false, available:[], allSelects:allSelects};
        }

        var opts = Array.from(target.options);
        var available = opts.map(function(o){return o.text.trim();}).filter(Boolean);
        var opt = opts.find(function(o){ return _matches(o.text, args.nv); });
        var usedFb = false;
        if(!opt && args.fb){
          opt = opts.find(function(o){ return _matches(o.text, args.fb); });
          if(opt) usedFb = true;
        }
        if(opt){
          target.value = opt.value;
          target.dispatchEvent(new Event("change",{bubbles:true}));
          target.dispatchEvent(new Event("input",{bubbles:true}));
          return {found:true, matched:opt.text.trim(), usedFallback:usedFb, available:available, allSelects:allSelects};
        }
        return {found:true, matched:null, usedFallback:false, available:available, allSelects:allSelects};
      `) as (args: {rxSrc:string; nv:string; fb:string}) => ScanResult,
      { rxSrc: labelRxSource, nv: normVal, fb: normFb },
    );

    if (!result.found) {
      addLog(session, `⚠️ «${fieldLabel}»: لم يُعثر على select — سجل الـ selects في الصفحة:`);
      (result.allSelects || []).forEach((s, i) => {
        addLog(session, `  [${i}] label="${s.label}" name="${s.name}" id="${s.id}" → ${s.opts.join(" | ")}`);
      });
    } else if (result.matched) {
      if (result.usedFallback) {
        addLog(session, `⚠️ «${fieldLabel}»: "${value}" غير موجود — اختير "${result.matched}" بديلاً`);
      } else {
        addLog(session, `✅ ${fieldLabel}: ${result.matched} (من "${value}")`);
      }
    } else {
      addLog(session, `⚠️ «${fieldLabel}»: "${value}" غير موجود — المتاح: ${result.available.slice(0, 8).join(" | ")}`);
    }
  } catch (e: any) {
    addLog(session, `⚠️ خطأ في «${fieldLabel}»: ${(e as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// الحل الجذري: يجد <select> بالاسم الدقيق، يُطابق الخيار بالنص العربي بتطابق
// ضبابي كاملاً داخل المتصفح — يعمل مع attribute[4] و attribute[8] وغيرهما.
// XPath للانتظار (لا يتأثر بأقواس الاسم)، ثم querySelector في page.evaluate.
// ─────────────────────────────────────────────────────────────────────────────
async function selectByNameFuzzy(
  session: AutomationSession,
  selectName: string,
  targetText: string | null | undefined,
  fieldLabel: string,
  fallbackText?: string,
): Promise<boolean> {
  if (!targetText?.trim()) {
    addLog(session, `⏭️ [${fieldLabel}]: لا قيمة — تخطي`);
    return false;
  }
  addLog(session, `🎯 selectByNameFuzzy [${fieldLabel}]: name="${selectName}" ← "${targetText}"`);

  // انتظار ظهور الـ select — XPath يتجنب مشكلة أقواس CSS في Playwright
  const xp = `xpath=//select[@name="${selectName}"]`;
  try {
    await session.page.waitForSelector(xp, { timeout: 5000 });
  } catch {
    addLog(session, `⚠️ [${fieldLabel}]: select[name="${selectName}"] لم يظهر خلال 5 ثوانٍ — تخطي`);
    return false;
  }

  // ── انتظار تحميل الخيارات من الـ API (أكثر من خيار "اختر" الافتراضي) ────────
  // Angular يحمّل الخيارات بشكل غير متزامن — نختار فقط بعد اكتمال التحميل
  try {
    await session.page.waitForFunction(
      (sn: string) => {
        const sel = document.querySelector<HTMLSelectElement>(`select[name="${sn}"]`);
        return !!sel && sel.options.length > 1;
      },
      selectName,
      { timeout: 10000 },
    );
    addLog(session, `⏳ [${fieldLabel}]: الخيارات جاهزة`);
  } catch {
    addLog(session, `⚠️ [${fieldLabel}]: الخيارات لم تُحمَّل بعد 10 ثوانٍ — أحاول على أي حال`);
  }

  // ── الخطوة 1: إيجاد قيمة الخيار الأنسب داخل المتصفح (بدون تعديل) ──────────
  const found = await session.page.evaluate(
    ({ sn, tv, fb }: { sn: string; tv: string; fb?: string }) => {
      const nl = (s: string) =>
        (s || "")
          .replace(/[\u064B-\u065F\u0670]/g, "")
          .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
          .replace(/\s+/g, " ").trim().toLowerCase();

      const sel = document.querySelector<HTMLSelectElement>(`select[name="${sn}"]`);
      if (!sel) return { ok: false as const, reason: `no <select name="${sn}">` };

      const opts = Array.from(sel.options).filter(o => o.value !== "" && o.value !== "0" && !o.disabled);
      if (!opts.length) return { ok: false as const, reason: "no valid options" };

      const target = nl(tv);
      let bestOpt: HTMLOptionElement | null = null;
      let bestScore = 0;

      for (const opt of opts) {
        const oN = nl(opt.text);
        if (oN === target)                               { bestOpt = opt; bestScore = 100; break; }
        if (oN.includes(target) || target.includes(oN)) {
          const sc = 80 + (Math.min(oN.length, target.length) / Math.max(oN.length, target.length, 1)) * 20;
          if (sc > bestScore) { bestOpt = opt; bestScore = sc; }
        }
        const ml = Math.min(3, oN.length, target.length);
        if (ml >= 2 && oN.slice(0, ml) === target.slice(0, ml) && 50 > bestScore) {
          bestOpt = opt; bestScore = 50;
        }
      }

      if (!bestOpt && fb) {
        const fN = nl(fb);
        for (const opt of opts) {
          if (nl(opt.text) === fN || nl(opt.text).includes(fN)) { bestOpt = opt; bestScore = 10; break; }
        }
      }

      if (!bestOpt) {
        const allOpts = opts.map(o => `"${o.text.trim()}"(${o.value})`).join(", ");
        return { ok: false as const, reason: `لا تطابق لـ "${tv}" — الخيارات: [${allOpts}]` };
      }

      return { ok: true as const, value: bestOpt.value, chosen: bestOpt.text.trim(), score: Math.round(bestScore) };
    },
    { sn: selectName, tv: targetText ?? "", fb: fallbackText },
  );

  if (!found.ok) {
    addLog(session, `❌ [${fieldLabel}]: ${found.reason}`);
    return false;
  }

  // ── الخطوة 2: الاختيار عبر Playwright locator — يُشغّل Angular change detection ──
  try {
    await session.page.locator(xp).selectOption({ value: found.value });
    addLog(session, `✅ [${fieldLabel}]: اختار "${found.chosen}" (value=${found.value}, score=${found.score}%)`);
    return true;
  } catch (e) {
    addLog(session, `⚠️ [${fieldLabel}]: selectOption(value=${found.value}) فشل — أحاول بالنص مباشرة`);
    try {
      await session.page.locator(xp).selectOption({ label: found.chosen });
      addLog(session, `✅ [${fieldLabel}]: اختار بالنص "${found.chosen}"`);
      return true;
    } catch (e2) {
      addLog(session, `❌ [${fieldLabel}]: فشل كلياً — ${(e2 as Error).message}`);
      return false;
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// الواجهات المطلة على الشارع — يحوّل الرقم إلى الخيار المناسب في TAQEEM
//   1  → "واجهة واحدة"   (value=6)
//   2  → "واجهتان"        (value=7)
//   3  → "ثلاث واجهات"   (value=8)
//   4+ → "4 واجهات"       (value=9)
// البحث بخيارات الـ select (مُعرِّف فريد) + كل العمل داخل المتصفح
// ─────────────────────────────────────────────────────────────────────────────
async function fillFacadesCount(
  session: AutomationSession,
  facadesCount: number | null | undefined,
): Promise<void> {
  const raw = Number(facadesCount ?? 0);
  if (!raw || raw <= 0) {
    addLog(session, "⏭️ تخطي «الواجهات المطلة» — لا قيمة");
    return;
  }

  const count = Math.round(raw);
  const optValue = count <= 1 ? "6" : count === 2 ? "7" : count === 3 ? "8" : "9";
  const optLabel = count <= 1 ? "واجهة واحدة" : count === 2 ? "واجهتان" : count === 3 ? "ثلاث واجهات" : "4 واجهات";
  addLog(session, `🔍 الواجهات المطلة: ${count} → "${optLabel}" (value=${optValue})`);

  const { page } = session;
  try {
    type FacadeResult = {
      found: boolean;
      matched: string | null;
      allSelects: Array<{ name: string; id: string; opts: string[] }>;
    };

    // كل العمل داخل page.evaluate — لا مشاكل في محددات Playwright
    const result: FacadeResult = await page.evaluate((args: {ov:string; ol:string}) => {
      const nl = (t: string) => t.replace(/\s+/g, " ").trim();

      // تشخيص: جمع كل الـ selects
      const selects = Array.from(document.querySelectorAll("select"));
      const allSelects = selects.map(s => ({
        name: s.name || "",
        id:   s.id   || "",
        opts: Array.from(s.options).map(o => o.text.trim()).filter(Boolean).slice(0, 6),
      }));

      // إيجاد الـ select بخياراته الفريدة (واجهة واحدة / واجهتان)
      const target = selects.find(s =>
        Array.from(s.options).some(o =>
          nl(o.text).includes("واجهة واحدة") || nl(o.text).includes("واجهتان"),
        ),
      );

      if (!target) return { found: false, matched: null, allSelects };

      // محاولة 1: بالقيمة الرقمية المباشرة
      let opt = Array.from(target.options).find(o => o.value === args.ov);
      // محاولة 2: بالنص
      if (!opt) opt = Array.from(target.options).find(o => nl(o.text).includes(args.ol));

      if (opt) {
        target.value = opt.value;
        target.dispatchEvent(new Event("change", { bubbles: true }));
        target.dispatchEvent(new Event("input",  { bubbles: true }));
        return { found: true, matched: nl(opt.text), allSelects };
      }
      return { found: true, matched: null, allSelects };
    }, { ov: optValue, ol: optLabel });

    if (result.found && result.matched) {
      addLog(session, `✅ الواجهات المطلة: ${count} → "${result.matched}"`);
    } else if (result.found) {
      addLog(session, `⚠️ الواجهات: select موجود لكن القيمة "${optLabel}" غير موجودة — خياراته: ${result.allSelects.find(s => s.opts.some(o => o.includes("واجهة")))?.opts.join(" | ")}`);
    } else {
      addLog(session, `⚠️ الواجهات: select غير موجود — كل الـ selects في الصفحة:`);
      (result.allSelects || []).forEach((s, i) => {
        addLog(session, `  [${i}] name="${s.name}" id="${s.id}" → ${s.opts.join(" | ")}`);
      });
    }
  } catch (e: any) {
    addLog(session, `⚠️ خطأ في «الواجهات المطلة»: ${(e as Error).message}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 3: /report/attribute/create/{id}
// السمات والبيانات الإضافية للأصل
// ─────────────────────────────────────────────────────────────────────────────
async function fillAttributePage(
  session: AutomationSession,
  report: any,
  els: any[],
): Promise<void> {
  logElements(session, els, "الصفحة 3 — السمات والبيانات الإضافية");

  const byName  = (name: string) => els.find(e => e.name === name);
  const byLabel = (rx: RegExp)   => findEl(els, rx);

  // ── رقم الصك / سند الملكية ───────────────────────────────────────────────
  const deedEl = byName("deed_number") ?? byName("title_number") ??
    byLabel(/deed|title.?num|صك|سند/i);
  if (deedEl) await fillAngular(session, buildSelector(deedEl), report.deedNumber, "رقم الصك");
  else addLog(session, "⚠️ لم يُعثر على «رقم الصك»");

  // ── نوع الملكية ───────────────────────────────────────────────────────────
  // الاسم الفعلي: attribute[4] — الحل الجذري: selectByNameFuzzy مباشرة
  await selectByNameFuzzy(session, "attribute[4]", report.ownershipType, "نوع الملكية", "أخرى");

  // ── مساحة الأرض ───────────────────────────────────────────────────────────
  const landEl = byName("land_area") ?? byName("plot_area") ??
    byLabel(/land.?area|plot.?area|مساحة.*أرض|مساحة.*قطعة/i);
  if (landEl) await fillAngular(session, buildSelector(landEl), report.landArea, "مساحة الأرض");
  else addLog(session, "⚠️ لم يُعثر على «مساحة الأرض»");

  // ── مساحة البناء ──────────────────────────────────────────────────────────
  const buildEl = byName("building_area") ?? byName("floor_area") ??
    byLabel(/building.?area|floor.?area|مساحة.*بناء|مسطحات/i);
  if (buildEl) await fillAngular(session, buildSelector(buildEl), report.buildingArea, "مساحة البناء");

  // ── عدد الأدوار ───────────────────────────────────────────────────────────
  const floorsEl = byName("floors_count") ?? byName("floor_count") ??
    byLabel(/floor.?count|floors|أدوار|طوابق/i);
  if (floorsEl) await fillAngular(session, buildSelector(floorsEl), report.floorsCount ?? report.permittedFloorsCount, "عدد الأدوار");

  // ── مساحة البناء المصرح بها (نسبة مئوية) ────────────────────────────────
  // القاعدة: إذا استخدام/قطاع الأصل = سكني → 60% ، غير ذلك → 80%
  const ratioEl = byName("build_ratio") ?? byName("building_ratio") ??
    byName("licensed_building_ratio") ?? byName("permit_ratio") ??
    byLabel(/مساحة.*بناء.*مصرح|مصرح.*بناء|نسبة.*بناء|نسبة.*مصرح|build.?ratio|permit.?ratio/i);
  if (ratioEl) {
    const buildRatio = /سكن/i.test(report.propertyUse ?? "") ? "60" : "80";
    addLog(session, `ℹ️ مساحة البناء المصرح بها: ${buildRatio}% (استخدام: ${report.propertyUse ?? "غير محدد"})`);
    await fillAngular(session, buildSelector(ratioEl), buildRatio, "مساحة البناء المصرح بها (نسبة مئوية)");
  } else {
    addLog(session, "⚠️ لم يُعثر على حقل «مساحة البناء المصرح بها (نسبة مئوية)»");
  }

  // ── حالة البناء ───────────────────────────────────────────────────────────
  const statusEl = byName("building_status_id") ?? byLabel(/building.?status|حالة.*بناء/i);
  if (statusEl) {
    await (statusEl.isMat
      ? selectAngular(session, buildSelector(statusEl), report.buildingStatus, "حالة البناء", true)
      : selectNativeByName(session, statusEl.name || "", report.buildingStatus, "حالة البناء"));
  }

  // ── الاتجاه المطل (اختياري — قد لا يكون موجوداً في كل نماذج) ─────────────
  // نبحث بـ name = facade_id فقط لتجنب التعارض مع select عدد الواجهات
  const dirEl = byName("facade_id") ?? byName("street_direction_id") ??
    byLabel(/اتجاه.*مطل|street.*dir|مطلة.*شارع/i);
  if (dirEl) {
    await (dirEl.isMat
      ? selectAngular(session, buildSelector(dirEl), report.streetFacades, "اتجاه المطل", true, "أخرى")
      : selectNativeByName(session, dirEl.name || "", report.streetFacades, "اتجاه المطل", "أخرى"));
  }

  // ── الواجهات المطلة على الشارع ──────────────────────────────────────────
  // الخريطة: 1→"واجهة واحدة"(6), 2→"واجهتان"(7), 3→"ثلاث واجهات"(8), 4+→"4 واجهات"(9)
  // الكشف: نبحث عن أي <select> يحتوي خياراً بـ "واجهة واحدة" أو "واجهتان"
  // ثم نختار بـ locator.selectOption() لضمان Angular change detection
  {
    const facadesNumToText = (n: number): string =>
      n <= 1 ? "واجهة واحدة" : n === 2 ? "واجهتان" : n === 3 ? "ثلاث واجهات" : "4 واجهات";

    const facadesNumToValue = (n: number): string =>
      n <= 1 ? "6" : n === 2 ? "7" : n === 3 ? "8" : "9";

    // ── تحديد العدد من facadesCount أو من streetFacades ──────────────────
    addLog(session, `🔎 الواجهات — facadesCount="${report.facadesCount}" (type=${typeof report.facadesCount}) | streetFacades="${report.streetFacades}"`);
    const fc = report.facadesCount != null && report.facadesCount !== "" ? Number(report.facadesCount) : null;
    let facadesNum: number | null = fc != null && !isNaN(fc) && fc > 0 ? Math.round(fc) : null;

    if (!facadesNum) {
      const sf = (report.streetFacades as string | null | undefined) ?? "";
      if (sf.trim()) {
        const t = sf.trim();
        facadesNum =
          /واجهة واحدة|واحدة|^1$|١/i.test(t)    ? 1 :
          /واجهتان|اثنتان|^2$|٢/i.test(t)        ? 2 :
          /ثلاث.*واجهات|^3$|٣/i.test(t)          ? 3 :
          /أربع.*واجهات|^4$|٤/i.test(t)          ? 4 :
          /^(\d+)$/.test(t) ? (parseInt(t) >= 1 && parseInt(t) <= 4 ? parseInt(t) : 4) :
          (t.match(/شمال|جنوب|شرق|غرب|بحري|قبلي/g) || []).length || null;
        if (facadesNum) addLog(session, `🔍 الواجهات: استُنتج ${facadesNum} من streetFacades="${sf}"`);
      }
    }

    if (!facadesNum) {
      addLog(session, "⏭️ الواجهات المطلة: لا قيمة — تخطّي");
    } else {
      const optValue = facadesNumToValue(facadesNum);
      const optLabel = facadesNumToText(facadesNum);
      addLog(session, `🎯 الواجهات المطلة: ${facadesNum} → "${optLabel}" (value=${optValue})`);

      // ── البحث عن الـ select بخياراته الفريدة (مستقل عن اسم الحقل) ──────
      const selectorInfo = await session.page.evaluate(() => {
        const selects = Array.from(document.querySelectorAll("select"));
        const target = selects.find(s =>
          Array.from(s.options).some(o =>
            /واجهة واحدة|واجهتان/i.test(o.text),
          ),
        );
        if (!target) {
          const all = selects.map((s, i) => ({
            i, name: s.name, id: s.id,
            opts: Array.from(s.options).map(o => o.text.trim()).slice(0, 5),
          }));
          return { found: false as const, all };
        }
        return {
          found: true  as const,
          name: target.name || "",
          id:   target.id   || "",
          opts: Array.from(target.options).map(o => ({ v: o.value, t: o.text.trim() })),
        };
      });

      if (!selectorInfo.found) {
        addLog(session, `⚠️ الواجهات: select غير موجود — كل الـ selects: ${JSON.stringify((selectorInfo as any).all)}`);
      } else {
        addLog(session, `✅ الواجهات: وجدنا select name="${selectorInfo.name}" — خياراته: ${selectorInfo.opts.map(o => `"${o.t}"(${o.v})`).join(", ")}`);

        // اختر بالـ value الرقمي أولاً، ثم بالنص احتياطاً
        const xp = selectorInfo.name
          ? `xpath=//select[@name="${selectorInfo.name}"]`
          : (selectorInfo.id ? `#${selectorInfo.id}` : "select");

        // تحقق من وجود الخيار (value أو label)
        const exactOpt = selectorInfo.opts.find(o => o.v === optValue);
        const labelOpt = selectorInfo.opts.find(o =>
          o.t.replace(/\s+/g, " ").trim().includes(optLabel),
        );
        const chosenOpt = exactOpt ?? labelOpt ?? null;

        if (!chosenOpt) {
          addLog(session, `⚠️ الواجهات: الخيار "${optLabel}" غير موجود في القائمة`);
        } else {
          try {
            await session.page.locator(xp).selectOption({ value: chosenOpt.v });
            addLog(session, `✅ الواجهات: اختار "${chosenOpt.t}" (value=${chosenOpt.v})`);
            await session.page.waitForTimeout(500);
          } catch (e: any) {
            addLog(session, `⚠️ الواجهات: selectOption فشل — ${e.message}`);
            // محاولة بالنص مباشرة
            try {
              await session.page.locator(xp).selectOption({ label: chosenOpt.t });
              addLog(session, `✅ الواجهات: اختار بالنص "${chosenOpt.t}"`);
            } catch (e2: any) {
              addLog(session, `❌ الواجهات: فشل كلياً — ${e2.message}`);
            }
          }
        }
      }
    }
  }

  // ── المرافق (checkboxes) ─────────────────────────────────────────────────
  await fillUtilitiesCheckboxes(session, els, report);
}

// ─────────────────────────────────────────────────────────────────────────────
// تعبئة checkboxes "المرافق المتاحة" — تحقق مباشرة من النص المستخرج
// إذا كان اسم checkbox يطابق أي كلمة في report.utilities → ضع check
// كما تفحص DOM مباشرة لالتقاط mat-checkbox التي لم تُكتشف بـ scanElements
// ─────────────────────────────────────────────────────────────────────────────
async function fillUtilitiesCheckboxes(
  session: AutomationSession,
  els: any[],
  report: any,
): Promise<void> {
  if (!report.utilities) return;

  const utilsStr = String(report.utilities).toLowerCase();
  addLog(session, `🔧 تعبئة المرافق من النص: "${report.utilities}"`);

  // خريطة شاملة: [مفاتيح بحث في نص PDF] → [regex للـ checkbox]
  const utilMap: Array<{ keywords: RegExp; checkboxRx: RegExp; label: string }> = [
    { keywords: /كهرباء|electricity|electric/i,        checkboxRx: /كهرباء|electricity|electric|power/i,          label: "كهرباء" },
    { keywords: /مياه|ماء|water|drinking/i,             checkboxRx: /مياه|ماء|water|drinking/i,                    label: "مياه" },
    { keywords: /صرف|sewage|sewer|drainage/i,           checkboxRx: /صرف|sewage|sewer|drain/i,                     label: "صرف صحي" },
    { keywords: /غاز|gas/i,                             checkboxRx: /غاز|gas/i,                                    label: "غاز" },
    { keywords: /طرق|road|street|access/i,              checkboxRx: /طرق|road|street|access/i,                     label: "طرق" },
    { keywords: /هاتف|اتصالات|telephone|telecom|communication/i,
                                                        checkboxRx: /هاتف|اتصالات|telephone|telecom|comm/i,        label: "اتصالات" },
    { keywords: /إنترنت|انترنت|internet/i,              checkboxRx: /إنترنت|انترنت|internet/i,                     label: "إنترنت" },
    { keywords: /إضاءة|اضاءة|lighting|light/i,          checkboxRx: /إضاءة|اضاءة|lighting/i,                      label: "إضاءة" },
  ];

  const checkboxes = els.filter(e => e.type === "checkbox" || e.tag === "MAT-CHECKBOX");

  for (const util of utilMap) {
    const shouldCheck = util.keywords.test(utilsStr);

    // ابحث في els المكتشفة أولاً
    const cbEl = checkboxes.find(e => {
      const combined = `${e.formControlName ?? ""}|${e.name ?? ""}|${e.labelText ?? ""}|${e.ariaLabel ?? ""}`;
      return util.checkboxRx.test(combined);
    });

    if (cbEl) {
      await checkBox(session, buildSelector(cbEl), shouldCheck, `مرفق: ${util.label}`);
      continue;
    }

    // إذا لم يُعثر عليها في els → ابحث في DOM مباشرة
    if (shouldCheck) {
      const clicked = await session.page.evaluate((rx: string) => {
        const r = new RegExp(rx, "i");
        // ابحث في mat-checkbox وعناصر label
        const candidates = Array.from(document.querySelectorAll<HTMLElement>(
          "mat-checkbox, input[type='checkbox']"
        ));
        for (const el of candidates) {
          const lbl = el.textContent?.trim() ?? el.getAttribute("aria-label") ?? "";
          if (r.test(lbl)) {
            // إذا كان mat-checkbox انقر عليه
            const cb = el.querySelector<HTMLInputElement>("input[type='checkbox']") ?? el as any;
            if (!cb.checked) { el.click(); }
            return lbl;
          }
        }
        return null;
      }, util.checkboxRx.source).catch(() => null);

      if (clicked) {
        addLog(session, `✅ مرفق (DOM مباشر): ${util.label} — ${clicked}`);
      } else {
        addLog(session, `ℹ️ مرفق "${util.label}" غير موجود في الصفحة`);
      }
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// الدوال القديمة (محتفظ بها كمرجع — لم تعد تُستخدم في runAutomation)
// ─────────────────────────────────────────────────────────────────────────────
// دالة مساعدة للبحث عن عنصر — تبحث في كل الحقول المتاحة
function findEl(arr: any[], rx: RegExp): any {
  return arr.find(e => {
    const combined = [
      e.formControlName,
      e.name,
      e.id,
      e.placeholder,
      e.labelText,
      e.ariaLabel,
    ].join("|").toLowerCase();
    return rx.test(combined);
  });
}

// سجّل كل العناصر المكتشفة بشكل مفصّل
function logElements(session: AutomationSession, els: any[], pageLabel: string): void {
  addLog(session, `\n══ ${pageLabel}: ${els.length} عنصر ══`);
  els.forEach((el, i) => {
    const type = el.isMat ? "mat-select" : `${el.tag}[${el.type}]`;
    addLog(session,
      `[${i}] ${type} | fcn="${el.formControlName}" | name="${el.name}" | lbl="${el.labelText}" | ph="${el.placeholder}" | aria="${el.ariaLabel}"`,
    );
  });
  addLog(session, "══════════════════════════════════════\n");
}

async function fillPage1(session: AutomationSession, report: any, els: any[], pdfState: { pdfUploaded: boolean }): Promise<void> {
  logElements(session, els, "الصفحة 1 — البيانات الأساسية");

  const { page } = session;
  const inputs  = els.filter(e => e.tag === "INPUT" && !["file","radio","checkbox"].includes(e.type));
  const selects = els.filter(e => e.tag === "SELECT" || e.tag === "MAT-SELECT");

  // ── الغرض من التقييم ──────────────────────────────────────────────────────
  const purposeEl = findEl(selects,
    /purpose|غرض|valuation.?purpose|purposeid|valPurpose|valuationpurpose/i,
  );
  if (purposeEl) await selectAngular(session, buildSelector(purposeEl), report.valuationPurpose, "الغرض من التقييم", purposeEl.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «الغرض من التقييم»`);

  // ── فرضية القيمة ─────────────────────────────────────────────────────────
  const hypothesisEl = findEl(selects,
    /hypothesis|فرضية|premise|valuehypothesis|hypoth/i,
  );
  if (hypothesisEl) await selectAngular(session, buildSelector(hypothesisEl), report.valuationHypothesis, "فرضية القيمة", hypothesisEl.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «فرضية القيمة»`);

  // ── أساس القيمة ───────────────────────────────────────────────────────────
  const basisEl = findEl(selects,
    /basis|أساس|valuebasis|value.?basis|basisid|أساس.*قيمة/i,
  );
  if (basisEl) await selectAngular(session, buildSelector(basisEl), report.valuationBasis, "أساس القيمة", basisEl.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «أساس القيمة»`);

  // ── نوع التقرير (أزرار راديو) ────────────────────────────────────────────
  const reportTypeRadios = els.filter(
    (e: any) => e.tag === "INPUT" && e.type === "radio" && /report.?type/i.test(e.name ?? ""),
  );
  if (reportTypeRadios.length > 0 && report.reportType) {
    const rt = (report.reportType ?? "").trim();
    // ابحث عن أفضل تطابق: label أو value
    const target = reportTypeRadios.find((r: any) => {
      const lbl = (r.lbl ?? "").trim();
      const val = (r.value ?? "").trim();
      return lbl === rt || val === rt || lbl.includes(rt) || rt.includes(lbl);
    }) ?? reportTypeRadios[0]; // fallback: الخيار الأول (تقرير مفصل)
    try {
      const sel = buildSelector(target);
      await page.click(sel).catch(() =>
        page.evaluate((s: string) => {
          const el = document.querySelector(s) as HTMLElement | null;
          if (el) el.click();
        }, sel),
      );
      addLog(session, `✅ نوع التقرير: ${target.lbl || target.value || "الأول"}`);
    } catch (e: any) {
      addLog(session, `⚠️ تعذّر تحديد نوع التقرير: ${e.message}`);
    }
  } else if (reportTypeRadios.length === 0) {
    // جرّب البحث المباشر في الصفحة باستخدام name="report_type"
    const rCount = await page.$$eval(
      'input[type="radio"][name="report_type"]',
      (els) => els.length,
    ).catch(() => 0);
    if (rCount > 0 && report.reportType) {
      const rt = (report.reportType ?? "").trim();
      const clicked = await page.evaluate((rt: string) => {
        const radios = Array.from(
          document.querySelectorAll<HTMLInputElement>('input[type="radio"][name="report_type"]'),
        );
        const target = radios.find((r) => {
          const lbl = (r.closest("label")?.textContent ?? r.labels?.[0]?.textContent ?? "").trim();
          return lbl === rt || lbl.includes(rt) || rt.includes(lbl);
        }) ?? radios[0];
        if (target) { target.click(); return target.value || "ok"; }
        return null;
      }, rt);
      if (clicked) addLog(session, `✅ نوع التقرير [direct]: ${clicked}`);
      else addLog(session, `⚠️ تعذّر تحديد نوع التقرير من الصفحة`);
    } else {
      addLog(session, `⚠️ لم يُعثر على حقل «نوع التقرير»`);
    }
  }

  // ── رقم التقرير / عنوان التقرير ─────────────────────────────────────────
  const reportNumEl = findEl(inputs,
    /report.?num|report.?no|reportno|reportnumber|reportref|reporttitle|externalref|externalnum|refno|referencenum|referenceno|title|عنوان.*تقرير|تقرير.*عنوان|رقم.*تقرير|تقرير.*رقم|رقم.*طلب|رقم.*مرجع|رقم.*داخل|no\b/i,
  );
  if (reportNumEl) await fillAngular(session, buildSelector(reportNumEl), report.reportNumber, "عنوان/رقم التقرير");
  else addLog(session, `⚠️ لم يُعثر على حقل «عنوان/رقم التقرير» — جرّب الملء اليدوي`);

  // ── تاريخ إصدار التقرير ───────────────────────────────────────────────────
  const reportDateEl = findEl(inputs,
    /report.?date|reportdate|date.*report|تاريخ.*تقرير|تاريخ.*إصدار|تاريخ.*نشر|issuedate|publishdate/i,
  );
  if (reportDateEl) await fillDate(session, buildSelector(reportDateEl), report.reportDate, "تاريخ إصدار التقرير");
  else addLog(session, `⚠️ لم يُعثر على حقل «تاريخ إصدار التقرير»`);

  // ── تاريخ التقييم ─────────────────────────────────────────────────────────
  const valDateEl = findEl(inputs,
    /valuation.?date|valuationdate|date.*valuation|تاريخ.*تقييم|effectivedate|effectdate/i,
  );
  if (valDateEl) await fillDate(session, buildSelector(valDateEl), report.valuationDate, "تاريخ التقييم");

  // ── اسم العميل / الجهة المستفيدة ─────────────────────────────────────────
  const clientEl = findEl(inputs,
    /client.?name|clientname|customer.?name|customername|beneficiary|اسم.*عميل|عميل.*اسم|جهة.*مستفيدة|جهة.*طلب|اسم.*جهة|مستفيد/i,
  );
  if (clientEl) await fillAngular(session, buildSelector(clientEl), report.clientName, "اسم العميل");
  else addLog(session, `⚠️ لم يُعثر على حقل «اسم العميل»`);

  // ── البريد الإلكتروني ────────────────────────────────────────────────────
  const emailEl = findEl(inputs, /email|mail|بريد|ايميل/) ??
    els.find((e: any) => e.tag === "INPUT" && e.type === "email");
  if (emailEl) await fillAngular(session, buildSelector(emailEl), report.clientEmail, "البريد الإلكتروني");
  else addLog(session, `⚠️ لم يُعثر على حقل «البريد الإلكتروني»`);

  // ── رقم الهاتف ───────────────────────────────────────────────────────────
  const phoneEl = findEl(inputs,
    /phone|mobile|tel\b|contact.?num|هاتف|جوال|تلفون|تليفون/i,
  );
  if (phoneEl) await fillAngular(session, buildSelector(phoneEl), report.clientPhone, "رقم الهاتف");
  else addLog(session, `⚠️ لم يُعثر على حقل «رقم الهاتف»`);

  // ── المستخدم المقصود / الاستخدام المقصود ────────────────────────────────
  const userEl = findEl(inputs,
    /intended.?user|intendeduser|مستخدم.*مقصود|مقصود.*مستخدم|intended.?use|مستفيد.*مقصود/i,
  );
  if (userEl) await fillAngular(session, buildSelector(userEl), report.intendedUser, "المستخدم المقصود");

  // محاولة رفع PDF في الصفحة 1
  await uploadPdf(session, report, pdfState);
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 2 — معلومات الأصل + أسلوب التقييم + الموقع (Screens 3 & 4)
// ─────────────────────────────────────────────────────────────────────────────
async function fillPage2(session: AutomationSession, report: any, els: any[], pdfState: { pdfUploaded: boolean }): Promise<void> {
  logElements(session, els, "الصفحة 2 — معلومات الأصل والموقع");

  const inputs    = els.filter(e => e.tag === "INPUT" && !["file","radio","checkbox"].includes(e.type));
  const selects   = els.filter(e => e.tag === "SELECT" || e.tag === "MAT-SELECT");
  const checkboxes = els.filter(e => e.type === "checkbox");

  // ── نوع الأصل محل التقييم ─────────────────────────────────────────────────
  const propTypeEl = findEl(selects,
    /asset.?type|assettype|property.?type|propertytype|assetcategory|نوع.*أصل|نوع.*عقار|أصل.*نوع/i,
  );
  if (propTypeEl) await selectAngular(session, buildSelector(propTypeEl), report.propertyType, "نوع الأصل", propTypeEl.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «نوع الأصل»`);

  // ── استخدام / قطاع الأصل ─────────────────────────────────────────────────
  const propUseEl = findEl(selects,
    /^use$|usage|sector|assetuse|propertyuse|قطاع|استخدام|نوع.*استخدام/i,
  );
  if (propUseEl) await selectAngular(session, buildSelector(propUseEl), report.propertyUse, "استخدام الأصل", propUseEl.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «استخدام الأصل»`);

  // ── تاريخ المعاينة ────────────────────────────────────────────────────────
  const inspDateEl = findEl(inputs,
    /inspection.?date|inspectiondate|inspdate|visit.?date|معاينة|تاريخ.*معاينة|تاريخ.*زيارة|تاريخ.*فحص/i,
  );
  if (inspDateEl) await fillDate(session, buildSelector(inspDateEl), report.inspectionDate, "تاريخ المعاينة");
  else addLog(session, `⚠️ لم يُعثر على حقل «تاريخ المعاينة»`);

  // ── الرأي النهائي في القيمة ───────────────────────────────────────────────
  const finalValEl = findEl(inputs,
    /final.?value|finalvalue|final.?opinion|valuationresult|الرأي.*قيمة|رأي.*نهائي|القيمة.*نهائية|قيمة.*سوقية|قيمة.*تقييم/i,
  );
  if (finalValEl) await fillAngular(session, buildSelector(finalValEl), report.finalValue, "الرأي النهائي في القيمة");
  else addLog(session, `⚠️ لم يُعثر على حقل «الرأي النهائي»`);

  // ── أسلوب السوق (checkbox) ───────────────────────────────────────────────
  const marketCheckEl = findEl(checkboxes, /market|سوق|مقارن|comparable/i);
  if (marketCheckEl) {
    const useMarket = !!(report.valuationMethod && /سوق|market/i.test(report.valuationMethod));
    await checkBox(session, buildSelector(marketCheckEl), useMarket, "أسلوب السوق");
  }

  // ── قيمة أسلوب السوق (المعاملات المعارة) ────────────────────────────────
  const marketValEl = findEl(inputs,
    /market.?value|marketvalue|comparable.?value|comparablevalue|معاملات.*معارة|قيمة.*سوق/i,
  );
  if (marketValEl) await fillAngular(session, buildSelector(marketValEl), report.marketValue ?? report.finalValue, "قيمة أسلوب السوق");

  // ── أسلوب الدخل ──────────────────────────────────────────────────────────
  const incomeEl = findEl(selects,
    /income.?approach|incomeapproach|income.?method|دخل.*أسلوب|أسلوب.*دخل|طريقة.*دخل/i,
  );
  if (incomeEl) await selectAngular(session, buildSelector(incomeEl), "غير مستخدم", "أسلوب الدخل", incomeEl.isMat);

  // ── أسلوب التكلفة ────────────────────────────────────────────────────────
  const costEl = findEl(selects,
    /cost.?approach|costapproach|cost.?method|تكلفة.*أسلوب|أسلوب.*تكلفة|طريقة.*تكلفة/i,
  );
  if (costEl) await selectAngular(session, buildSelector(costEl), "مساعد لتقدير القيمة", "أسلوب التكلفة", costEl.isMat);

  // ── الدولة (ثابت: المملكة العربية السعودية) ──────────────────────────────
  const countryEl = findEl(selects,
    /country|countryid|دولة|بلد/i,
  );
  if (countryEl) await selectAngular(session, buildSelector(countryEl), "المملكة العربية السعودية", "الدولة", countryEl.isMat);

  // ── المنطقة ───────────────────────────────────────────────────────────────
  const regionEl = findEl(selects,
    /region|province|regionid|emirate|منطقة|محافظة|إمارة/i,
  );
  if (regionEl) await selectAngular(session, buildSelector(regionEl), report.region, "المنطقة", regionEl.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «المنطقة»`);

  // ── المدينة ───────────────────────────────────────────────────────────────
  const cityEl = findEl(selects, /city|cityid|مدينة|بلدية/) ??
    findEl(inputs, /city|cityid|مدينة|بلدية/);
  if (cityEl) await selectAngular(session, buildSelector(cityEl), report.city, "المدينة", cityEl?.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «المدينة»`);

  // ── الحي ─────────────────────────────────────────────────────────────────
  const districtEl = findEl(inputs,
    /district|neighborhood|districtname|حي|حي.*سكني|اسم.*حي/i,
  );
  if (districtEl) await fillAngular(session, buildSelector(districtEl), report.district, "الحي");

  // ── الشارع ────────────────────────────────────────────────────────────────
  const streetEl = findEl(inputs,
    /street|streetname|road|شارع|اسم.*شارع/i,
  );
  if (streetEl) await fillAngular(session, buildSelector(streetEl), report.street, "الشارع");

  // ── الإحداثيات ───────────────────────────────────────────────────────────
  let lat: string | null = null;
  let lng: string | null = null;
  if (report.coordinates) {
    const parts = String(report.coordinates).split(",").map((s: string) => s.trim());
    if (parts.length === 2) { lat = parts[0]; lng = parts[1]; }
  }
  const lngEl = findEl(inputs, /longitude|long\b|lng\b|خط.*طول|طول.*جغرافي/i);
  if (lngEl && lng) await fillAngular(session, buildSelector(lngEl), lng, "خط الطول");
  const latEl = findEl(inputs, /latitude|lat\b|خط.*عرض|عرض.*جغرافي/i);
  if (latEl && lat) await fillAngular(session, buildSelector(latEl), lat, "خط العرض");

  // محاولة رفع PDF في الصفحة 2 إن لم يرفع في الصفحة 1
  await uploadPdf(session, report, pdfState);
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 3 — البيانات الإضافية (Screen 5)
// ─────────────────────────────────────────────────────────────────────────────
async function fillPage3(session: AutomationSession, report: any, els: any[], pdfState: { pdfUploaded: boolean }): Promise<void> {
  logElements(session, els, "الصفحة 3 — البيانات الإضافية");

  const inputs    = els.filter(e => e.tag === "INPUT" && !["file","radio","checkbox"].includes(e.type));
  const selects   = els.filter(e => e.tag === "SELECT" || e.tag === "MAT-SELECT");
  const checkboxes = els.filter(e => e.type === "checkbox");
  const { page } = session;

  // ── رقم الصك / سند الملكية ───────────────────────────────────────────────
  const deedEl = findEl(inputs,
    /deed|deednum|deed.?number|titlenum|title.?number|صك|سند|رقم.*صك|رقم.*سند/i,
  );
  if (deedEl) await fillAngular(session, buildSelector(deedEl), report.deedNumber, "رقم الصك");
  else addLog(session, `⚠️ لم يُعثر على حقل «رقم الصك»`);

  // ── نوع الملكية ───────────────────────────────────────────────────────────
  const ownerTypeEl = findEl(selects,
    /ownership.?type|ownershiptype|ownership|ملكية|نوع.*ملكية/i,
  );
  if (ownerTypeEl) await selectAngular(session, buildSelector(ownerTypeEl), report.ownershipType, "نوع الملكية", ownerTypeEl.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «نوع الملكية»`);

  // ── الاتجاهات المطلة على الشارع ──────────────────────────────────────────
  const facadeEl = findEl(selects,
    /facade|direction|frontage|street.?dir|اتجاه|مطلة|واجهة|جهات/i,
  );
  if (facadeEl) await selectAngular(session, buildSelector(facadeEl), report.streetFacades, "الاتجاهات المطلة", facadeEl.isMat);

  // المرافق (checkboxes) — نُحدد المرافق الموجودة في `report.utilities`
  await fillUtilitiesCheckboxes(session, els, report);

  // ── مساحة الأرض (م²) ─────────────────────────────────────────────────────
  const landEl = findEl(inputs,
    /land.?area|landarea|plot.?area|plotarea|مساحة.*أرض|مساحة.*قطعة|مساحة.*أرضية/i,
  );
  if (landEl) await fillAngular(session, buildSelector(landEl), report.landArea, "مساحة الأرض");
  else addLog(session, `⚠️ لم يُعثر على حقل «مساحة الأرض»`);

  // ── مساحة مسطحات البناء ───────────────────────────────────────────────────
  const buildEl = findEl(inputs,
    /building.?area|buildingarea|floor.?area|floorarea|gross.?area|بناء.*مساحة|مساحة.*بناء|مساحة.*مسطحات/i,
  );
  if (buildEl) await fillAngular(session, buildSelector(buildEl), report.buildingArea, "مساحة البناء");

  // ── مساحة البناء المصرح بها (نسبة مئوية) ────────────────────────────────
  // القاعدة: استخدام/قطاع الأصل = سكني → 60% ، غير ذلك → 80%
  const ratioEl = findEl(inputs,
    /مساحة.*بناء.*مصرح|مصرح.*بناء|نسبة.*بناء|نسبة.*مصرح|ratio|buildratio|permitratio|permit.?ratio|building.?ratio/i,
  );
  if (ratioEl) {
    const buildRatio = /سكن/i.test(report.propertyUse ?? "") ? "60" : "80";
    addLog(session, `ℹ️ مساحة البناء المصرح بها: ${buildRatio}% (استخدام: ${report.propertyUse ?? "غير محدد"})`);
    await fillAngular(session, buildSelector(ratioEl), buildRatio, "مساحة البناء المصرح بها (نسبة مئوية)");
  } else {
    addLog(session, "⚠️ لم يُعثر على حقل «مساحة البناء المصرح بها (نسبة مئوية)»");
  }

  // ── عدد الأدوار المصرح به ────────────────────────────────────────────────
  const floorsEl = findEl(inputs,
    /floor.?count|floorcount|floors|num.?floor|أدوار|عدد.*أدوار|طوابق|عدد.*طوابق/i,
  );
  if (floorsEl) await fillAngular(session, buildSelector(floorsEl), report.permittedFloorsCount ?? report.floorsCount, "عدد الأدوار");

  // ── حالة البناء ───────────────────────────────────────────────────────────
  const buildStatusEl = findEl(selects,
    /building.?status|buildingstatus|construction.?status|حالة.*بناء|حالة.*إنشاء/i,
  );
  if (buildStatusEl) await selectAngular(session, buildSelector(buildStatusEl), report.buildingStatus, "حالة البناء", buildStatusEl.isMat);
  else addLog(session, `⚠️ لم يُعثر على حقل «حالة البناء»`);

  // ── نوع العقار الفرعي ────────────────────────────────────────────────────
  const subTypeEl = findEl(selects,
    /sub.?type|subtype|property.?subtype|asset.?sub|نوع.*فرعي|نوع.*صبي|فرعي/i,
  );
  if (subTypeEl) await selectAngular(session, buildSelector(subTypeEl), report.propertySubType, "نوع العقار الفرعي", subTypeEl.isMat);

  // ── عمر الأصل ─────────────────────────────────────────────────────────────
  const ageEl = findEl(inputs,
    /^age$|building.?age|buildingage|construction.?year|عمر.*أصل|عمر.*مبنى|سنة.*بناء/i,
  );
  if (ageEl) await fillAngular(session, buildSelector(ageEl), report.buildingAge, "عمر الأصل");

  // ── عرض الشارع ───────────────────────────────────────────────────────────
  const swEl = findEl(inputs,
    /street.?width|streetwidth|road.?width|عرض.*شارع|عرض.*طريق/i,
  );
  if (swEl) await fillAngular(session, buildSelector(swEl), report.streetWidth, "عرض الشارع");

  // ── عدد الواجهات ─────────────────────────────────────────────────────────
  // محسوب تلقائياً من جدول الحدود والأطوال (عدد الحدود التي وصفها "شارع")
  if (report.facadesCount != null) {
    const facCntEl = findEl(inputs,
      /facades?.?count|facadescount|frontages?.?count|number.?of.?facades|عدد.*واجهات|واجهات.*عدد/i,
    ) ?? findEl(selects,
      /facades?.?count|facadescount|frontages?.?count|number.?of.?facades|عدد.*واجهات|واجهات.*عدد/i,
    );
    if (facCntEl) {
      if (facCntEl.tag === "MAT-SELECT" || facCntEl.tag === "SELECT" || facCntEl.isMat) {
        await selectAngular(session, buildSelector(facCntEl), String(report.facadesCount), "عدد الواجهات", facCntEl.isMat);
      } else {
        await fillAngular(session, buildSelector(facCntEl), report.facadesCount, "عدد الواجهات");
      }
    } else addLog(session, `ℹ️ لم يُعثر على حقل «عدد الواجهات» (facadesCount=${report.facadesCount})`);
  }

  // ── نوع المبنى ────────────────────────────────────────────────────────────
  if (report.buildingType) {
    const bldTypeEl = findEl(selects,
      /building.?type|buildingtype|asset.?type|property.?type|نوع.*مبنى|نوع.*أصل|نوع.*عقار/i,
    );
    if (bldTypeEl) await selectAngular(session, buildSelector(bldTypeEl), report.buildingType, "نوع المبنى", bldTypeEl.isMat);
    else addLog(session, `ℹ️ لم يُعثر على حقل «نوع المبنى»`);
  }

  // ── حالة التشطيب ─────────────────────────────────────────────────────────
  if (report.finishingStatus) {
    const finEl = findEl(selects,
      /finishing.?status|finish.?status|finishingstatus|حالة.*تشطيب|تشطيب/i,
    );
    if (finEl) await selectAngular(session, buildSelector(finEl), report.finishingStatus, "حالة التشطيب", finEl.isMat);
    else addLog(session, `ℹ️ لم يُعثر على حقل «حالة التشطيب»`);
  }

  // ── حالة التأثيث ─────────────────────────────────────────────────────────
  if (report.furnitureStatus) {
    const furEl = findEl(selects,
      /furniture.?status|furnishing|furnished|حالة.*تأثيث|تأثيث|مؤثث/i,
    );
    if (furEl) await selectAngular(session, buildSelector(furEl), report.furnitureStatus, "حالة التأثيث", furEl.isMat);
    else addLog(session, `ℹ️ لم يُعثر على حقل «حالة التأثيث»`);
  }

  // ── نوع التكييف ───────────────────────────────────────────────────────────
  if (report.airConditioningType) {
    const acEl = findEl(selects,
      /air.?condition|aircondition|cooling|تكييف|تبريد/i,
    );
    if (acEl) await selectAngular(session, buildSelector(acEl), report.airConditioningType, "التكييف", acEl.isMat);
    else addLog(session, `ℹ️ لم يُعثر على حقل «التكييف»`);
  }

  // ── الأرض مستأجرة ────────────────────────────────────────────────────────
  if (report.isLandRented) {
    const rentedYes = report.isLandRented.trim() === "نعم";
    try {
      const rentedRadios = await page.$$('input[type="radio"]');
      for (const radio of rentedRadios) {
        const val = await radio.getAttribute("value");
        const lbl = await radio.evaluate((el: Element) => {
          const label = el.closest("label") || document.querySelector(`label[for="${(el as HTMLInputElement).id}"]`);
          return label ? label.textContent?.trim() : "";
        });
        const isLandLabel = /land.?rent|أرض.*مستأجر|مستأجر.*أرض/i.test(lbl || "");
        if (isLandLabel) {
          if ((rentedYes && (val === "true" || val === "1")) || (!rentedYes && (val === "false" || val === "0"))) {
            await radio.check();
            addLog(session, `✅ الأرض مستأجرة: ${report.isLandRented}`);
            break;
          }
        }
      }
    } catch {
      addLog(session, `⚠️ فشل تحديد حقل «الأرض مستأجرة»`);
    }
  }

  // ── الميزات الإضافية ─────────────────────────────────────────────────────
  if (report.additionalFeatures) {
    const features = report.additionalFeatures.split(/،|,/).map((f: string) => f.trim()).filter(Boolean);
    for (const feat of features) {
      try {
        const checkboxes = await page.$$('input[type="checkbox"]');
        for (const cb of checkboxes) {
          const lbl = await cb.evaluate((el: Element) => {
            const label = el.closest("label") || document.querySelector(`label[for="${(el as HTMLInputElement).id}"]`);
            return label ? label.textContent?.trim() : (el as HTMLInputElement).value || "";
          });
          if (lbl && lbl.includes(feat)) {
            const isChecked = await cb.isChecked();
            if (!isChecked) await cb.check();
            addLog(session, `✅ ميزة إضافية: ${feat}`);
            break;
          }
        }
      } catch {
        addLog(session, `⚠️ فشل تفعيل ميزة: ${feat}`);
      }
    }
  }

  // ── أفضل استخدام ──────────────────────────────────────────────────────────
  const isBestUse = !report.isBestUse || report.isBestUse.trim() === "نعم";
  try {
    const allRadios = await page.$$('input[type="radio"]');
    for (const radio of allRadios) {
      const val = await radio.getAttribute("value");
      const lbl = await radio.evaluate((el: Element) => {
        const label = el.closest("label") || document.querySelector(`label[for="${(el as HTMLInputElement).id}"]`);
        return label ? label.textContent?.trim() : "";
      });
      const isBestUseField = /best.?use|أفضل.*استخدام|استخدام.*أفضل/i.test(lbl || "");
      if (isBestUseField) {
        if ((isBestUse && (val === "true" || val === "1")) || (!isBestUse && (val === "false" || val === "0"))) {
          await radio.check();
          addLog(session, `✅ أفضل استخدام: ${isBestUse ? "نعم" : "لا"}`);
          break;
        }
      }
    }
    if (!allRadios.length) {
      const bestUseYes = await page.$('input[type="radio"][value="true"], input[type="radio"][value="1"]');
      if (bestUseYes) {
        await bestUseYes.check();
        addLog(session, `✅ أفضل استخدام (fallback): نعم`);
      }
    }
  } catch {
    addLog(session, `⚠️ لم يُحدَّد خيار أفضل استخدام`);
  }

  // محاولة رفع PDF في الصفحة 3 إن لم يرفع سابقاً
  await uploadPdf(session, report, pdfState);
}

// ─────────────────────────────────────────────────────────────────────────────
// رفع ملف PDF — يُستدعى في كل صفحة، يتوقف بمجرد النجاح
// ─────────────────────────────────────────────────────────────────────────────
async function uploadPdf(
  session: AutomationSession,
  report: any,
  state: { pdfUploaded: boolean },
): Promise<void> {
  // مجلد التنزيلات الافتراضي على جهاز Windows
  const DOWNLOADS_DIR = "C:\\Users\\Barcode Users\\Downloads";

  // ── إيجاد مسار ملف PDF ───────────────────────────────────────────────────
  function findPdfInDownloads(reportNum: string): string | null {
    if (!reportNum || !fs.existsSync(DOWNLOADS_DIR)) return null;
    try {
      const exact = path.join(DOWNLOADS_DIR, `${reportNum}.pdf`);
      if (fs.existsSync(exact)) return exact;
      const files = fs.readdirSync(DOWNLOADS_DIR)
        .filter(f => f.toLowerCase().startsWith(reportNum.toLowerCase()) && f.toLowerCase().endsWith(".pdf"))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(DOWNLOADS_DIR, f)).mtimeMs }))
        .sort((a, b) => b.mtime - a.mtime);
      return files.length > 0 ? path.join(DOWNLOADS_DIR, files[0].name) : null;
    } catch { return null; }
  }

  let resolvedPath: string = report.pdfFilePath ?? "";

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    const reportNum = (report.reportNumber ?? "").trim();
    const fallback = reportNum ? findPdfInDownloads(reportNum) : null;
    if (fallback) {
      addLog(session, `📂 تم إيجاد ملف PDF: ${path.basename(fallback)}`);
      resolvedPath = fallback;
    } else {
      if (resolvedPath) addLog(session, `⚠️ ملف PDF غير موجود: ${resolvedPath}`);
      else addLog(session, "⚠️ لا يوجد مسار PDF — تجاوز رفع الملف.");
      return;
    }
  }

  const { page } = session;
  const filePath = resolvedPath;
  const fileName = path.basename(filePath);
  addLog(session, `📎 رفع PDF: ${fileName}`);

  // ── فحص وجود حقل file في الصفحة ─────────────────────────────────────────
  const fileInputs = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).map(el => ({
      name: el.name, id: el.id, accept: el.accept,
    }))
  ).catch(() => [] as { name: string; id: string; accept: string }[]);

  if (fileInputs.length === 0) {
    addLog(session, "⏭️ لا يوجد حقل رفع ملف في هذه الصفحة");
    return;
  }
  fileInputs.forEach((f, i) => addLog(session, `  [file${i}] name="${f.name}" accept="${f.accept}"`));

  // المحدد المفضل: report_file أو أول input[type=file]
  const preferredName = fileInputs.find(f => f.name === "report_file")?.name ?? fileInputs[0].name;
  const fileSel = preferredName ? `input[name="${preferredName}"]` : 'input[type="file"]';

  // ══ الطريقة 1: إظهار الحقل ثم FileChooser (الأكثر موثوقية مع Angular) ════
  addLog(session, `  ↳ [1] FileChooser مع إظهار الحقل: ${fileSel}`);
  try {
    await page.evaluate((sel) => {
      const inp = document.querySelector<HTMLInputElement>(sel);
      if (inp) inp.style.cssText = "display:block!important;opacity:1!important;" +
        "position:fixed!important;top:10px!important;left:10px!important;" +
        "width:150px!important;height:50px!important;z-index:999999!important;";
    }, fileSel);
    await page.waitForTimeout(400);

    const [fc] = await Promise.all([
      page.waitForEvent("filechooser", { timeout: 5000 }),
      page.click(fileSel, { force: true }),
    ]);
    await fc.setFiles(filePath);
    await page.waitForTimeout(1200);

    // أعد الإخفاء
    await page.evaluate((sel) => {
      const inp = document.querySelector<HTMLInputElement>(sel);
      if (inp) inp.style.cssText = "";
    }, fileSel).catch(() => {});

    addLog(session, `✅ تم رفع PDF [1-FileChooser]: ${fileName}`);
    state.pdfUploaded = true;
    return;
  } catch (e: any) {
    addLog(session, `  ↳ [1] فشل: ${e.message}`);
    await page.evaluate((sel) => {
      const inp = document.querySelector<HTMLInputElement>(sel);
      if (inp) inp.style.cssText = "";
    }, fileSel).catch(() => {});
  }

  // ══ الطريقة 2: setInputFiles مباشرة + dispatch AngularEvents ═══════════
  addLog(session, `  ↳ [2] setInputFiles مباشرة: ${fileSel}`);
  try {
    // كشف الحقل أولاً حتى لا يرفض Playwright الحقول المخفية
    await page.evaluate((sel) => {
      const inp = document.querySelector<HTMLInputElement>(sel);
      if (inp) { inp.removeAttribute("hidden"); inp.style.display = "block"; }
    }, fileSel);

    await page.setInputFiles(fileSel, filePath);
    await page.waitForTimeout(600);

    // أطلق أحداث Angular
    await page.evaluate((sel) => {
      const inp = document.querySelector<HTMLInputElement>(sel);
      if (!inp) return;
      inp.dispatchEvent(new Event("input",  { bubbles: true }));
      inp.dispatchEvent(new Event("change", { bubbles: true }));
    }, fileSel);
    await page.waitForTimeout(800);

    // تحقق من الرفع بالنظر لاسم الملف المعروض أو files.length
    const verified = await page.evaluate((sel) => {
      const inp = document.querySelector<HTMLInputElement>(sel);
      return (inp?.files?.length ?? 0) > 0;
    }, fileSel).catch(() => false);

    if (verified) {
      addLog(session, `✅ تم رفع PDF [2-setInputFiles]: ${fileName}`);
      state.pdfUploaded = true;
      return;
    }
    addLog(session, `  ↳ [2] files.length=0 بعد setInputFiles`);
  } catch (e: any) {
    addLog(session, `  ↳ [2] فشل: ${e.message}`);
  }

  // ══ الطريقة 3: FileChooser عبر label أو زر رفع ═════════════════════════
  addLog(session, `  ↳ [3] FileChooser عبر label/button`);
  const rfId = await page.$eval(fileSel, (el) => el.id ?? "").catch(() => "");
  const clickTargets = [
    ...(rfId ? [`label[for="${rfId}"]`] : []),
    'label:has-text("ملف")',
    'button:has-text("رفع")',
    'button:has-text("اختر")',
    'button:has-text("Browse")',
    '[class*="upload"]:not(input)',
    '[class*="file"]:not(input)',
  ];
  for (const sel of clickTargets) {
    const el = await page.$(sel).catch(() => null);
    if (!el) continue;
    addLog(session, `  ↳ [3] جرب: ${sel}`);
    try {
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 3000 }),
        el.click({ force: true }),
      ]);
      await fc.setFiles(filePath);
      await page.waitForTimeout(800);
      addLog(session, `✅ تم رفع PDF [3-label/button]: ${fileName}`);
      state.pdfUploaded = true;
      return;
    } catch { /* جرّب التالي */ }
  }

  addLog(session, "⚠️ لم يُرفع PDF — المتابعة بدونه");
}

// ─────────────────────────────────────────────────────────────────────────────
// إرسال النموذج المحفوظ يدوياً (للاستخدام المستقبلي)
// ─────────────────────────────────────────────────────────────────────────────
export async function submitSavedForm(reportId: number): Promise<void> {
  const context = await getAuthenticatedContext();
  if (!context) throw new Error("لا توجد جلسة مسجّلة.");
  const pages = context.pages();
  const formPage = pages.find(p => p.url().includes("/report/"));
  if (!formPage) throw new Error("لم يتم العثور على صفحة النموذج المفتوحة.");
  await formPage.click('button:has-text("إرسال التقرير")');
  await formPage.waitForLoadState("networkidle", { timeout: 30000 });
  await updateReport(reportId, {
    status: "submitted",
    automationStatus: "completed",
    taqeemSubmittedAt: new Date().toISOString(),
  });
}
