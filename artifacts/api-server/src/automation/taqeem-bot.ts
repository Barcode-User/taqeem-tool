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
import { getAuthenticatedContext } from "./taqeem-session-store";
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
  const context = await getAuthenticatedContext();
  if (!context) {
    throw new Error("لا توجد جلسة مسجّلة. يرجى تسجيل الدخول أولاً من صفحة الإعدادات.");
  }

  const sessionId = randomUUID();
  const page = await context.newPage();
  const session = createSession(sessionId, reportId, null as any, context, page);

  await updateReport(reportId, {
    automationStatus: "running",
    automationError: null,
    automationSessionId: sessionId,
  });

  runAutomation(session, reportId).catch(async (err) => {
    addLog(session, `Fatal error: ${err.message}`);
    await updateReport(reportId, { automationStatus: "failed", automationError: err.message });
    try { await page.close(); } catch {}
    closeSession(sessionId);
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
    addLog(session, `✅ الصفحة 1 جاهزة: ${page.url()}`);

    const pdfState = { pdfUploaded: false };
    const elsPage1 = await scanElements(page);
    await saveDebug(reportId, "page1", elsPage1);
    await screenshot(page, `p1_before_${reportId}`);
    addLog(session, `📋 عدد حقول الصفحة 1: ${elsPage1.length}`);

    await fillFormPage(session, report, elsPage1, pdfState);

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
    await screenshot(page, `p2_after_${reportId}`);

    // ── ضغط زر "continue" للانتقال للصفحة 3 ──────────────────────────────
    const urlBeforePage3 = page.url();
    await clickContinueButton(session);

    // ── انتظار الانتقال لـ /report/attribute/create/{taqeemReportId} ──────
    addLog(session, "⏳ انتظار الانتقال لصفحة السمات...");
    const expectedPage3 = `${TAQEEM_URL}/report/attribute/create/${taqeemReportId}`;

    await page
      .waitForURL(`${TAQEEM_URL}/report/attribute/create/**`, { timeout: 25000 })
      .catch(async () => {
        // fallback: انتظر أي تغيير في URL
        await page.waitForFunction(
          (prev: string) => window.location.href !== prev,
          urlBeforePage3,
          { timeout: 25000 },
        ).catch(() => {});
      });

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(1500);

    // ── تحقق من تطابق الرقم في صفحة 3 ───────────────────────────────────
    const page3ActualUrl = page.url();
    addLog(session, `🔗 URL الصفحة 3 الفعلي: ${page3ActualUrl}`);
    addLog(session, `🔗 URL الصفحة 3 المتوقع: ${expectedPage3}`);

    if (!page3ActualUrl.includes(`/report/attribute/create/${taqeemReportId}`)) {
      addLog(session, `⚠️ عدم تطابق — ID الفعلي في URL: ${page3ActualUrl.match(/\/(\d+)$/)?.[1] ?? "غير موجود"}`);
      addLog(session, `↩️ التنقل المباشر لصفحة السمات بـ ID الصحيح: ${taqeemReportId}`);
      await page.goto(expectedPage3, { waitUntil: "networkidle", timeout: 30000 });
      await page.waitForTimeout(1500);
    }
    addLog(session, `✅ تأكيد URL الصفحة 3 [ID: ${taqeemReportId}]: ${page.url()}`);

    // ════════════════════════════════════════════════════════════════════════
    // الصفحة 3: /report/attribute/create/{taqeemReportId}
    // البيانات الإضافية وسمات الأصل
    // ════════════════════════════════════════════════════════════════════════
    addLog(session, "═══════════════════════════════════════════════");
    addLog(session, `▶ الصفحة 3 [ID: ${taqeemReportId}]: السمات والبيانات الإضافية`);
    addLog(session, "═══════════════════════════════════════════════");

    const elsPage3 = await scanElements(page);
    await saveDebug(reportId, "page3", elsPage3);
    await screenshot(page, `p3_before_${reportId}`);
    addLog(session, `📋 عدد حقول الصفحة 3: ${elsPage3.length}`);

    await fillAttributePage(session, report, elsPage3);
    await screenshot(page, `p3_after_${reportId}`);

    // ── ضغط زر "continue" — صفحة المراجعة ───────────────────────────────
    await clickContinueButton(session);
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

// تحويل التاريخ إلى DD/MM/YYYY
function formatDate(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = raw.trim();
  if (/^\d{1,2}\/\d{1,2}\/\d{4}$/.test(s)) return s;
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  return s;
}

// تعبئة حقل نصي (Angular-safe) — يستخدم page.fill() + keyboard كاحتياط
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
    await page.waitForSelector(selector, { timeout: 4000 });

    // طريقة 1: page.fill — أفضل طريقة مع Angular (تُطلق input events تلقائياً)
    try {
      await page.click(selector);
      await page.waitForTimeout(100);
      await page.fill(selector, val);
      // أضف Angular events يدوياً
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

    // طريقة 2: keyboard typing — احتياطية
    await page.click(selector, { clickCount: 3 });
    await page.waitForTimeout(100);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type(val, { delay: 30 });
    await page.keyboard.press("Tab");
    addLog(session, `✅ ${label}: ${val} (keyboard)`);
  } catch (err: any) {
    addLog(session, `⚠️ لم يُعبَّأ "${label}": ${(err as Error).message}`);
  }
}

// تعبئة حقل تاريخ
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
    await page.waitForSelector(selector, { timeout: 3000 });
    await page.click(selector);
    await page.waitForTimeout(150);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Delete");
    await page.keyboard.type(formatted, { delay: 50 });
    await page.keyboard.press("Escape");
    await page.waitForTimeout(150);
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
  } catch {
    addLog(session, `⚠️ لم يُعبَّأ تاريخ "${label}"`);
  }
}

// اختيار من قائمة منسدلة — يدعم native select و mat-select
async function selectAngular(
  session: AutomationSession, selector: string,
  value: string | null | undefined, label: string,
  isMat = false,
): Promise<void> {
  if (!value || value.trim() === "") {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }
  const { page } = session;

  // ── محاولة 1: native HTML select ──────────────────────────────────────────
  if (!isMat) {
    try {
      await page.waitForSelector(selector, { timeout: 2000 });
      // جرّب بالنص أولاً ثم بالقيمة
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

  // ── محاولة 2: Angular Material mat-select ─────────────────────────────────
  try {
    await page.waitForSelector(selector, { timeout: 2000 });
    // افتح القائمة بالنقر
    await page.click(selector);
    // انتظر ظهور panel الخيارات
    await page.waitForSelector(
      "mat-option, .mat-option, .mat-mdc-option",
      { timeout: 3000 },
    );
    await page.waitForTimeout(300);

    // جرّب إيجاد الخيار بالنص المطابق
    const clicked = await page.evaluate((val: string) => {
      const options = Array.from(
        document.querySelectorAll("mat-option, .mat-option, .mat-mdc-option"),
      );
      const target = options.find(opt => {
        const text = opt.textContent?.trim() ?? "";
        return text === val || text.includes(val) || val.includes(text);
      }) as HTMLElement | undefined;
      if (target) { target.click(); return true; }
      return false;
    }, value);

    if (clicked) {
      await page.waitForTimeout(300);
      addLog(session, `✅ ${label}: ${value} (mat-select)`);
      return;
    }

    // إذا لم يُعثر على الخيار بالضبط → سجّل الخيارات المتاحة
    const available = await page.evaluate(() =>
      Array.from(document.querySelectorAll("mat-option, .mat-option, .mat-mdc-option"))
        .map(o => o.textContent?.trim() ?? ""),
    );
    addLog(session, `⚠️ الخيار "${value}" غير موجود في "${label}" — المتاح: ${available.slice(0, 8).join(" | ")}`);
    // أغلق القائمة
    await page.keyboard.press("Escape");
  } catch {
    addLog(session, `⚠️ لم يُحدَّد "${label}": ${value}`);
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
      await page.waitForTimeout(150);
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

// ضغط زر "حفظ واستمرار"
async function clickSaveAndContinue(session: AutomationSession): Promise<void> {
  const { page } = session;
  addLog(session, "🖱️ ضغط «حفظ واستمرار»...");

  const btnSelectors = [
    'button:has-text("حفظ واستمرار")',
    'button:has-text("حفظ و استمرار")',
    'button:has-text("Save & Continue")',
    'button:has-text("Save")',
    'button[type="submit"]',
    'input[type="submit"]',
  ];

  for (const sel of btnSelectors) {
    try {
      const btn = await page.$(sel);
      if (!btn) continue;

      // تأكد من أن الزر مرئي وقابل للنقر
      const isVisible = await btn.isVisible().catch(() => false);
      const isEnabled = await btn.isEnabled().catch(() => false);
      if (!isVisible || !isEnabled) continue;

      await btn.scrollIntoViewIfNeeded().catch(() => {});
      await btn.click();
      await page.waitForTimeout(800); // انتظر بسيط ثم waitForPageTransition يتولى الباقي
      addLog(session, `✅ تم الضغط على الزر: ${sel}`);
      return;
    } catch { /* جرّب التالي */ }
  }

  // محاولة أخيرة: ابحث في الصفحة بالنص العربي مباشرة
  try {
    const clicked = await page.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button, input[type='submit']"));
      const target = btns.find(b => {
        const t = (b.textContent ?? (b as HTMLInputElement).value ?? "").trim();
        return t.includes("حفظ") || t.includes("Save") || t.includes("استمرار");
      }) as HTMLElement | undefined;
      if (target) { target.click(); return true; }
      return false;
    });
    if (clicked) {
      await page.waitForTimeout(800);
      addLog(session, "✅ تم الضغط على زر الحفظ (بحث مباشر)");
      return;
    }
  } catch { /* تجاهل */ }

  addLog(session, "⚠️ لم يُعثر على زر «حفظ واستمرار» — المتابعة بدون ضغط");
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
      // تجاهل زر "save" إذا وُجد continue
      const cont = all.find(b => {
        const v = ((b as HTMLInputElement).name ?? "").toLowerCase();
        return v === "continue";
      });
      const target = cont ?? all[all.length - 1];
      if (target) { target.click(); return (target as HTMLInputElement).name ?? "?"; }
      return null;
    });
    if (clicked) {
      addLog(session, `✅ تم الضغط (آخر زر submit): name="${clicked}"`);
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

  // ── اسم المقيم (أول خيار متاح إذا لم يكن محدداً) ───────────────────────
  if (report.valuerName) {
    await selectByName("valuer[0][id]", report.valuerName, "اسم المقيم");
  } else {
    // اختر الخيار الأول المتاح
    try {
      await session.page.evaluate(() => {
        const sel = document.querySelector<HTMLSelectElement>('[name="valuer[0][id]"]');
        if (sel && sel.options.length > 1) {
          sel.selectedIndex = 1;
          sel.dispatchEvent(new Event("change", { bubbles: true }));
        }
      });
      addLog(session, "✅ اسم المقيم: اختيار تلقائي (أول خيار)");
    } catch { addLog(session, "⚠️ لم يُحدد اسم المقيم"); }
  }

  // ── نسبة المساهمة (افتراضي 100%) ─────────────────────────────────────────
  await selectByName("valuer[0][contribution]", report.valuerContribution ?? "100%", "نسبة المساهمة");

  // ── رفع PDF ───────────────────────────────────────────────────────────────
  await uploadPdf(session, report, pdfState);
}

// تعبئة native select بالـ name مباشرة (بالنص أو بالقيمة)
async function selectNativeByName(
  session: AutomationSession,
  name: string,
  value: string | null | undefined,
  label: string,
): Promise<void> {
  if (!value || value.trim() === "") {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }
  const sel = `[name="${name}"]`;
  try {
    await session.page.waitForSelector(sel, { timeout: 3000 });
    // حاول بالنص ثم بالقيمة
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
    // إذا لم يطابق بالضبط، ابحث جزئياً
    const matched = await session.page.evaluate(
      (args: { sel: string; val: string }) => {
        const el = document.querySelector<HTMLSelectElement>(args.sel);
        if (!el) return null;
        const opt = Array.from(el.options).find(o =>
          o.text.trim().includes(args.val) || args.val.includes(o.text.trim()),
        );
        if (opt) {
          el.value = opt.value;
          el.dispatchEvent(new Event("change", { bubbles: true }));
          return opt.text;
        }
        return null;
      },
      { sel, val: value },
    );
    if (matched) {
      addLog(session, `✅ ${label}: ${matched} (مطابقة جزئية)`);
    } else {
      addLog(session, `⚠️ "${label}": الخيار "${value}" غير موجود`);
    }
  } catch {
    addLog(session, `⚠️ لم يُحدَّد "${label}"`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 2: /report/asset/create/{id}
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

  // ── استخدام/قطاع الأصل ───────────────────────────────────────────────────
  const assetUseEl = byName("asset_use_id") ?? byName("property_use_id") ??
    byLabel(/usage|sector|استخدام|قطاع/i);
  if (assetUseEl) {
    await (assetUseEl.isMat
      ? selectAngular(session, buildSelector(assetUseEl), report.propertyUse, "استخدام الأصل", true)
      : selectNativeByName(session, assetUseEl.name || "", report.propertyUse, "استخدام الأصل"));
  }

  // ── تاريخ المعاينة ────────────────────────────────────────────────────────
  const inspEl = byName("inspection_date") ?? byName("inspected_at") ??
    byLabel(/inspection.?date|معاينة|تاريخ.*معاينة/i);
  if (inspEl) await fillDate(session, buildSelector(inspEl), report.inspectionDate, "تاريخ المعاينة");
  else addLog(session, "⚠️ لم يُعثر على «تاريخ المعاينة»");

  // ── أسلوب التقييم (checkbox أو select) ──────────────────────────────────
  const methodEl = byName("valuation_method_id") ??
    byLabel(/method|approach|أسلوب.*تقييم|طريقة/i);
  if (methodEl && (methodEl.tag === "SELECT" || methodEl.tag === "MAT-SELECT")) {
    await (methodEl.isMat
      ? selectAngular(session, buildSelector(methodEl), report.valuationMethod, "أسلوب التقييم", true)
      : selectNativeByName(session, methodEl.name || "", report.valuationMethod, "أسلوب التقييم"));
  }

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

  // ── الإحداثيات ───────────────────────────────────────────────────────────
  if (report.coordinates) {
    const parts = String(report.coordinates).split(",").map((s: string) => s.trim());
    if (parts.length === 2) {
      const latEl = byName("lat") ?? byName("latitude") ?? byLabel(/lat\b|خط.*عرض/i);
      const lngEl = byName("lng") ?? byName("longitude") ?? byLabel(/lng\b|lon\b|خط.*طول/i);
      if (latEl) await fillAngular(session, buildSelector(latEl), parts[0], "خط العرض");
      if (lngEl) await fillAngular(session, buildSelector(lngEl), parts[1], "خط الطول");
    }
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
  const ownerEl = byName("ownership_type_id") ?? byLabel(/ownership|ملكية/i);
  if (ownerEl) {
    await (ownerEl.isMat
      ? selectAngular(session, buildSelector(ownerEl), report.ownershipType, "نوع الملكية", true)
      : selectNativeByName(session, ownerEl.name || "", report.ownershipType, "نوع الملكية"));
  }

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

  // ── نسبة البناء ───────────────────────────────────────────────────────────
  const ratioEl = byName("build_ratio") ?? byName("building_ratio") ??
    byLabel(/ratio|build.?ratio|نسبة.*بناء/i);
  if (ratioEl) await fillAngular(session, buildSelector(ratioEl), report.permittedBuildingRatio, "نسبة البناء");

  // ── حالة البناء ───────────────────────────────────────────────────────────
  const statusEl = byName("building_status_id") ?? byLabel(/building.?status|حالة.*بناء/i);
  if (statusEl) {
    await (statusEl.isMat
      ? selectAngular(session, buildSelector(statusEl), report.buildingStatus, "حالة البناء", true)
      : selectNativeByName(session, statusEl.name || "", report.buildingStatus, "حالة البناء"));
  }

  // ── الاتجاهات المطلة ──────────────────────────────────────────────────────
  const facadeEl = byName("facade_id") ?? byLabel(/facade|direction|اتجاه|مطلة|واجهة/i);
  if (facadeEl) {
    await (facadeEl.isMat
      ? selectAngular(session, buildSelector(facadeEl), report.streetFacades, "الاتجاهات", true)
      : selectNativeByName(session, facadeEl.name || "", report.streetFacades, "الاتجاهات"));
  }

  // ── المرافق (checkboxes) ─────────────────────────────────────────────────
  const checkboxes = els.filter(e => e.type === "checkbox");
  if (report.utilities && checkboxes.length > 0) {
    const utilsStr = String(report.utilities).toLowerCase();
    const utilMap: Record<string, RegExp> = {
      "كهرباء":    /كهرباء|electricity/i,
      "مياه":      /مياه|water/i,
      "صرف صحي":  /صرف|sewage/i,
      "غاز":       /غاز|gas/i,
      "طرق":       /طرق|road/i,
    };
    for (const [label, rx] of Object.entries(utilMap)) {
      const cbEl = checkboxes.find(e => rx.test(`${e.name}|${e.labelText}|${e.ariaLabel}`));
      if (cbEl) {
        const shouldCheck = rx.test(utilsStr) || utilsStr.includes(label);
        await checkBox(session, buildSelector(cbEl), shouldCheck, `مرفق: ${label}`);
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
  if (report.utilities && checkboxes.length > 0) {
    const utilsStr = String(report.utilities).toLowerCase();
    const utilMap: Record<string, RegExp> = {
      "كهرباء": /كهرباء|electricity|electric/i,
      "مياه شرب": /مياه|water|drinking/i,
      "صرف صحي": /صرف|sewage|sewer/i,
      "غاز طبيعي": /غاز|gas/i,
      "طرق رئيسية": /طرق|road|street/i,
    };
    for (const [label, rx] of Object.entries(utilMap)) {
      const cbEl = checkboxes.find(e =>
        rx.test(e.formControlName + e.name + e.labelText + e.ariaLabel),
      );
      if (cbEl) {
        const shouldCheck = rx.test(utilsStr) || utilsStr.includes(label);
        await checkBox(session, buildSelector(cbEl), shouldCheck, `مرفق: ${label}`);
      }
    }
  }

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

  // ── نسبة البناء المصرح بها (%) ────────────────────────────────────────────
  const ratioEl = findEl(inputs,
    /ratio|buildratio|permitratio|permit.?ratio|building.?ratio|نسبة.*بناء|نسبة.*مصرح|مصرح.*بناء/i,
  );
  if (ratioEl) await fillAngular(session, buildSelector(ratioEl), report.permittedBuildingRatio, "نسبة البناء المصرح بها");

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

  // تقدير الأصل ثاني أفضل استخدام → "نعم"
  try {
    const bestUseYes = await page.$('input[type="radio"][value="true"], input[type="radio"][value="1"]');
    if (bestUseYes) {
      await bestUseYes.check();
      addLog(session, `✅ أفضل استخدام: نعم`);
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
