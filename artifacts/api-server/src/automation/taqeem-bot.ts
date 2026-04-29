import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getReportById, updateReport, sqliteGetDataSystemByReportId, getReportsByAutomationStatus } from "@workspace/db";
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
      // ── تشغيل الطلب التالي في الطابور تلقائياً ──────────────────────────
      setTimeout(async () => {
        try {
          const queued = await getReportsByAutomationStatus("queued");
          if (queued.length > 0) {
            const next = queued[0];
            console.log(`[Queue] ▶ تشغيل التقرير التالي #${next.id} تلقائياً...`);
            await startAutomation(next.id);
          }
        } catch (e: any) {
          console.error(`[Queue] ❌ خطأ في تشغيل الطلب التالي: ${e.message}`);
        }
      }, 3000);
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

    // ── جلب بيانات datasystem وإعطائها الأولوية على بيانات جدول reports ──────
    const dsRecord = await sqliteGetDataSystemByReportId(reportId).catch(() => null);
    const mergedReport: any = dsRecord ? {
      ...report,
      reportNumber:                 dsRecord.reportNumber                 ?? report.reportNumber,
      reportDate:                   dsRecord.reportDate                   ?? report.reportDate,
      valuationDate:                dsRecord.valuationDate                ?? report.valuationDate,
      inspectionDate:               dsRecord.inspectionDate               ?? report.inspectionDate,
      commissionDate:               dsRecord.commissionDate               ?? report.commissionDate,
      requestNumber:                dsRecord.requestNumber                ?? report.requestNumber,
      valuerName:                   dsRecord.valuerName                   ?? report.valuerName,
      valuerPercentage:             dsRecord.valuerPercentage             ?? report.valuerPercentage,
      licenseNumber:                dsRecord.licenseNumber                ?? report.licenseNumber,
      licenseDate:                  dsRecord.licenseDate                  ?? report.licenseDate,
      membershipNumber:             dsRecord.membershipNumber             ?? report.membershipNumber,
      membershipType:               dsRecord.membershipType               ?? report.membershipType,
      secondValuerName:             dsRecord.secondValuerName             ?? report.secondValuerName,
      secondValuerPercentage:       dsRecord.secondValuerPercentage       ?? report.secondValuerPercentage,
      secondValuerLicenseNumber:    dsRecord.secondValuerLicenseNumber    ?? report.secondValuerLicenseNumber,
      secondValuerMembershipNumber: dsRecord.secondValuerMembershipNumber ?? report.secondValuerMembershipNumber,
      valuersInput:                 dsRecord.valuersInput                 ?? report.valuersInput,
      taqeemReportNumber:           dsRecord.taqeemReportNumber           ?? report.taqeemReportNumber,
      clientName:                   dsRecord.clientName                   ?? report.clientName,
      clientEmail:                  dsRecord.clientEmail                  ?? report.clientEmail,
      clientPhone:                  dsRecord.clientPhone                  ?? report.clientPhone,
      intendedUser:                 dsRecord.intendedUser                 ?? report.intendedUser,
      reportType:                   dsRecord.reportType                   ?? report.reportType,
      valuationPurpose:             dsRecord.valuationPurpose             ?? report.valuationPurpose,
      valuationHypothesis:          dsRecord.valuationHypothesis          ?? report.valuationHypothesis,
      valuationBasis:               dsRecord.valuationBasis               ?? report.valuationBasis,
      propertyType:                 dsRecord.propertyType                 ?? report.propertyType,
      propertySubType:              dsRecord.propertySubType              ?? report.propertySubType,
      region:                       dsRecord.region                       ?? report.region,
      city:                         dsRecord.city                         ?? report.city,
      district:                     dsRecord.district                     ?? report.district,
      street:                       dsRecord.street                       ?? report.street,
      blockNumber:                  dsRecord.blockNumber                  ?? report.blockNumber,
      plotNumber:                   dsRecord.plotNumber                   ?? report.plotNumber,
      planNumber:                   dsRecord.planNumber                   ?? report.planNumber,
      propertyUse:                  dsRecord.propertyUse                  ?? report.propertyUse,
      deedNumber:                   dsRecord.deedNumber                   ?? report.deedNumber,
      deedDate:                     dsRecord.deedDate                     ?? report.deedDate,
      ownerName:                    dsRecord.ownerName                    ?? report.ownerName,
      ownershipType:                dsRecord.ownershipType                ?? report.ownershipType,
      buildingPermitNumber:               dsRecord.buildingPermitNumber               ?? report.buildingPermitNumber,
      buildingStatus:                     dsRecord.buildingStatus                     ?? report.buildingStatus,
      buildingAge:                        dsRecord.buildingAge                        ?? report.buildingAge,
      buildingCompletionPercentage:       dsRecord.buildingCompletionPercentage       ?? report.buildingCompletionPercentage,
      buildingType:                       dsRecord.buildingType                       ?? report.buildingType,
      finishingStatus:                    dsRecord.finishingStatus                    ?? report.finishingStatus,
      furnitureStatus:                    dsRecord.furnitureStatus                    ?? report.furnitureStatus,
      airConditioningType:                dsRecord.airConditioningType                ?? report.airConditioningType,
      isLandRented:                       dsRecord.isLandRented                       ?? report.isLandRented,
      additionalFeatures:                 dsRecord.additionalFeatures                 ?? report.additionalFeatures,
      isBestUse:                          dsRecord.isBestUse                          ?? report.isBestUse,
      landArea:                     dsRecord.landArea                     ?? report.landArea,
      buildingArea:                 dsRecord.buildingArea                 ?? report.buildingArea,
      basementArea:                 dsRecord.basementArea                 ?? report.basementArea,
      annexArea:                    dsRecord.annexArea                    ?? report.annexArea,
      floorsCount:                  dsRecord.floorsCount                  ?? report.floorsCount,
      permittedFloorsCount:         dsRecord.permittedFloorsCount         ?? report.permittedFloorsCount,
      permittedBuildingRatio:       dsRecord.permittedBuildingRatio       ?? report.permittedBuildingRatio,
      streetWidth:                  dsRecord.streetWidth                  ?? report.streetWidth,
      streetFacades:                dsRecord.streetFacades                ?? report.streetFacades,
      utilities:                    dsRecord.utilities                    ?? report.utilities,
      coordinates:                  dsRecord.coordinates                  ?? report.coordinates,
      valuationMethod:              dsRecord.valuationMethod              ?? report.valuationMethod,
      marketWay:                    dsRecord.marketWay                    ?? report.marketWay,
      incomeWay:                    dsRecord.incomeWay                    ?? report.incomeWay,
      costWay:                      dsRecord.costWay                      ?? report.costWay,
      marketValue:                  dsRecord.marketValue                  ?? report.marketValue,
      incomeValue:                  dsRecord.incomeValue                  ?? report.incomeValue,
      costValue:                    dsRecord.costValue                    ?? report.costValue,
      marketApproachPercentage:     dsRecord.marketApproachPercentage     ?? report.marketApproachPercentage,
      incomeApproachPercentage:     dsRecord.incomeApproachPercentage     ?? report.incomeApproachPercentage,
      costApproachPercentage:       dsRecord.costApproachPercentage       ?? report.costApproachPercentage,
      finalValue:                   dsRecord.finalValue                   ?? report.finalValue,
      pricePerMeter:                dsRecord.pricePerMeter                ?? report.pricePerMeter,
      companyName:                  dsRecord.companyName                  ?? report.companyName,
      notes:                        dsRecord.notes                        ?? report.notes,
    } : report;

    if (dsRecord) {
      addLog(session, `✅ تم جلب بيانات datasystem — الأولوية لها في تعبئة النموذج`);
    } else {
      addLog(session, `⚠️ لا يوجد سجل datasystem — سيُستخدم جدول reports فقط`);
    }

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
    await page.waitForTimeout(300);

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
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    // انتظر ظهور أول حقل في النموذج بدلاً من ثابت 2 ثانية
    await page.waitForSelector('[name="title"], [name="purpose_id"], form', { timeout: 10000 })
      .catch(() => {});

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
      await page.waitForTimeout(500);
      await page.goto(`${TAQEEM_URL}/report/create/1/13`, {
        waitUntil: "domcontentloaded",
        timeout: 30000,
      });
      await page.waitForSelector('[name="title"], [name="purpose_id"], form', { timeout: 8000 })
        .catch(() => {});

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

    await fillFormPage(session, mergedReport, elsPage1, pdfState);
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
    await page.waitForTimeout(400);

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
      await page.goto(expectedPage2, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(400);
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

    await fillAssetPage(session, mergedReport, elsPage2);
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

    await page.waitForLoadState("networkidle", { timeout: 15000 }).catch(() => {});
    await page.waitForTimeout(300);

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
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
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
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    addLog(session, `✅ URL الصفحة 3 مؤكد: ${page.url()}`);

    const elsPage3 = await scanElements(page);
    await saveDebug(reportId, "page3", elsPage3);
    await screenshot(page, `p3_before_${reportId}`);
    addLog(session, `📋 عدد حقول الصفحة 3: ${elsPage3.length}`);

    // ── تعبئة الصفحة 3 مع حماية من الانتقال المفاجئ ────────────────────
    const urlAtStartP3 = page.url();
    try {
      await fillAttributePage(session, mergedReport, elsPage3);
    } catch (fillErr: any) {
      addLog(session, `⚠️ خطأ أثناء تعبئة الصفحة 3 (نتابع): ${fillErr.message}`);
    }

    // ── تعبئة الحقول الإضافية: حالة التشطيب، التأثيث، التكييف، نوع المبنى... ──
    // fillPage3 كانت معرَّفة لكنها لم تُستدعَ — هذا هو سبب تخطي هذه الحقول
    try {
      addLog(session, "▶ تعبئة حقول المبنى الإضافية (حالة التشطيب، التأثيث، التكييف، إلخ)");
      await fillPage3(session, mergedReport, elsPage3, pdfState);
    } catch (fillErr3: any) {
      addLog(session, `⚠️ خطأ أثناء تعبئة حقول المبنى الإضافية (نتابع): ${fillErr3.message}`);
    }

    // تحقق من أن الصفحة لم تنتقل أثناء التعبئة
    const urlAfterFillP3 = page.url();
    if (urlAfterFillP3 !== urlAtStartP3 && !urlAfterFillP3.includes("/report/attribute/create/")) {
      addLog(session, `⚠️ تغيّر URL أثناء تعبئة الصفحة 3: ${urlAfterFillP3}`);
      addLog(session, "↩️ إعادة الانتقال لصفحة 3...");
      await page.goto(expectedPage3, { waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
      await page.waitForTimeout(300);
    }

    // انتظر قصير لتستقر Angular form validation قبل الحفظ
    await page.waitForTimeout(400);
    await screenshot(page, `p3_after_${reportId}`);

    // ── ضغط زر "حفظ وإغلاق" (الصفحة 3 تستخدم هذا الزر لا "حفظ واستمرار") ──
    const urlBeforeSaveP3 = page.url();
    await clickSaveAndClose(session);
    await page.waitForLoadState("networkidle", { timeout: 8000 }).catch(() => {});
    await page.waitForTimeout(400);
    // إذا لم يتغير URL → جرب "حفظ واستمرار" ثم "continue" كاحتياط
    if (page.url() === urlBeforeSaveP3) {
      addLog(session, "ℹ️ URL لم يتغير بعد حفظ وإغلاق — أجرب حفظ واستمرار");
      await clickSaveAndContinue(session);
      await page.waitForLoadState("networkidle", { timeout: 6000 }).catch(() => {});
      await page.waitForTimeout(300);
    }
    if (page.url() === urlBeforeSaveP3) {
      addLog(session, "ℹ️ URL لم يتغير — أجرب زر المتابعة");
      await clickContinueButton(session);
      await page.waitForLoadState("networkidle", { timeout: 10000 }).catch(() => {});
    }
    await page.waitForTimeout(300);

    await screenshot(page, `review_${reportId}`);
    const finalUrl = page.url();
    addLog(session, `✅ الصفحة النهائية: ${finalUrl}`);

    // ════════════════════════════════════════════════════════════════════════
    // مرحلة الإرسال: تحديد الموافقة + إرسال التقرير + تنزيل الشهادة
    // ════════════════════════════════════════════════════════════════════════
    await submitAndDownloadCertificate(session, reportId, mergedReport, taqeemReportId);

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

// انتظر استقرار Angular — أسرع بكثير من ثابت 2 ثانية
async function waitForAngular(page: Page, extra = 800): Promise<void> {
  // أولاً: انتظر هدوء الشبكة (500ms بلا طلبات) — أقصى 3 ثوانٍ
  await page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
  // ثانياً: انتظر إضافي قصير لاستقرار Angular zone.js بعد آخر استجابة
  if (extra > 0) await page.waitForTimeout(Math.min(extra, 400));
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

  // انتظر قصير لاستقرار Angular بعد آخر استجابة
  await page.waitForTimeout(500);
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
// تاريخ اليوم بصيغة YYYY-MM-DD
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

// هل التاريخ فارغ أو افتراضي (.NET / قواعد البيانات)؟
function isInvalidDate(s: string): boolean {
  // تواريخ افتراضية شائعة: 0001-01-01، 1900-01-01، 1970-01-01
  return /^0001-|^1900-01-01|^1970-01-01/.test(s) || parseInt(s.substring(0, 4), 10) < 1980;
}

function formatDate(raw: string | null | undefined): string {
  if (!raw) return todayStr();
  const s = raw.trim();
  if (!s)  return todayStr();

  // استخرج الجزء التاريخي فقط من أي صيغة ISO (0001-01-01T00:00:00 → 0001-01-01)
  const datePart = s.substring(0, 10);

  // الصيغة المثالية YYYY-MM-DD (أو مستخرجة من ISO)
  if (/^\d{4}-\d{2}-\d{2}$/.test(datePart)) {
    return isInvalidDate(datePart) ? todayStr() : datePart;
  }
  // صيغة DD/MM/YYYY → YYYY-MM-DD
  const dmy = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (dmy) {
    const result = `${dmy[3]}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
    return isInvalidDate(result) ? todayStr() : result;
  }
  // صيغة D-M-YYYY أو M-D-YYYY → YYYY-MM-DD
  const mdy = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (mdy) {
    const result = `${mdy[3]}-${mdy[1].padStart(2, "0")}-${mdy[2].padStart(2, "0")}`;
    return isInvalidDate(result) ? todayStr() : result;
  }
  // أي تاريخ يبدأ بـ 0001 أو سنة غير صالحة — أرجع اليوم
  if (isInvalidDate(s)) return todayStr();
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

// ─── تعبئة حقل رقمي بالاسم مباشرةً — يتجنب مشكلة الأقواس في CSS selector ───
// مثال: attribute[31] → CSS يُربك بعض المحركات بسبب الأقواس المتداخلة
async function fillInputByName(
  session: AutomationSession,
  name: string,
  value: string | number | null | undefined,
  label: string,
): Promise<void> {
  if (value === null || value === undefined || String(value).trim() === "") {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }
  const val = String(value).trim();
  const { page } = session;
  try {
    // انتظر حتى يظهر العنصر — XPath أكثر أماناً مع الأسماء التي تحتوي أقواساً
    await page.waitForSelector(`xpath=//input[@name="${name}"]`, { timeout: 2000 });

    // طريقة 1: JavaScript مباشر (يتجنب CSS selector issues)
    const filled = await page.evaluate(({ n, v }: { n: string; v: string }) => {
      const el = Array.from(document.querySelectorAll("input"))
        .find((e) => (e as HTMLInputElement).name === n) as HTMLInputElement | null;
      if (!el) return false;
      el.focus();
      el.select();
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, v); else el.value = v;
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur",   { bubbles: true }));
      return true;
    }, { n: name, v: val });

    if (filled) {
      addLog(session, `✅ ${label}: ${val}`);
      return;
    }

    // طريقة 2: XPath + keyboard typing — احتياطية
    const loc = page.locator(`xpath=//input[@name="${name}"]`).first();
    await loc.click({ clickCount: 3 });
    await page.keyboard.press("Control+a");
    await loc.pressSequentially(val, { delay: 30 });
    await page.keyboard.press("Tab");
    addLog(session, `✅ ${label}: ${val} (keyboard)`);
  } catch (err: any) {
    addLog(session, `⚠️ لم يُعبَّأ "${label}": ${(err as Error).message}`);
  }
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
    await page.waitForSelector(selector, { timeout: 500 });
    await page.click(selector);
    await page.waitForSelector(
      "mat-option, .mat-option, .mat-mdc-option",
      { timeout: 1500 },
    );
    await page.waitForTimeout(150);

    // ── بحث داخل القائمة المنسدلة (لقوائم طويلة كالمدن) ──────────────────────
    // بعض قوائم Angular Material تحتوي على حقل بحث — نكتب القيمة فيه لتصفية الخيارات
    const searchInput = await page.$(
      "mat-select-panel input, .mat-select-panel input, .cdk-overlay-pane input[type='text'], " +
      ".mat-select-panel input[type='search'], .cdk-overlay-pane mat-form-field input",
    );
    if (searchInput) {
      await searchInput.click();
      await searchInput.fill(value);
      await page.waitForTimeout(400);
      addLog(session, `🔍 كتابة "${value}" في مربع بحث القائمة`);
    }

    // ابحث بمطابقة مرنة مع تطبيع شامل (داخل المتصفح) + fallback متعدد المستويات
    const optionText = await page.evaluate(
      new Function("nv", "fb", `
        ${EVAL_NORM_FN}
        var opts = Array.from(document.querySelectorAll('mat-option,.mat-option,.mat-mdc-option'));
        var getText = function(o){ return (o.textContent||'').trim(); };

        // 1) القيمة الأصلية
        var t = opts.find(function(o){ return _matches(getText(o), nv); });
        if(t) return {found:getText(t), usedFallback:false, fallbackReason:'', available:[]};

        // 2) fallback المحدد
        if(fb){
          var ft = opts.find(function(o){ return _matches(getText(o), fb); });
          if(ft) return {found:getText(ft), usedFallback:true, fallbackReason:fb, available:[]};
        }

        // 3) أشكال "أخرى" البديلة
        var otherVariants = ['اخري','اخرى','أخري','أخرى','غير ذلك','آخر','أخر','other'];
        for(var i=0;i<otherVariants.length;i++){
          var ot = opts.find(function(o){ return _matches(getText(o), otherVariants[i]); });
          if(ot) return {found:getText(ot), usedFallback:true, fallbackReason:'أخرى (نطق بديل)', available:[]};
        }

        // 4) آخر خيار غير placeholder — الملاذ الأخير (فقط إذا طُلب fallback)
        if(fb){
          var nonBlank = opts.filter(function(o){
            var txt = getText(o);
            return txt && !/^(تحديد|اختر|select|--)/i.test(txt);
          });
          var last = nonBlank[nonBlank.length-1];
          if(last) return {found:getText(last), usedFallback:true, fallbackReason:'آخر خيار متاح', available:[]};
        }

        var available = opts.map(getText).filter(Boolean);
        return {found:null, usedFallback:false, fallbackReason:'', available:available};
      `) as (nv: string, fb: string) => {found:string|null, usedFallback:boolean, fallbackReason:string, available:string[]},
      normVal, fallback ? normalizeAr(fallback) : "",
    );

    if (optionText.found !== null) {
      const optLoc = page.locator("mat-option, .mat-option, .mat-mdc-option")
        .filter({ hasText: optionText.found });
      await optLoc.first().click({ timeout: 2000 });
      await page.waitForTimeout(80);
      if (optionText.usedFallback) {
        addLog(session, `⚠️ "${label}": "${value}" غير موجود — تم اختيار "${optionText.found}" (${optionText.fallbackReason})`);
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

// ── زر "حفظ وإغلاق" (الصفحة 3) ──────────────────────────────────────────────
async function clickSaveAndClose(session: AutomationSession): Promise<void> {
  const { page } = session;
  addLog(session, "🖱️ ضغط «حفظ وإغلاق»...");

  // محاولة 1: بحث بالنص المحدد
  const textPatterns = ["حفظ وإغلاق", "حفظ و إغلاق", "Save & Close", "Save and Close", "حفظ وخروج"];
  for (const txt of textPatterns) {
    try {
      const loc = page.locator(`button:has-text("${txt}"), input[value*="${txt}"]`).first();
      if (await loc.count().catch(() => 0) > 0) {
        await loc.scrollIntoViewIfNeeded().catch(() => {});
        await loc.click({ force: true, timeout: 4000 });
        await page.waitForTimeout(500);
        addLog(session, `✅ تم الضغط: "${txt}"`);
        return;
      }
    } catch { /* تابع */ }
  }

  // محاولة 2: evaluate — إزالة disabled وإجبار النقر
  try {
    const result = await page.evaluate(() => {
      const keywords = ["إغلاق", "close", "وإغلاق"];
      const btns = Array.from(document.querySelectorAll<HTMLButtonElement | HTMLInputElement>(
        "button, input[type='submit'], input[type='button']"
      ));
      const target = btns.find(b => {
        const t = (b.textContent ?? (b as HTMLInputElement).value ?? "").trim();
        return keywords.some(k => t.includes(k));
      });
      if (!target) return null;
      target.removeAttribute("disabled");
      (target as HTMLButtonElement).disabled = false;
      const mat = target.closest("[mat-button],[mat-raised-button],[mat-flat-button]");
      if (mat) (mat as HTMLElement).removeAttribute("disabled");
      target.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
      target.click();
      return target.textContent?.trim().slice(0, 30) ?? (target as HTMLInputElement).value ?? "?";
    });
    if (result) {
      await page.waitForTimeout(500);
      addLog(session, `✅ تم الضغط (إجبار): "${result}"`);
      return;
    }
  } catch { /* تابع */ }

  addLog(session, "⚠️ لم يُعثر على زر «حفظ وإغلاق» — سيُجرب «حفظ واستمرار» كبديل");
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

  const selectByName = (name: string, value: any, label: string, fallback?: string) =>
    selectNativeByName(session, name, value, label, fallback);

  // ── ملء حقول النص دفعة واحدة (أسرع بكثير من استدعاء تسلسلي) ─────────────
  const textBatch: Record<string, string> = {};
  if (report.reportNumber)         textBatch["title"]                   = String(report.reportNumber);
  if (report.finalValue != null)   textBatch["value"]                   = String(report.finalValue);
  if (report.assumptions)          textBatch["assumptions"]             = String(report.assumptions);
  if (report.specialAssumptions)   textBatch["special_assumptions"]     = String(report.specialAssumptions);
  if (report.clientName)           textBatch["client[0][name]"]         = String(report.clientName);
  if (report.clientPhone)          textBatch["client[0][telephone]"]    = String(report.clientPhone);
  if (report.clientEmail)          textBatch["client[0][email]"]        = String(report.clientEmail);

  if (Object.keys(textBatch).length > 0) {
    const filled = await session.page.evaluate((batch: Record<string, string>) => {
      const results: string[] = [];
      for (const [name, val] of Object.entries(batch)) {
        const el = document.querySelector<HTMLInputElement | HTMLTextAreaElement>(
          `[name="${name}"]`
        );
        if (!el) { results.push(`⚠️ ${name}: لم يُعثر`); continue; }
        // استخدم native setter المناسب لكل نوع عنصر لإخطار Angular zone.js
        const proto = el instanceof HTMLTextAreaElement
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
        const nativeSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
        if (nativeSetter) nativeSetter.call(el, val); else el.value = val;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur",   { bubbles: true }));
        results.push(`✅ ${name}: ${val.slice(0, 30)}`);
      }
      return results;
    }, textBatch);
    filled.forEach(r => addLog(session, r));
  }

  // ── الغرض من التقييم ─────────────────────────────────────────────────────
  await selectByName("purpose_id", report.valuationPurpose, "الغرض من التقييم", "أخرى");

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

  // ── عملة التقييم (افتراضي: ريال سعودي) ──────────────────────────────────
  await selectByName("currency_id", report.currency ?? "ريال سعودي", "عملة التقييم");

  // ── بيانات المقيمين ──────────────────────────────────────────────────────
  // دالة مساعدة: اختيار المقيم من الـ dropdown بـ رقم العضوية أو الاسم
  // selectValuerById: يستخدم selectByNameFuzzy — XPath + locator.selectOption
  // إذا لم يُعثر على المقيم → يُرفض التقرير فوراً ولا يختار عشوائياً
  const selectValuerById = async (
    index: number,
    membershipNum: string | null | undefined,
    valuerName: string | null | undefined,
    label: string,
  ) => {
    const term = membershipNum?.trim() || valuerName?.trim() || "";
    if (!term) { addLog(session, `⏭️ تخطي "${label}" — لا توجد بيانات`); return; }
    const found = await selectByNameFuzzy(session, `valuer[${index}][id]`, term, label);
    if (!found) {
      throw new Error(`رقم عضوية المقيم "${term}" غير موجود في قائمة المقيمين على المنصة — تم رفض التقرير`);
    }
  };

  // دالة مساعدة: ضبط نسبة المساهمة
  const setContribution = async (index: number, pct: number | null | undefined) => {
    const pctStr = pct != null ? `${Math.round(pct)}%` : "100%";
    await selectByName(`valuer[${index}][contribution]`, pctStr, `نسبة المساهمة [${index}]`);
  };

  // ── دالة مساعدة: اضغط زر «إضافة مقيم آخر» ──────────────────────────────
  const clickAddValuer = async (): Promise<boolean> => {
    try {
      const clicked = await session.page.evaluate(() => {
        const byId = document.querySelector<HTMLElement>("#duplicateValuer");
        if (byId) { byId.click(); return "id"; }
        const normalize = (s: string) => s.replace(/[أإآ]/g, "ا").replace(/\s+/g, "");
        const btns = Array.from(document.querySelectorAll<HTMLElement>("button, a"));
        const btn = btns.find(b => normalize(b.textContent ?? "").includes("اضافةمقيم"));
        if (btn) { btn.click(); return "text"; }
        return false;
      });
      if (clicked) {
        addLog(session, `✅ ضغط زر إضافة مقيم آخر (via ${clicked})`);
        await session.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
        await session.page.waitForTimeout(300);
        // سجّل أسماء جميع الـ selects ذات الصلة للتشخيص
        const selectNames = await session.page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLSelectElement>("select[name]"))
            .map(s => s.getAttribute("name"))
            .filter(n => n && n.includes("valuer"))
        );
        addLog(session, `🔍 selects بعد الإضافة: ${selectNames.join(", ") || "لا شيء"}`);
        return true;
      }
      addLog(session, "⚠️ لم يُعثر على زر إضافة مقيم آخر");
      return false;
    } catch {
      addLog(session, "⚠️ فشل الضغط على زر إضافة مقيم آخر");
      return false;
    }
  };

  // ── بناء قائمة المقيمين ──────────────────────────────────────────────────
  // إن كان valuersInput ممتلئاً → يُستخدم كمصدر رئيسي لجميع المقيمين
  // وإلا → نستخدم الحقول الفردية (membershipNumber / secondValuerMembershipNumber)
  type ValuerEntry = { membership: string; pct: number | null };
  let valuers: ValuerEntry[] = [];

  if (report.valuersInput?.trim()) {
    const raw = (report.valuersInput as string).trim();
    // يدعم الصيغتين:
    //   فاصلة:    "1220000122-90.12,10000001-10"
    //   سطر جديد: "1220000122 -90.12\n10000001 -10."
    const parts = raw.split(/[\n,]+/).map((p: string) => p.trim()).filter(Boolean);
    for (const p of parts) {
      // ابحث عن آخر "-" (قد يسبقه مسافة مثل "123456 -70")
      const lastDash = p.lastIndexOf("-");
      if (lastDash === -1) {
        valuers.push({ membership: p.trim(), pct: null });
      } else {
        const membership = p.substring(0, lastDash).trim();
        const pct = parseFloat(p.substring(lastDash + 1).trim());
        valuers.push({ membership, pct: isNaN(pct) ? null : pct });
      }
    }
    addLog(session, `📋 valuersInput → ${valuers.length} مقيم: ${valuers.map((v: ValuerEntry) => `${v.membership}(${v.pct ?? "?"}%)`).join(", ")}`);
  } else {
    // المقيم الأول
    if (report.membershipNumber || report.valuerName) {
      valuers.push({ membership: report.membershipNumber || report.valuerName || "", pct: report.valuerPercentage ?? null });
    }
    // المقيم الثاني
    if (report.secondValuerMembershipNumber || report.secondValuerName) {
      valuers.push({ membership: report.secondValuerMembershipNumber || report.secondValuerName || "", pct: report.secondValuerPercentage ?? null });
    }
  }

  // ── تعبئة المقيمين بالترتيب ──────────────────────────────────────────────
  const ordinals = ["الأول", "الثاني", "الثالث", "الرابع", "الخامس"];
  for (let i = 0; i < valuers.length; i++) {
    const v = valuers[i];
    const label = `المقيم ${ordinals[i] ?? `#${i + 1}`}`;
    if (i > 0) {
      // ضغط زر «إضافة مقيم آخر» قبل كل مقيم إضافي
      await clickAddValuer();
    }
    await selectValuerById(i, v.membership, null, label);
    await setContribution(i, v.pct);
  }

  if (valuers.length === 0) {
    addLog(session, "⚠️ لم تُحدَّد بيانات أي مقيم");
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
    await session.page.waitForSelector(sel, { timeout: 1500 });

    // انتظار تحميل الخيارات — خفّفنا التايمآوت لأن قوائم TAQEEM محملة مسبقاً
    await session.page.waitForFunction(
      (s: string) => {
        const el = document.querySelector<HTMLSelectElement>(s);
        return !!el && el.options.length > 1;
      },
      sel,
      { timeout: 1500 },
    ).catch(() => {});

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

    // محاولة 2: مطابقة مرنة شاملة + fallback متعدد المستويات
    const result = await session.page.evaluate(
      new Function("args", `
        ${EVAL_NORM_FN}
        var el = document.querySelector(args.sel);
        if(!el) return {matched:null, usedFallback:false, fallbackReason:'', available:[]};
        var opts = Array.from(el.options);
        var available = opts.map(function(o){return o.text.trim();}).filter(Boolean);

        function applyOpt(o, reason){
          el.value = o.value;
          el.dispatchEvent(new Event('change',{bubbles:true}));
          return {matched:o.text.trim(), usedFallback:reason!=='', fallbackReason:reason, available:available};
        }

        // 1) البحث عن القيمة الأصلية
        var opt = opts.find(function(o){ return _matches(o.text, args.nv); });
        if(opt) return applyOpt(opt, '');

        // 2) البحث عن fallback المحدد (مثل "أخرى")
        if(args.fb){
          opt = opts.find(function(o){ return _matches(o.text, args.fb); });
          if(opt) return applyOpt(opt, args.fb);
        }

        // 3) جرب أشكال "أخرى" البديلة (تكتب بطرق مختلفة في TAQEEM)
        var otherVariants = ['اخري','اخرى','أخري','أخرى','غير ذلك','آخر','أخر','other'];
        for(var i=0;i<otherVariants.length;i++){
          opt = opts.find(function(o){ return _matches(o.text, otherVariants[i]); });
          if(opt) return applyOpt(opt, 'أخرى (نطق بديل)');
        }

        // 4) آخر خيار غير فارغ وغير placeholder (تحديد/اختر) — الملاذ الأخير
        if(args.fb){
          var placeholder = /^(تحديد|اختر|select|--)/i;
          var lastOpt = opts.slice().reverse().find(function(o){
            return o.value && o.value!=='' && o.value!=='0' && !placeholder.test(o.text.trim());
          });
          if(lastOpt) return applyOpt(lastOpt, 'آخر خيار متاح');
        }

        return {matched:null, usedFallback:false, fallbackReason:'', available:available};
      `) as (args: {sel:string; nv:string; fb:string}) => {matched:string|null; usedFallback:boolean; fallbackReason:string; available:string[]},
      { sel, nv: normVal, fb: normFb },
    );

    if (result.matched) {
      if (result.usedFallback) {
        addLog(session, `⚠️ "${label}": "${value}" غير موجود — تم اختيار "${result.matched}" (${result.fallbackReason})`);
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
    return n < 1 ? n * 100 : n; // 0.7 → 70, 70 → 70, 1 → 1 (وليس 100!)
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
          await page.waitForTimeout(150);
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
          await page.waitForTimeout(150);
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
  addLog(session, "⏳ انتظار انتهاء كاسكاد نوع الأصل...");
  await session.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
  await session.page.waitForTimeout(200);

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

  // ── المنطقة (مع retry) ────────────────────────────────────────────────────
  const regionEl = byName("region_id") ?? byLabel(/region|province|منطقة|محافظة/i);
  if (regionEl && report.region) {
    // جرب حتى 3 مرات — Angular قد يُعيد ضبط الـ dropdown بعد التحديث
    for (let attempt = 1; attempt <= 3; attempt++) {
      // انتظار networkidle بدلاً من ثابت تصاعدي
      await session.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await session.page.waitForTimeout(150 * attempt);
      await (regionEl.isMat
        ? selectAngular(session, buildSelector(regionEl), report.region, "المنطقة", true)
        : selectNativeByName(session, regionEl.name || "", report.region, "المنطقة"));
      // تحقق من أن القيمة اختيرت فعلاً
      const currentVal = await session.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLSelectElement | null;
        return el?.value ?? el?.textContent?.trim() ?? "";
      }, buildSelector(regionEl)).catch(() => "");
      if (currentVal && currentVal !== "" && currentVal !== "null") {
        addLog(session, `✅ المنطقة محددة (محاولة ${attempt}): "${currentVal}"`);
        break;
      }
      if (attempt < 3) addLog(session, `⏳ إعادة محاولة اختيار المنطقة (${attempt}/3)...`);
    }
    // انتظر تحميل المدن بعد اختيار المنطقة (كاسكاد API)
    await session.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    await session.page.waitForTimeout(200);
  } else if (!regionEl) {
    addLog(session, "⚠️ لم يُعثر على «المنطقة»");
  }

  // ── المدينة ───────────────────────────────────────────────────────────────
  const cityEl = byName("city_id") ?? byLabel(/city|مدينة/i);
  if (cityEl) {
    await (cityEl.isMat
      ? selectAngular(session, buildSelector(cityEl), report.city, "المدينة", true)
      : selectNativeByName(session, cityEl.name || "", report.city, "المدينة"));
    // انتظر استقرار Angular بعد اختيار المدينة
    await session.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
    await session.page.waitForTimeout(150);
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

  // ── تصحيح ترتيب الإحداثيات: خط الطول دائماً الرقم الأكبر ───────────────
  if (lat && lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!isNaN(latNum) && !isNaN(lngNum) && latNum > lngNum) {
      addLog(session, `🔄 تصحيح الإحداثيات: تبديل lat(${lat}) ↔ lng(${lng}) لأن خط الطول يجب أن يكون الأكبر`);
      [lat, lng] = [lng, lat];
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
  // تطبيع: "ملكية مطلقة" أو أي نص يحتوي "ملكية" (بدون مشاعة/انتفاع/إيجار) → "ملكية"
  // الافتراضي: "أخرى" عند القيمة الفارغة أو عدم وجود تطابق
  {
    const raw = (report.ownershipType ?? "").trim();
    const containsOwnership = /ملكية/.test(raw);
    const isShared     = /مشاع/.test(raw);
    const isUsufruct   = /انتفاع/.test(raw);
    const isRent       = /إيجار|ايجار/.test(raw);
    const normalizedOwnership = !raw
      ? "أخرى"
      : (containsOwnership && !isShared && !isUsufruct && !isRent)
        ? "ملكية"
        : raw;
    if (normalizedOwnership !== raw) {
      addLog(session, `🔄 نوع الملكية: "${raw || "(فارغ)"}" → "${normalizedOwnership}"`);
    }
    await selectByNameFuzzy(session, "attribute[4]", normalizedOwnership, "نوع الملكية", "أخرى");
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
            await session.page.waitForTimeout(100);
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
// يدعم: mat-checkbox (Angular Material) + input[type=checkbox] عادي + label
// ─────────────────────────────────────────────────────────────────────────────
async function fillUtilitiesCheckboxes(
  session: AutomationSession,
  els: any[],
  report: any,
): Promise<void> {
  if (!report.utilities) {
    addLog(session, "ℹ️ لا يوجد مرافق في التقرير — تجاوز");
    return;
  }

  const norm = (s: string) =>
    s.replace(/[\u064B-\u065F\u0670]/g, "")
     .replace(/[أإآ]/g, "ا")
     .replace(/ة/g, "ه")
     .replace(/ى/g, "ي")
     .toLowerCase()
     .replace(/\s+/g, " ").trim();

  const utilsNorm = norm(String(report.utilities));
  addLog(session, `🔧 المرافق — نص: "${String(report.utilities).slice(0, 120)}"`);

  const utilMap = [
    { keywords: /كهرباء|electricity|electric|power|إنارة|انارة|إضاءة|اضاءة|lighting/i, cbText: "كهرباء", label: "كهرباء حكومية" },
    { keywords: /مياه|مياة|ماء|water|drinking/i,                                        cbText: "مياه",    label: "مياه شرب"    },
    { keywords: /صرف\s*صحي|sewage|sewer/i,                                               cbText: "صرف",     label: "صرف صحي"     },
    { keywords: /غاز|gas/i,                                                               cbText: "غاز",     label: "غاز طبيعي"   },
    { keywords: /طرق|رئيسي|road|access|سفلت|اسفلت|رصف|تعبيد|asphalt|pavement/i,        cbText: "طرق",     label: "طرق رئيسية"  },
  ];

  const toCheck = utilMap.filter(u => u.keywords.test(utilsNorm));
  for (const u of utilMap)
    addLog(session, `  ↪ "${u.label}": ${u.keywords.test(utilsNorm) ? "مطلوب" : "لا حاجة"}`);
  if (toCheck.length === 0) { addLog(session, "ℹ️ لا توجد مرافق مطابقة"); return; }

  // ── مساعد: أوجد checkbox الصحيح وانقر input بشكل آمن ─────────────────────
  // نضغط على `input` الداخلي مباشرةً (ليس mat-checkbox الأب)
  // ثم نطلق أحداث Angular بالترتيب الصحيح ليُحدَّث FormControl
  const clickOneCheckbox = async (cbText: string, label: string): Promise<boolean> => {
    const pat = new RegExp(cbText, "i");

    // 1) ابحث عن كل mat-checkbox ← ← طريقة Angular Material ─────────────────
    const result = await session.page.evaluate(
      ({ patStr, normSrc }: { patStr: string; normSrc: string }) => {
        const n = (s: string) =>
          s.replace(/[\u064B-\u065F\u0670]/g, "")
           .replace(/[أإآ]/g, "ا")
           .replace(/ة/g, "ه")
           .replace(/ى/g, "ي")
           .toLowerCase()
           .replace(/\s+/g, " ").trim();

        const pat = new RegExp(patStr, "i");

        // حدد عنصر mat-checkbox المطابق
        const matCbs = Array.from(document.querySelectorAll("mat-checkbox"));
        for (const matEl of matCbs) {
          if (!pat.test(n(matEl.textContent ?? ""))) continue;
          const inp = matEl.querySelector<HTMLInputElement>("input[type='checkbox']");
          if (!inp) continue;
          if (inp.checked) return { status: "already_checked" };

          // ضغط input مباشرةً (بدلاً من الأب) — هذا ما يُحدّث Angular FormControl
          inp.click();

          // انتظر microtask قصير (لا يمكن استخدام async/await هنا)
          // ثم أطلق أحداث Angular الإضافية
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          inp.dispatchEvent(new Event("input",  { bubbles: true }));

          return { status: "clicked", text: n(matEl.textContent ?? "").slice(0, 40) };
        }

        // 2) fallback: بحث عكسي من input→label ────────────────────────────────
        for (const inp of Array.from(document.querySelectorAll<HTMLInputElement>("input[type='checkbox']"))) {
          const lbl = n(
            inp.labels?.[0]?.textContent ??
            inp.closest("label")?.textContent ??
            inp.nextElementSibling?.textContent ??
            inp.previousElementSibling?.textContent ?? ""
          );
          if (!pat.test(lbl)) continue;
          if (inp.checked) return { status: "already_checked" };
          inp.click();
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          inp.dispatchEvent(new Event("input",  { bubbles: true }));
          return { status: "fallback_clicked", text: lbl.slice(0, 40) };
        }

        return { status: "not_found" };
      },
      { patStr: pat.source, normSrc: utilsNorm },
    ).catch(() => ({ status: "error" }));

    return result.status === "clicked" || result.status === "fallback_clicked" || result.status === "already_checked";
  };

  // ── مساعد: تحقق هل checkbox مُفعَّل فعلاً ────────────────────────────────
  const isCheckedNow = async (cbText: string): Promise<boolean> => {
    const pat = new RegExp(cbText, "i");
    return session.page.evaluate((patStr: string) => {
      const n = (s: string) =>
        s.replace(/[\u064B-\u065F\u0670]/g, "")
         .replace(/[أإآ]/g, "ا")
         .replace(/ة/g, "ه")
         .replace(/ى/g, "ي")
         .toLowerCase()
         .replace(/\s+/g, " ").trim();
      const pat2 = new RegExp(patStr, "i");
      for (const matEl of Array.from(document.querySelectorAll("mat-checkbox"))) {
        if (!pat2.test(n(matEl.textContent ?? ""))) continue;
        return (matEl.querySelector("input[type='checkbox']") as HTMLInputElement)?.checked ?? false;
      }
      for (const inp of Array.from(document.querySelectorAll<HTMLInputElement>("input[type='checkbox']"))) {
        const lbl = n(inp.labels?.[0]?.textContent ?? inp.nextElementSibling?.textContent ?? "");
        if (!pat2.test(lbl)) continue;
        return inp.checked;
      }
      return false;
    }, pat.source).catch(() => false);
  };

  // ── التنفيذ الفعلي: اضغط كل مرفق مع تحقق وإعادة محاولة ──────────────────
  for (const util of toCheck) {
    let success = false;

    for (let attempt = 1; attempt <= 4; attempt++) {
      // تحقق أولاً إذا كان مُفعَّلاً بالفعل
      const already = await isCheckedNow(util.cbText);
      if (already) { addLog(session, `✅ مرفق "${util.label}": مُفعَّل`); success = true; break; }

      // اضغط
      await clickOneCheckbox(util.cbText, util.label);

      // انتظر Angular يستقر (أطول في المحاولات اللاحقة)
      await session.page.waitForTimeout(350 * attempt);

      // تحقق من النجاح
      const nowChecked = await isCheckedNow(util.cbText);
      if (nowChecked) {
        addLog(session, `✅ مرفق "${util.label}": تم (محاولة ${attempt})`);
        success = true;
        break;
      }

      if (attempt < 4) addLog(session, `⏳ إعادة محاولة "${util.label}" (${attempt}/4)...`);
    }

    if (!success) addLog(session, `⚠️ مرفق "${util.label}": لم يتفعل بعد 4 محاولات`);
  }

  await session.page.waitForTimeout(300);
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
  if (purposeEl) await selectAngular(session, buildSelector(purposeEl), report.valuationPurpose, "الغرض من التقييم", purposeEl.isMat, "أخرى");
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

  // ── قيمة الطريقة المحددة لكل أسلوب (marketWay / incomeWay / costWay) ──────
  await fillValueByMethodLabel(session, report.marketWay, report.marketValue, "قيمة طريقة السوق");
  await fillValueByMethodLabel(session, report.incomeWay, report.incomeValue, "قيمة طريقة الدخل");
  await fillValueByMethodLabel(session, report.costWay,   report.costValue,   "قيمة طريقة التكلفة");

  // ── الدولة (ثابت: المملكة العربية السعودية) ──────────────────────────────
  const countryEl = findEl(selects,
    /country|countryid|دولة|بلد/i,
  );
  if (countryEl) await selectAngular(session, buildSelector(countryEl), "المملكة العربية السعودية", "الدولة", countryEl.isMat);

  // ── المنطقة (مع retry) ────────────────────────────────────────────────────
  const regionEl = findEl(selects, /region|province|regionid|emirate|منطقة|محافظة|إمارة/i);
  if (regionEl && report.region) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await session.page.waitForLoadState("networkidle", { timeout: 3000 }).catch(() => {});
      await session.page.waitForTimeout(150 * attempt);
      await selectAngular(session, buildSelector(regionEl), report.region, "المنطقة", regionEl.isMat);
      const val = await session.page.evaluate((sel: string) => {
        const el = document.querySelector(sel) as HTMLSelectElement | null;
        return el?.value ?? el?.textContent?.trim() ?? "";
      }, buildSelector(regionEl)).catch(() => "");
      if (val && val !== "" && val !== "null") {
        addLog(session, `✅ المنطقة محددة (محاولة ${attempt}): "${val}"`);
        break;
      }
      if (attempt < 3) addLog(session, `⏳ إعادة محاولة اختيار المنطقة (${attempt}/3)...`);
    }
    // انتظر تحميل المدن بعد اختيار المنطقة
    await session.page.waitForLoadState("networkidle", { timeout: 4000 }).catch(() => {});
    await session.page.waitForTimeout(200);
  } else if (!regionEl) {
    addLog(session, `⚠️ لم يُعثر على حقل «المنطقة»`);
  }

  // ── المدينة (نُعيد مسح DOM الحي بعد تحميل خيارات المنطقة) ──────────────
  // cityEl من المسح الأوّلي قد يكون قديماً — المدن تُحمَّل ديناميكياً بعد المنطقة
  if (report.city) {
    // انتظر إضافياً لتستقر قائمة المدن في Angular
    await session.page.waitForTimeout(400);

    // مسح حي للعنصر من DOM مباشرة
    const liveCitySelector = await session.page.evaluate(() => {
      const rx = /city|cityid|مدينة|بلدية/i;
      const testEl = (el: Element) =>
        rx.test(el.getAttribute("name") ?? "") ||
        rx.test(el.getAttribute("id") ?? "") ||
        rx.test(el.getAttribute("formcontrolname") ?? "") ||
        rx.test(el.getAttribute("ng-reflect-name") ?? "");

      // mat-select أولاً
      const mat = Array.from(document.querySelectorAll("mat-select")).find(testEl);
      if (mat) {
        const fc = mat.getAttribute("formcontrolname") ?? mat.getAttribute("ng-reflect-name") ?? "";
        const nm = mat.getAttribute("name") ?? mat.getAttribute("id") ?? "";
        if (fc) return { sel: `mat-select[formcontrolname="${fc}"]`, isMat: true };
        if (nm) return { sel: `mat-select[name="${nm}"]`, isMat: true };
        return { sel: "mat-select", isMat: true };
      }
      // native select
      const ns = Array.from(document.querySelectorAll("select")).find(testEl);
      if (ns) {
        const nm = ns.getAttribute("name") ?? "";
        const id = ns.getAttribute("id") ?? "";
        if (nm) return { sel: `select[name="${nm}"]`, isMat: false };
        if (id) return { sel: `#${id}`,              isMat: false };
      }
      return null;
    }).catch(() => null);

    if (liveCitySelector) {
      addLog(session, `🔍 المدينة: عنصر حي = "${liveCitySelector.sel}"`);
      // retry حتى 3 محاولات (قائمة المدن قد تأخذ وقتاً)
      for (let attempt = 1; attempt <= 3; attempt++) {
        await selectAngular(session, liveCitySelector.sel, report.city, "المدينة", liveCitySelector.isMat);
        // تحقق من نجاح الاختيار
        const chosen = await session.page.evaluate((sel: string) => {
          const el = document.querySelector(sel);
          return el ? (el as any).value || el.textContent?.trim() || "" : "";
        }, liveCitySelector.sel).catch(() => "");
        if (chosen && chosen !== "" && chosen !== "null") {
          addLog(session, `✅ المدينة محددة (محاولة ${attempt}): "${chosen}"`);
          break;
        }
        if (attempt < 3) {
          addLog(session, `⏳ إعادة محاولة اختيار المدينة (${attempt}/3)...`);
          await session.page.waitForTimeout(500 * attempt);
        }
      }
    } else {
      // fallback للعنصر المحفوظ
      const cityElFb = findEl(selects, /city|cityid|مدينة|بلدية/) ??
        findEl(inputs, /city|cityid|مدينة|بلدية/);
      if (cityElFb) {
        addLog(session, `🔍 المدينة: عنصر محفوظ = "${buildSelector(cityElFb)}"`);
        await selectAngular(session, buildSelector(cityElFb), report.city, "المدينة", cityElFb?.isMat);
      } else {
        addLog(session, `⚠️ لم يُعثر على حقل «المدينة» في DOM`);
      }
    }
  } else {
    addLog(session, `⏭️ تخطي «المدينة» — لا توجد قيمة`);
  }

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
    const parts = String(report.coordinates)
      .trim()
      .split(/[,،\s]+/)
      .map((s: string) => s.trim())
      .filter((s: string) => /^-?\d+(\.\d+)?$/.test(s));
    if (parts.length >= 2) { lat = parts[0]; lng = parts[1]; }
  }
  // تصحيح الترتيب: خط الطول دائماً الرقم الأكبر
  if (lat && lng) {
    const latNum = parseFloat(lat);
    const lngNum = parseFloat(lng);
    if (!isNaN(latNum) && !isNaN(lngNum) && latNum > lngNum) {
      addLog(session, `🔄 تصحيح الإحداثيات (ص2): تبديل lat(${lat}) ↔ lng(${lng})`);
      [lat, lng] = [lng, lat];
    }
  }
  const lngEl = findEl(inputs, /longitude|long\b|lng\b|خط.*طول|طول.*جغرافي/i);
  if (lngEl && lng) await fillAngular(session, buildSelector(lngEl), lng, "خط الطول");
  const latEl = findEl(inputs, /latitude|lat\b|خط.*عرض|عرض.*جغرافي/i);
  if (latEl && lat) await fillAngular(session, buildSelector(latEl), lat, "خط العرض");

  // محاولة رفع PDF في الصفحة 2 إن لم يرفع في الصفحة 1
  await uploadPdf(session, report, pdfState);
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 3 — الحقول الإضافية فقط (لا تُكرر ما عبّأه fillAttributePage)
// attribute[15] الأرض مستأجرة | attribute[17-20] تشطيب/تأثيث/تكييف/نوع مبنى
// attribute[27] أفضل استخدام | attribute[28] عمر الأصل | attribute[31] عرض الشارع
// ─────────────────────────────────────────────────────────────────────────────
async function fillPage3(session: AutomationSession, report: any, _els: any[], pdfState: { pdfUploaded: boolean }): Promise<void> {
  const { page } = session;

  addLog(session, "🔍 [حقول إضافية] القيم:");
  addLog(session, `  حالة التشطيب = "${report.finishingStatus ?? "NULL"}"`);
  addLog(session, `  حالة التأثيث = "${report.furnitureStatus ?? "NULL"}"`);
  addLog(session, `  التكييف      = "${report.airConditioningType ?? "NULL"}"`);
  addLog(session, `  نوع المبنى   = "${report.buildingType ?? "NULL"}"`);
  addLog(session, `  عمر الأصل   = "${report.buildingAge ?? "NULL"}"`);
  addLog(session, `  عرض الشارع  = "${report.streetWidth ?? "NULL"}"`);
  addLog(session, `  الأرض مستأجرة = "${report.isLandRented ?? "لا"}"`);

  // ── حالة التشطيب  (attribute[17]) ────────────────────────────────────────
  await nativeSelectByName(session, "attribute[17]", report.finishingStatus, "حالة التشطيب");

  // ── حالة التأثيث  (attribute[18]) ────────────────────────────────────────
  await nativeSelectByName(session, "attribute[18]", report.furnitureStatus, "حالة التأثيث");

  // ── التكييف       (attribute[19]) ────────────────────────────────────────
  await nativeSelectByName(session, "attribute[19]", report.airConditioningType, "التكييف");

  // ── نوع المبنى    (attribute[20]) ────────────────────────────────────────
  await nativeSelectByName(session, "attribute[20]", report.buildingType, "نوع المبنى");

  // ── الأرض مستأجرة (attribute[15]) — radio ────────────────────────────────
  await clickRadioByGroupLabel(session, /مستأجرة|land.?rent/i, report.isLandRented ?? "لا", "الأرض مستأجرة");

  // ── أفضل استخدام  (attribute[27]) — radio (دائماً = نعم) ─────────────────
  await clickRadioByGroupLabel(session, /أفضل.*استخدام|best.?use/i, "نعم", "أفضل استخدام");

  // مساعد: استخراج أول رقم (صحيح أو عشري) من نص مثل "20م" أو "عرض 15.5 متر"
  const extractNumber = (v: any): string => {
    if (v == null) return "";
    const m = String(v).match(/[\d]+(?:[.,]\d+)?/);
    return m ? m[0].replace(",", ".") : "";
  };

  // ── عمر الأصل محل التقييم (attribute[28]) ────────────────────────────────
  const ageVal = extractNumber(report.buildingAge);
  await fillInputByName(session, "attribute[28]", ageVal || null, "عمر الأصل");

  // ── عرض الشارع (attribute[31]) ───────────────────────────────────────────
  // إذا لم تُستخرج قيمة من PDF نضع 0 افتراضياً لأن الحقل إلزامي
  // نستخدم دالة ذكية تُفضّل عرض الشارع على عرض الارتداد
  const extractStreetWidth = (v: any): string => {
    if (v == null) return "";
    const s = String(v);

    // أولاً: ابحث عن الرقم المرتبط بـ «شارع» تحديداً
    const streetPatterns = [
      /شارع[^،.\d]*?عرض\s*([\d.,]+)/,        // شارع ... عرض X
      /شارع[^،.\d]*?بعرض\s*([\d.,]+)/,       // شارع ... بعرض X
      /عرض\s+الشارع\s*[:\s]\s*([\d.,]+)/,    // عرض الشارع: X
      /الشارع\s+(?:ذو\s+)?(?:عرض|بعرض)\s*([\d.,]+)/, // الشارع بعرض X
    ];
    for (const pat of streetPatterns) {
      const m = s.match(pat);
      if (m) return m[1].replace(",", ".");
    }

    // ثانياً: احذف أقسام الارتداد ثم خذ أول رقم
    const withoutSetback = s
      .replace(/ارتداد(?:ات)?\s+عرض\s*[\d.,]+\s*م?/g, "")
      .replace(/ارتداد(?:ات)?\s+[\d.,]+\s*م?/g, "")
      .replace(/الارتداد\s+[\d.,]+\s*م?/g, "");
    const m2 = withoutSetback.match(/[\d]+(?:[.,]\d+)?/);
    if (m2) return m2[0].replace(",", ".");

    // أخيراً: fallback العادي
    return extractNumber(v);
  };

  const swVal = extractStreetWidth(report.streetWidth);
  await fillInputByName(session, "attribute[31]", swVal || "0", "عرض الشارع");

  // ── رفع PDF إن لم يتم سابقاً ──────────────────────────────────────────────
  await uploadPdf(session, report, pdfState);
}

// ── مساعد: اختيار من native <select> بالاسم مع مطابقة عربية مرنة ────────────
async function nativeSelectByName(
  session: AutomationSession,
  name: string,
  value: string | null | undefined,
  fieldName: string,
): Promise<void> {
  if (!value || String(value).trim() === "") {
    addLog(session, `ℹ️ ${fieldName}: لا قيمة — تجاوز`);
    return;
  }
  const { page } = session;
  const normAr = (s: string) =>
    s.replace(/[\u064B-\u065F\u0670]/g, "")
     .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
     .replace(/\s+/g, " ").trim().toLowerCase();
  const normVal = normAr(value);

  const result = await page.evaluate(
    ({ selName, target, normTarget }: { selName: string; target: string; normTarget: string }) => {
      const norm = (s: string) =>
        s.replace(/[\u064B-\u065F\u0670]/g, "")
         .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
         .replace(/\s+/g, " ").trim().toLowerCase();
      const sel = document.querySelector<HTMLSelectElement>(`select[name="${selName}"]`);
      if (!sel) return { ok: false, err: "not_found", available: [] as string[] };
      const opts = Array.from(sel.options);
      const available = opts.map(o => o.text.trim()).filter(Boolean);
      const pick = (o: HTMLOptionElement) => {
        sel.value = o.value;
        sel.dispatchEvent(new Event("change", { bubbles: true }));
        return { ok: true, chosen: o.text.trim(), available };
      };
      let m = opts.find(o => o.text.trim() === target);
      if (!m) m = opts.find(o => norm(o.text) === normTarget);
      if (!m) m = opts.find(o => norm(o.text).includes(normTarget) || normTarget.includes(norm(o.text)));
      return m ? pick(m) : { ok: false, err: "no_match", available };
    },
    { selName: name, target: value, normTarget: normVal },
  ).catch(() => null);

  if (result?.ok) {
    addLog(session, `✅ ${fieldName}: "${result.chosen ?? value}"`);
  } else if (result?.err === "not_found") {
    addLog(session, `⚠️ ${fieldName}: select[name="${name}"] غير موجود في الصفحة`);
  } else {
    const avail = result?.available ?? [];
    addLog(session, avail.length
      ? `⚠️ ${fieldName}: "${value}" غير موجود — المتاح: [${avail.join(" | ")}]`
      : `⚠️ ${fieldName}: لا خيارات في القائمة`
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// دوال مساعدة: بحث بـ label الصفحة للحقول التي لا يُعثر عليها بـ scanElements
// ─────────────────────────────────────────────────────────────────────────────

// اختيار قيمة في dropdown (mat-select أو native select) عبر label الصفحة
/** تمرير الصفحة إلى عنصر label يحتوي النص المطلوب — يُساعد على إظهار الحقول المخفية */
async function scrollToLabelAndFill(session: AutomationSession, labelText: string): Promise<void> {
  try {
    await session.page.evaluate((txt: string) => {
      const all = Array.from(document.querySelectorAll("mat-label, label, span, div, p, td"));
      for (const el of all) {
        const t = el.textContent?.replace(/\s+/g, " ").replace(/\*/g, "").trim() ?? "";
        if (t.includes(txt) && t.length < 80) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
    }, labelText);
    await session.page.waitForTimeout(300);
  } catch { /* تابع */ }
}

async function selectDropdownByPageLabel(
  session: AutomationSession,
  labelRx: RegExp,
  value: string | null | undefined,
  fieldName: string,
): Promise<void> {
  if (!value) { addLog(session, `ℹ️ لا توجد قيمة لـ «${fieldName}» — تجاوز`); return; }
  const { page } = session;

  // ── المساعد: فتح mat-select والاختيار بالنص مباشرةً ────────────────────
  const tryMatSelect = async (ms: import("@playwright/test").Locator): Promise<boolean> => {
    try {
      await ms.scrollIntoViewIfNeeded().catch(() => {});

      // فتح القائمة عبر الـ trigger أو المكوّن مباشرةً
      const trigger = ms.locator(".mat-select-trigger, .mat-mdc-select-trigger, mat-select-trigger").first();
      if (await trigger.count().catch(() => 0) > 0) {
        await trigger.click({ force: true, timeout: 2000 }).catch(() => {});
      } else {
        await ms.click({ force: true, timeout: 2000 });
      }

      // انتظر ظهور الخيارات
      await page.waitForTimeout(600);

      // ── اختيار بالنص (DOM evaluate) ────────────────────────────────────
      const normAr = (s: string) =>
        s.replace(/[\u064B-\u065F\u0670]/g, "")
         .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
         .replace(/\s+/g, " ").trim().toLowerCase();
      const normVal = normAr(value);

      const domResult = await page.evaluate(
        ({ targetVal, normTarget }: { targetVal: string; normTarget: string }) => {
          const norm = (s: string) =>
            s.replace(/[\u064B-\u065F\u0670]/g, "")
             .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
             .replace(/\s+/g, " ").trim().toLowerCase();

          const seen = new Set<Element>();
          const all: Element[] = [];
          for (const sel of [
            ".cdk-overlay-container mat-option",
            ".cdk-overlay-container .mat-mdc-option",
            ".cdk-overlay-container [role='option']",
            "mat-option", "[role='option']", ".mat-mdc-option",
          ]) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              if (!seen.has(el)) { seen.add(el); all.push(el); }
            }
          }

          const available = all.map(e => e.textContent?.replace(/\s+/g, " ").trim() ?? "");
          const doClick = (opt: Element, how: string) => {
            (opt as HTMLElement).click();
            opt.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
            return { matched: opt.textContent?.replace(/\s+/g, " ").trim() ?? "", how };
          };

          for (const opt of all) {
            const txt = opt.textContent?.replace(/\s+/g, " ").trim() ?? "";
            if (txt === targetVal) return doClick(opt, "exact");
          }
          for (const opt of all) {
            const txt = opt.textContent?.replace(/\s+/g, " ").trim() ?? "";
            const nt = norm(txt);
            if (nt === normTarget || nt.includes(normTarget) || normTarget.includes(nt))
              return doClick(opt, "norm");
          }
          return { matched: null, how: "not-found", available: available.slice(0, 15) };
        },
        { targetVal: value, normTarget: normVal }
      ).catch(() => null);

      if (domResult?.matched) {
        await page.waitForTimeout(300);
        const note = domResult.how !== "exact" ? ` (${domResult.how})` : "";
        addLog(session, `✅ ${fieldName}: "${value}"${note}`);
        return true;
      }

      const avail = (domResult as { available?: string[] } | null)?.available ?? [];
      addLog(session, avail.length
        ? `⚠️ ${fieldName}: لم يُطابق "${value}" — المتاح: [${avail.join(" | ")}]`
        : `⚠️ ${fieldName}: لا خيارات في القائمة`
      );

      await page.keyboard.press("Escape").catch(() => {});
    } catch (e) {
      addLog(session, `⚠️ ${fieldName}: ${String(e).slice(0, 100)}`);
      await page.keyboard.press("Escape").catch(() => {});
    }
    return false;
  };

  // ── أسلوب 1 (Playwright): mat-form-field تحتوي mat-label يطابق labelRx ──
  try {
    const allFormFields = page.locator("mat-form-field");
    const ffCnt = await allFormFields.count().catch(() => 0);
    for (let fi = 0; fi < ffCnt; fi++) {
      const ff = allFormFields.nth(fi);
      // ابحث عن mat-label أو label بداخل الـ form-field
      const labelEl = ff.locator("mat-label, label").first();
      const labelTxt = (await labelEl.textContent().catch(() => ""))?.replace(/\s+/g, " ").trim() ?? "";
      if (!labelRx.test(labelTxt)) continue;

      // وجدنا الـ form-field الصحيح — ابحث عن mat-select أو select
      const matSel = ff.locator("mat-select").first();
      if (await matSel.count().catch(() => 0) > 0) {
        const ok = await tryMatSelect(matSel);
        if (ok) { addLog(session, `✅ ${fieldName}: "${value}" (mat-form-field + mat-label)`); return; }
        break;
      }
      const nativeSel = ff.locator("select").first();
      if (await nativeSel.count().catch(() => 0) > 0) {
        const chosen = await nativeSel.selectOption({ label: value }).catch(() =>
          nativeSel.selectOption({ value }).catch(() => [])
        );
        if (Array.isArray(chosen) && chosen.length > 0) {
          addLog(session, `✅ ${fieldName}: "${value}" (native select in mat-form-field)`);
          return;
        }
      }
    }
  } catch { /* تابع */ }

  // ── أسلوب 2 (Playwright): ابحث عن label بنص ثم أقرب mat-select ──────────
  try {
    const allMatSels = page.locator("mat-select");
    const cnt = await allMatSels.count().catch(() => 0);
    for (let i = 0; i < cnt; i++) {
      const ms = allMatSels.nth(i);
      // ابحث في النص الكامل للأب والأجداد (حتى 6 مستويات)
      const nearText = await ms.evaluate((el, rxSrc) => {
        const rx = new RegExp(rxSrc, "i");
        let cur: Element | null = el.parentElement;
        for (let d = 0; d < 8; d++) {
          if (!cur) break;
          // ابحث عن mat-label أو label داخل هذا الـ container
          const labels = Array.from(cur.querySelectorAll("mat-label, label, span.label, .field-label"));
          for (const lbl of labels) {
            const t = lbl.textContent?.replace(/\s+/g, " ").trim() ?? "";
            if (rx.test(t) && t.length < 80) return t;
          }
          cur = cur.parentElement;
        }
        return "";
      }, labelRx.source).catch(() => "");
      if (!labelRx.test(nearText)) continue;
      const ok = await tryMatSelect(ms);
      if (ok) { addLog(session, `✅ ${fieldName}: "${value}" (mat-select parent-walk)`); return; }
      break;
    }
  } catch { /* تابع */ }

  // ── أسلوب 3 (DOM evaluate): native select ─────────────────────────────────
  const result = await page.evaluate((rxSrc: string, targetVal: string) => {
    const rx = new RegExp(rxSrc, "i");
    const allNodes = Array.from(document.querySelectorAll("mat-label, label, span, th, td, legend"));
    for (const node of allNodes) {
      const nodeText = node.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!rx.test(nodeText) || nodeText.length > 80) continue;
      const container = node.closest("mat-form-field, .form-group, .field, tr, td")
        ?? node.parentElement?.parentElement;
      if (!container) continue;
      const sel = container.querySelector<HTMLSelectElement>("select");
      if (sel) {
        for (const opt of Array.from(sel.options)) {
          if (opt.text.trim() === targetVal || opt.value === targetVal
            || opt.text.trim().includes(targetVal) || targetVal.includes(opt.text.trim())) {
            sel.value = opt.value;
            sel.dispatchEvent(new Event("change", { bubbles: true }));
            return `native-select: "${opt.text}"`;
          }
        }
      }
    }
    return null;
  }, labelRx.source, value).catch(() => null);

  if (result) { addLog(session, `✅ ${fieldName}: "${value}" (${result})`); return; }

  // ── أسلوب 4: combobox role — يعثر على mat-select بصلاحية ARIA ──────────
  try {
    const combos = page.getByRole("combobox");
    const comboCnt = await combos.count().catch(() => 0);
    for (let ci = 0; ci < comboCnt; ci++) {
      const combo = combos.nth(ci);
      // ابحث في نص الأب حتى 10 مستويات
      const nearText = await combo.evaluate((el: Element, rxSrc: string) => {
        const rx = new RegExp(rxSrc, "i");
        let cur: Element | null = el.parentElement;
        for (let d = 0; d < 10; d++) {
          if (!cur) break;
          const labels = Array.from(cur.querySelectorAll(
            "mat-label, label, span, div, p, th, td, legend, .label"
          ));
          for (const lbl of labels) {
            const t = (lbl.textContent ?? "").replace(/\s+/g, " ").replace(/\*/g, "").trim();
            if (rx.test(t) && t.length < 100 && !lbl.contains(el)) return t;
          }
          cur = cur.parentElement;
        }
        return "";
      }, labelRx.source).catch(() => "");
      if (!labelRx.test(nearText)) continue;

      // وجدنا الـ combobox — جرب كـ native select أولاً
      try {
        const tag = await combo.evaluate((el: Element) => el.tagName.toLowerCase()).catch(() => "");
        if (tag === "select") {
          const normAr2 = (s: string) =>
            s.replace(/[\u064B-\u065F\u0670]/g, "")
             .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
             .replace(/\s+/g, " ").trim().toLowerCase();
          const chosen = await combo.evaluate((el: Element, nv: string, tv: string) => {
            const sel = el as HTMLSelectElement;
            for (const opt of Array.from(sel.options)) {
              const t = opt.text.trim();
              const nOpt = t.replace(/[\u064B-\u065F\u0670]/g, "")
                .replace(/[أإآ]/g, "ا").replace(/ة/g, "ه").replace(/ى/g, "ي")
                .replace(/\s+/g, " ").trim().toLowerCase();
              if (nOpt === nv || nOpt.includes(nv) || nv.includes(nOpt)
                  || t === tv || t.includes(tv) || tv.includes(t)) {
                sel.value = opt.value;
                sel.dispatchEvent(new Event("change", { bubbles: true }));
                return t;
              }
            }
            return null;
          }, normAr2(value), value).catch(() => null);
          if (chosen) {
            addLog(session, `✅ ${fieldName}: "${value}" ← "${chosen}" (native combobox)`);
            return;
          }
        }
      } catch { /* تابع */ }

      // جرب كـ mat-select
      const ok = await tryMatSelect(combo);
      if (ok) { addLog(session, `✅ ${fieldName}: "${value}" (combobox role + mat-select)`); return; }
      break;
    }
  } catch { /* تابع */ }

  // ── أسلوب 5: بحث شامل — كل mat-select في الصفحة + scan للـ options ──────
  try {
    const allMs = page.locator("mat-select, select");
    const allMsCnt = await allMs.count().catch(() => 0);
    for (let mi = 0; mi < allMsCnt; mi++) {
      const ms = allMs.nth(mi);
      const nearText = await ms.evaluate((el: Element, rxSrc: string) => {
        const rx = new RegExp(rxSrc, "i");
        let cur: Element | null = el.parentElement;
        for (let d = 0; d < 12; d++) {
          if (!cur) break;
          const t = (cur.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
          if (rx.test(t)) return t;
          cur = cur.parentElement;
        }
        return "";
      }, labelRx.source).catch(() => "");
      if (!labelRx.test(nearText)) continue;
      const ok = await tryMatSelect(ms);
      if (ok) { addLog(session, `✅ ${fieldName}: "${value}" (أسلوب 5 - شامل)`); return; }
      break;
    }
  } catch { /* تابع */ }

  addLog(session, `⚠️ لم يُعثر على حقل «${fieldName}» بأي أسلوب (قيمة: "${value}")`);
}

// ملء input عبر label الصفحة
async function fillInputByPageLabel(
  session: AutomationSession,
  labelRx: RegExp,
  value: string | number | null | undefined,
  fieldName: string,
): Promise<void> {
  if (value == null || value === "") { addLog(session, `ℹ️ لا توجد قيمة لـ «${fieldName}»`); return; }
  const { page } = session;
  const strVal = String(value);

  // محاولة 1: mat-form-field → mat-label مطابق → input.fill() (Playwright — الأفضل مع Angular)
  try {
    const allFFs = page.locator("mat-form-field");
    const ffCnt = await allFFs.count().catch(() => 0);
    for (let fi = 0; fi < ffCnt; fi++) {
      const ff = allFFs.nth(fi);
      const lblTxt = (await ff.locator("mat-label, label").first().textContent().catch(() => ""))
        ?.replace(/\s+/g, " ").replace(/\*/g, "").trim() ?? "";
      if (!labelRx.test(lblTxt)) continue;
      const inp = ff.locator("input").first();
      if (await inp.count().catch(() => 0) === 0) continue;
      await inp.scrollIntoViewIfNeeded().catch(() => {});
      await inp.click({ timeout: 1000 }).catch(() => {});
      await inp.fill(strVal);
      await inp.dispatchEvent("input");
      await inp.press("Tab").catch(() => {});
      addLog(session, `✅ ${fieldName}: "${strVal}" (mat-form-field → input.fill)`);
      return;
    }
  } catch { /* تابع */ }

  // محاولة 2: getByLabel (Playwright aria)
  try {
    const lbl = page.getByLabel(labelRx).first();
    if (await lbl.count().catch(() => 0) > 0) {
      await lbl.fill(strVal);
      await lbl.press("Tab").catch(() => {});
      addLog(session, `✅ ${fieldName}: "${strVal}" (getByLabel)`);
      return;
    }
  } catch { /* تابع */ }

  // محاولة 3: evaluate DOM (fallback — يبحث في labels ويحدد قيمة الـ input)
  const ok = await page.evaluate((rxSrc: string, val: string) => {
    const rx = new RegExp(rxSrc, "i");
    const labels = Array.from(document.querySelectorAll("label, span, div, td, mat-label"));
    for (const lbl of labels) {
      const txt = lbl.textContent?.replace(/\s+/g, " ").replace(/\*/g, "").trim() ?? "";
      if (!rx.test(txt) || txt.length > 80) continue;
      const container = lbl.closest("mat-form-field, .form-group, div, td") ?? lbl.parentElement;
      const inp = container?.querySelector<HTMLInputElement>("input:not([type='hidden']):not([type='radio']):not([type='checkbox'])");
      if (inp) {
        inp.focus();
        inp.value = val;
        inp.dispatchEvent(new Event("input",  { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        inp.blur();
        return true;
      }
    }
    return false;
  }, labelRx.source, strVal).catch(() => false);

  addLog(session, ok ? `✅ ${fieldName}: "${strVal}" (DOM fallback)` : `⚠️ لم يُعثر على حقل «${fieldName}»`);
}

// ملء حقل القيمة لطريقة تقييم محددة (يبحث بالنص ثم يملأ input المجاور)
async function fillValueByMethodLabel(
  session: AutomationSession,
  methodLabel: string | null | undefined,
  value: number | string | null | undefined,
  fieldName: string,
): Promise<void> {
  if (!methodLabel || value == null || value === "") {
    addLog(session, `ℹ️ لا توجد قيمة لـ «${fieldName}»`);
    return;
  }
  const { page } = session;
  const strVal = String(value);
  const prefix  = methodLabel.substring(0, Math.min(6, methodLabel.length));

  const ok = await page.evaluate((label: string, prefix: string, val: string) => {
    const allEls = Array.from(
      document.querySelectorAll("td, th, label, span, div, p, mat-label, li"),
    );
    for (const el of allEls) {
      const txt = ((el as HTMLElement).innerText ?? el.textContent ?? "")
        .replace(/\s+/g, " ").trim();
      if (!txt.includes(prefix)) continue;
      if (txt.length > 120) continue;

      // ابحث عن input في نفس الصف (tr) أو في العنصر الأب
      const row = el.closest("tr") ?? el.closest(".method-row, .row, .field-row") ?? el.parentElement;
      const inp = row?.querySelector<HTMLInputElement>(
        "input[type='text'], input:not([type='radio']):not([type='checkbox']):not([type='hidden'])",
      );
      if (inp) {
        inp.focus();
        inp.value = val;
        inp.dispatchEvent(new Event("input",  { bubbles: true }));
        inp.dispatchEvent(new Event("change", { bubbles: true }));
        inp.dispatchEvent(new Event("blur",   { bubbles: true }));
        return true;
      }
    }
    return false;
  }, methodLabel, prefix, strVal).catch(() => false);

  addLog(
    session,
    ok
      ? `✅ ${fieldName}: "${strVal}" (طريقة: "${methodLabel}")`
      : `⚠️ لم يُعثر على حقل «${fieldName}» (${methodLabel})`,
  );
}

// تحديد radio button من خلال label مجموعة الراديو (وليس label الزر الفردي)
async function clickRadioByGroupLabel(
  session: AutomationSession,
  groupLabelRx: RegExp,
  value: string,   // "نعم" أو "لا"
  fieldName: string,
): Promise<void> {
  const { page } = session;
  const wantYes = value.trim() === "نعم";
  const yesKeywords = ["نعم", "yes", "true", "1"];
  const noKeywords  = ["لا", "no", "false", "0"];

  // ── أسلوب 1 (Playwright مباشر): ابحث عن mat-radio-button بجانب label ──
  try {
    // ابحث عن جميع mat-radio-groups
    const allGroups = page.locator("mat-radio-group");
    const groupCount = await allGroups.count().catch(() => 0);
    for (let gi = 0; gi < groupCount; gi++) {
      const grp = allGroups.nth(gi);
      // جرب أن يكون النص القريب من المجموعة يطابق الـ label
      const nearText = await grp.evaluate(el => {
        // ابحث في الأب وأعلاه حتى نجد نص المجموعة
        let cur: Element | null = el.parentElement;
        for (let i = 0; i < 6; i++) {
          if (!cur) break;
          const t = (cur as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
          if (t.length > 10 && t.length < 300) return t;
          cur = cur.parentElement;
        }
        return "";
      }).catch(() => "");
      if (!groupLabelRx.test(nearText)) continue;

      // وجدنا المجموعة — اضغط على mat-radio-button المطلوب
      const buttons = grp.locator("mat-radio-button");
      const btnCount = await buttons.count().catch(() => 0);
      for (let bi = 0; bi < btnCount; bi++) {
        const btn = buttons.nth(bi);
        const btnText = (await btn.textContent().catch(() => ""))?.trim() ?? "";
        const btnVal  = (await btn.getAttribute("value").catch(() => ""))?.toLowerCase() ?? "";
        const isYes = yesKeywords.some(k => btnText.includes(k) || btnVal === k);
        const isNo  = noKeywords.some(k => btnText.includes(k) || btnVal === k);
        if ((wantYes && isYes) || (!wantYes && isNo)) {
          await btn.click({ force: true });
          await page.waitForTimeout(300);
          addLog(session, `✅ ${fieldName}: "${value}" (mat-radio-group Playwright "${btnText}")`);
          return;
        }
      }
    }
  } catch { /* تابع */ }

  // ── أسلوب 2 (evaluate DOM): ابحث بنص label ─────────────────────────────
  const result = await page.evaluate((rxSrc: string, yes: boolean, yesKws: string[], noKws: string[]) => {
    const rx = new RegExp(rxSrc, "i");

    // أ) ابحث عن عنصر نصي يطابق label ثم اعثر على radios بداخل container أبيه
    const allTextEls = Array.from(document.querySelectorAll("label, span, div, td, p, mat-label, legend, h4, h5"));
    for (const el of allTextEls) {
      const txt = (el as HTMLElement).innerText?.replace(/\s+/g, " ").trim()
        ?? el.textContent?.replace(/\s+/g, " ").trim() ?? "";
      if (!rx.test(txt) || txt.length > 100) continue;

      // ابحث عن container يحتوي أزرار الراديو (ابحث في العنصر وأعلاه وإخوته)
      const containers: (Element | null)[] = [el];
      for (let i = 0; i < 6; i++) {
        const p = containers[containers.length - 1]?.parentElement;
        if (p) containers.push(p);
      }
      // أضف الإخوة
      const parent = el.parentElement;
      if (parent) Array.from(parent.children).forEach(c => { if (c !== el) containers.push(c); });

      for (const container of containers) {
        if (!container) continue;
        // native radio inputs
        const radios = Array.from(container.querySelectorAll<HTMLInputElement>("input[type='radio']"));
        if (radios.length >= 1) {
          for (const r of radios) {
            const v = r.value?.toLowerCase();
            const lbl = (
              r.labels?.[0]?.textContent ??
              r.nextElementSibling?.textContent ??
              r.closest("mat-radio-button, label")?.textContent ??
              r.parentElement?.textContent ?? ""
            ).replace(/\s+/g, " ").trim();
            const isYes = yesKws.some(k => v === k || lbl.includes(k));
            const isNo  = noKws.some(k => v === k || lbl.includes(k));
            if ((yes && isYes) || (!yes && isNo)) {
              r.click();
              r.dispatchEvent(new MouseEvent("change", { bubbles: true }));
              return `native-radio val="${r.value}" lbl="${lbl}"`;
            }
          }
        }
        // mat-radio-button
        const matBtns = Array.from(container.querySelectorAll("mat-radio-button"));
        if (matBtns.length >= 1) {
          for (const mr of matBtns) {
            const lbl = ((mr as HTMLElement).innerText ?? mr.textContent ?? "").replace(/\s+/g, " ").trim();
            const inp = mr.querySelector<HTMLInputElement>("input[type='radio']");
            const isYes = yesKws.some(k => lbl.includes(k));
            const isNo  = noKws.some(k => lbl.includes(k));
            if ((yes && isYes) || (!yes && isNo)) {
              inp?.click();
              (mr as HTMLElement).click();
              mr.dispatchEvent(new MouseEvent("click", { bubbles: true }));
              return `mat-radio-dom lbl="${lbl}"`;
            }
          }
        }
      }
    }

    // ب) ابحث عن جميع mat-radio-group وابحث في نص الأب
    const groups = Array.from(document.querySelectorAll("mat-radio-group"));
    for (const grp of groups) {
      let cur: Element | null = grp.parentElement;
      let matched = false;
      for (let i = 0; i < 6; i++) {
        if (!cur) break;
        const t = (cur as HTMLElement).innerText?.replace(/\s+/g, " ").trim() ?? "";
        if (rx.test(t)) { matched = true; break; }
        cur = cur.parentElement;
      }
      if (!matched) continue;
      const buttons = Array.from(grp.querySelectorAll("mat-radio-button"));
      for (const btn of buttons) {
        const lbl = ((btn as HTMLElement).innerText ?? btn.textContent ?? "").replace(/\s+/g, " ").trim();
        const inp = btn.querySelector<HTMLInputElement>("input[type='radio']");
        const isYes = yesKws.some(k => lbl.includes(k));
        const isNo  = noKws.some(k => lbl.includes(k));
        if ((yes && isYes) || (!yes && isNo)) {
          inp?.click();
          (btn as HTMLElement).click();
          return `mat-radio-group-up lbl="${lbl}"`;
        }
      }
    }
    return null;
  }, groupLabelRx.source, wantYes, yesKeywords, noKeywords).catch(() => null);

  if (result) {
    await page.waitForTimeout(300);
    addLog(session, `✅ ${fieldName}: "${value}" (${result})`);
  } else {
    addLog(session, `⚠️ لم يُعثر على حقل «${fieldName}» في الصفحة`);
  }
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
// إرسال التقرير + تنزيل شهادة التسجيل + التقاط QR Code
// ─────────────────────────────────────────────────────────────────────────────
async function submitAndDownloadCertificate(
  session: AutomationSession,
  reportId: number,
  report: any,
  taqeemReportId: string,
): Promise<void> {
  const { page } = session;

  addLog(session, "═══════════════════════════════════════════════");
  addLog(session, "▶ إرسال التقرير — الخطوة 1: الموافقة على البنود");

  // ── 1. انتظار قسم "الإجراءات" ────────────────────────────────────────────
  await page.waitForSelector("text=الإجراءات", { timeout: 20000 }).catch(() =>
    addLog(session, "⚠️ قسم الإجراءات لم يظهر خلال 20 ثانية"),
  );

  // ── 2. تحديد checkbox الموافقة ────────────────────────────────────────────
  const termsLocator = page
    .locator("mat-checkbox")
    .filter({ hasText: /السياسات|اللوائح|البنود|لقد قرأت/i });
  const termsCount = await termsLocator.count().catch(() => 0);

  if (termsCount > 0) {
    const isChecked = await termsLocator
      .first()
      .locator("input[type='checkbox']")
      .isChecked()
      .catch(() => false);
    if (!isChecked) {
      await termsLocator.first().click({ force: true });
      await page.waitForTimeout(400);
    }
    addLog(session, '✅ "لقد قرأت السياسات واللوائح وأوافق عليها" — تم التحديد');
  } else {
    // Fallback: ابحث عن input[type=checkbox] بجوار نص الموافقة
    const fallbackChecked = await page.evaluate(() => {
      const labels = Array.from(document.querySelectorAll("label, span, p"));
      const target = labels.find(el => /السياسات|اللوائح|لقد قرأت/i.test(el.textContent ?? ""));
      if (!target) return false;
      const cb =
        target.querySelector<HTMLInputElement>("input[type='checkbox']") ??
        target.closest("label")?.querySelector<HTMLInputElement>("input[type='checkbox']");
      if (cb && !cb.checked) { cb.click(); return true; }
      return !!cb;
    });
    addLog(session, fallbackChecked
      ? '✅ terms (fallback) — تم التحديد'
      : '⚠️ checkbox الموافقة لم يُعثر عليه — تابع على مسؤوليتك');
  }
  await page.waitForTimeout(600);

  // ── 3. ضغط "إرسال التقرير" ───────────────────────────────────────────────
  addLog(session, "▶ الخطوة 2: ضغط إرسال التقرير");
  const submitBtn = page.locator("button").filter({ hasText: /إرسال التقرير/i });
  const submitCount = await submitBtn.count().catch(() => 0);

  if (submitCount === 0) {
    addLog(session, '⚠️ زر "إرسال التقرير" غير موجود — الانتظار للمراجعة اليدوية');
    await updateReport(reportId, { automationStatus: "waiting_review", automationError: null });
    closeSession(session.sessionId);
    return;
  }

  await submitBtn.first().click();
  addLog(session, '✅ تم الضغط على "إرسال التقرير"');

  // ── 4. انتظار صفحة التأكيد ───────────────────────────────────────────────
  addLog(session, "▶ الخطوة 3: انتظار صفحة التأكيد");
  await page.waitForLoadState("networkidle", { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(3000);
  await screenshot(page, `submitted_${reportId}`);
  const afterSubmitUrl = page.url();
  addLog(session, `📄 صفحة ما بعد الإرسال: ${afterSubmitUrl}`);

  // ── تحقق من نجاح الإرسال أو وجود أخطاء ────────────────────────────────
  const pageTextAfterSubmit = await page.evaluate(() => document.body.innerText ?? "").catch(() => "");
  addLog(session, `📝 محتوى الصفحة (أول 400 حرف):\n${pageTextAfterSubmit.slice(0, 400)}`);

  // هل يوجد رسائل خطأ في الصفحة؟
  const hasError = /خطأ|error|فشل|غير صحيح|مطلوب|required/i.test(pageTextAfterSubmit);
  const hasSuccess = /تم|نجح|success|مكتمل|بنجاح|شكراً|شهادة/i.test(pageTextAfterSubmit);
  if (hasError && !hasSuccess) {
    addLog(session, `⚠️ يوجد رسائل خطأ في صفحة التأكيد — قد يكون الإرسال فشل`);
    addLog(session, `   نص الخطأ: ${pageTextAfterSubmit.slice(0, 200)}`);
  } else if (hasSuccess) {
    addLog(session, `✅ تأكيد النجاح: الصفحة تحتوي على رسالة نجاح`);
  } else {
    addLog(session, `ℹ️ لم يتغير URL ولم يُكتشف نجاح أو خطأ واضح`);
  }

  // ── استخراج رقم التقرير الفعلي من صفحة التأكيد ─────────────────────────
  // 1. بحث في URL بعد الإرسال (قد يتغير لشيء مثل /report/1234567/view)
  const urlReportMatch = afterSubmitUrl.match(/\/report\/(\d{5,})/);
  // 2. بحث في نص الصفحة عن "رقم التقرير" أو "Report Number"
  const textReportMatch = pageTextAfterSubmit.match(
    /(?:رقم التقرير|رقم الطلب|رقم القيمة|report\s*(?:number|no|#))[:\s]*([A-Za-z0-9\-\/]+)/i
  );
  // 3. بحث عن تسلسل أرقام طويل بجوار كلمة عربية (مثل "التقرير 1694177")
  const nearbyNumMatch = pageTextAfterSubmit.match(/(?:التقرير|الطلب|رقم)[:\s]*(\d{5,})/);

  const finalTaqeemReportNum =
    textReportMatch?.[1]?.trim() ||
    nearbyNumMatch?.[1]?.trim() ||
    urlReportMatch?.[1]?.trim() ||
    taqeemReportId; // احتياط: رقم URL من صفحة 2

  if (finalTaqeemReportNum !== taqeemReportId) {
    addLog(session, `🆔 رقم التقرير النهائي من TAQEEM: ${finalTaqeemReportNum} (كان: ${taqeemReportId})`);
    await updateReport(reportId, { taqeemReportNumber: finalTaqeemReportNum });
    taqeemReportId = finalTaqeemReportNum; // تحديث المتغير للاستخدام لاحقاً
  } else {
    addLog(session, `ℹ️ رقم التقرير المستخدم: ${taqeemReportId} (من URL الصفحة 2)`);
  }

  // ── 5. التقاط QR Code ────────────────────────────────────────────────────
  addLog(session, "▶ الخطوة 4: التقاط QR Code");
  let qrBase64: string | null = null;

  // محاولة 1: img data:image بداخل الصفحة
  qrBase64 = await page.evaluate(() => {
    const imgs = Array.from(document.querySelectorAll<HTMLImageElement>("img"));
    const qr = imgs.find(img =>
      img.src.startsWith("data:image") && img.naturalWidth > 50 && img.naturalHeight > 50,
    );
    return qr ? qr.src : null;
  }).catch(() => null);

  // محاولة 2: canvas
  if (!qrBase64) {
    qrBase64 = await page.evaluate(() => {
      const canvases = Array.from(document.querySelectorAll<HTMLCanvasElement>("canvas"));
      const qr = canvases.find(c => c.width > 50 && c.height > 50);
      return qr ? qr.toDataURL("image/png") : null;
    }).catch(() => null);
  }

  // محاولة 3: screenshot لأي img كبيرة في الصفحة (likely QR)
  if (!qrBase64) {
    try {
      const imgLocator = page.locator("img").last();
      if ((await imgLocator.count()) > 0) {
        const buf = await imgLocator.screenshot({ type: "png" });
        qrBase64 = `data:image/png;base64,${buf.toString("base64")}`;
      }
    } catch { /* تجاهل */ }
  }

  if (qrBase64) {
    addLog(session, `✅ QR Code التُقط (${Math.round(qrBase64.length / 1024)} KB)`);
  } else {
    addLog(session, "⚠️ لم يُعثر على QR Code في الصفحة");
  }

  // ── 6. تنزيل شهادة التسجيل ───────────────────────────────────────────────
  addLog(session, "▶ الخطوة 5: تنزيل شهادة التسجيل");
  let certificatePath: string | null = null;

  const certBtn = page.locator("button").filter({ hasText: /شهادة التسجيل/i });
  const certCount = await certBtn.count().catch(() => 0);

  if (certCount > 0) {
    try {
      const certDir = path.join(process.cwd(), "uploads", "certificates");
      await fs.promises.mkdir(certDir, { recursive: true });

      const [download] = await Promise.all([
        page.waitForEvent("download", { timeout: 30000 }),
        certBtn.first().click(),
      ]);
      const suggestedName = download.suggestedFilename() || `certificate_${reportId}.pdf`;
      const savePath = path.join(certDir, `${reportId}_${suggestedName}`);
      await download.saveAs(savePath);
      certificatePath = savePath;
      addLog(session, `✅ شهادة التسجيل نُزِّلت: ${savePath}`);
    } catch (e) {
      addLog(session, `⚠️ فشل تنزيل الشهادة: ${String(e).slice(0, 80)}`);
    }
  } else {
    addLog(session, '⚠️ زر "شهادة التسجيل" غير موجود بعد');
  }

  // ── 7. حفظ في قاعدة البيانات ─────────────────────────────────────────────
  addLog(session, "▶ الخطوة 6: حفظ QR والشهادة في قاعدة البيانات");
  const submittedAt = new Date().toISOString();
  // إذا صدر رقم من نظام تقييم → الحالة "submitted_taqeem" وإلا "completed"
  const hasNumber = !!finalTaqeemReportNum;
  const finalAutomationStatus = hasNumber ? "submitted_taqeem" : "completed";
  if (hasNumber) {
    addLog(session, `🏆 رقم تقييم صدر: ${finalTaqeemReportNum} → الحالة: تم الرفع لتقييم`);
  }
  const updateData: Record<string, any> = {
    status: "submitted",
    automationStatus: finalAutomationStatus,
    automationError: null,
    taqeemSubmittedAt: submittedAt,
    taqeemReportNumber: finalTaqeemReportNum,
  };
  if (qrBase64) updateData.qrCodeBase64 = qrBase64;
  if (certificatePath) updateData.certificatePath = certificatePath;
  await updateReport(reportId, updateData);

  // ── 8. إرسال QRInformationApi → http://localhost:8080/External/QrInformationApi ─
  addLog(session, "▶ الخطوة 7: إرسال QRInformationApi");
  try {
    // reportCode: جلب من جدول datasystem — الكود المُرسَل من النظام الخارجي
    const dsRecord = await sqliteGetDataSystemByReportId(reportId).catch(() => null);
    const reportCode = dsRecord?.reportCode ?? "";
    addLog(session, `🔑 reportCode من datasystem: "${reportCode}"`);

    const formData = new FormData();
    formData.append("reportCode",         reportCode);
    formData.append("taqeemReportNumber", taqeemReportId);
    formData.append("taqeemSubmittedAt",  submittedAt);
    formData.append("qrCodeBase64",       qrBase64 ?? "");

    // ── إرسال كامل بيانات جدول datasystem كـ JSON ────────────────────────────
    if (dsRecord) {
      // إزالة الحقول التقنية الداخلية، إبقاء بيانات التقرير فقط
      const { id: _id, filePath: _fp, reportCode: _rc, ...reportFields } = dsRecord;
      formData.append("reportData", JSON.stringify(reportFields));
      addLog(session, `📋 reportData: ${Object.keys(reportFields).length} حقل مُرفق`);
    }

    if (certificatePath && fs.existsSync(certificatePath)) {
      const fileBuffer = fs.readFileSync(certificatePath);
      const blob = new Blob([fileBuffer], { type: "application/pdf" });
      formData.append("certificatePath", blob, path.basename(certificatePath));
    }

    const resp = await fetch("http://localhost:8080/External/QrInformationApi", {
      method: "POST",
      body: formData,
    });

    if (resp.ok) {
      addLog(session, `✅ QRInformationApi: ${resp.status} ${resp.statusText}`);
    } else {
      const body = await resp.text().catch(() => "");
      addLog(session, `⚠️ QRInformationApi: ${resp.status} — ${body.slice(0, 120)}`);
    }
  } catch (e) {
    addLog(session, `⚠️ QRInformationApi فشل الاتصال: ${String(e).slice(0, 100)}`);
  }

  addLog(session, "═══════════════════════════════════════════════");
  addLog(session, `✅ اكتمل إرسال التقرير [id=${reportId}] — QR: ${qrBase64 ? "✓" : "✗"} | شهادة: ${certificatePath ? "✓" : "✗"}`);
  addLog(session, "═══════════════════════════════════════════════");

  closeSession(session.sessionId);
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
