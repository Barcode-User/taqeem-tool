import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { getReportById, updateReport } from "@workspace/db";
import {
  createSession,
  closeSession,
  waitForOtp,
  addLog,
  type AutomationSession,
} from "./session-manager";
import { getAuthenticatedContext } from "./taqeem-session-store";

const TAQEEM_URL = "https://qima.taqeem.gov.sa";
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export type AutomationOptions = {
  headless?: boolean;
};

export async function startAutomation(
  reportId: number,
  options: AutomationOptions = {},
): Promise<string> {
  // Check that we have an authenticated session before starting
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

async function runAutomation(session: AutomationSession, reportId: number): Promise<void> {
  const { page } = session;

  try {
    const report = await getReportById(reportId);
    if (!report) throw new Error(`التقرير ${reportId} غير موجود`);

    addLog(session, "بدء عملية الرفع الآلي...");

    // ─── STEP 1: Navigate to New Report ─────────────────────────────
    addLog(session, "الانتقال لإنشاء تقرير جديد...");
    // ⚠️ TODO: تحديث الرابط الصحيح لصفحة إنشاء تقرير جديد
    await page.goto(`${TAQEEM_URL}/membership/report/create`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Check if session expired (redirected to login)
    if (page.url().includes("/login")) {
      throw new Error("انتهت الجلسة — يرجى تسجيل الدخول مجدداً من صفحة الإعدادات.");
    }

    // ─── STEP 2: Fill Report Fields ─────────────────────────────────
    addLog(session, "تعبئة بيانات التقرير...");
    await fillReportForm(session, report);

    // ─── STEP 3: Upload PDF ─────────────────────────────────────────
    if (report.pdfFilePath && fs.existsSync(report.pdfFilePath)) {
      addLog(session, "رفع ملف PDF...");
      // ⚠️ TODO: تحديث محدد حقل رفع الملف
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(report.pdfFilePath);
        addLog(session, "تم رفع ملف PDF.");
      }
    }

    // ─── STEP 4: Submit ─────────────────────────────────────────────
    addLog(session, "إرسال التقرير...");
    // ⚠️ TODO: تحديث محدد زر الإرسال
    await page.click(
      'button[type="submit"]:has-text("حفظ"), button:has-text("إرسال"), button:has-text("رفع")',
    );
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });

    // ─── STEP 5: Get QR Code & Certificate ─────────────────────────
    addLog(session, "استخراج QR Code والشهادة...");
    const result = await extractQrAndCertificate(session, reportId);

    // ─── STEP 6: Update DB — مكتمل ─────────────────────────────────
    await updateReport(reportId, {
      status:             "submitted",
      automationStatus:   "completed",
      qrCodeBase64:       result.qrCodeBase64    ?? null,
      certificatePath:    result.certificatePath ?? null,
      taqeemSubmittedAt:  new Date().toISOString(),
      taqeemReportNumber: result.taqeemReportNumber ?? report.taqeemReportNumber,
    });

    addLog(session, "✅ اكتملت العملية بنجاح! — تم الرفع على منصة تقييم");
  } catch (err: any) {
    addLog(session, `❌ خطأ: ${err.message}`);
    await updateReport(reportId, { automationStatus: "failed", automationError: err.message });
    throw err;
  } finally {
    try { await page.close(); } catch {}
    closeSession(session.sessionId);
  }
}

async function fillReportForm(session: AutomationSession, report: any): Promise<void> {
  const { page } = session;

  // ⚠️ ═══════════════════════════════════════════════════════════
  // ⚠️  يجب تحديث هذه المحددات (selectors) بناءً على لقطات الشاشة
  // ⚠│  من منصة تقييم التي ستُرسلها
  // ⚠️ ═══════════════════════════════════════════════════════════

  const fillIfExists = async (selector: string, value: string | number | null | undefined) => {
    if (!value) return;
    try {
      const el = await page.$(selector);
      if (el) await page.fill(selector, String(value));
    } catch {}
  };

  const selectIfExists = async (selector: string, value: string | null | undefined) => {
    if (!value) return;
    try {
      const el = await page.$(selector);
      if (el)
        await page
          .selectOption(selector, { label: value })
          .catch(() => page.selectOption(selector, { value }).catch(() => {}));
    } catch {}
  };

  await fillIfExists('[name="report_number"], [id*="report_number"]', report.reportNumber);
  await fillIfExists('[name="report_date"], [id*="report_date"]', report.reportDate);
  await fillIfExists('[name="valuation_date"], [id*="valuation_date"]', report.valuationDate);
  await fillIfExists('[name="request_number"], [id*="request_number"]', report.requestNumber);
  await fillIfExists('[name="client_name"], [id*="client"]', report.clientName);
  await fillIfExists('[name="client_email"]', report.clientEmail);
  await fillIfExists('[name="client_phone"]', report.clientPhone);
  await selectIfExists('[name="property_type"], select[id*="property_type"]', report.propertyType);
  await selectIfExists('[name="property_use"], select[id*="use"]', report.propertyUse);
  await selectIfExists('[name="region"], select[id*="region"]', report.region);
  await fillIfExists('[name="city"], [id*="city"]', report.city);
  await fillIfExists('[name="district"], [id*="district"]', report.district);
  await fillIfExists('[name="deed_number"], [id*="deed"]', report.deedNumber);
  await fillIfExists('[name="land_area"], [id*="land_area"]', report.landArea);
  await fillIfExists('[name="final_value"], [id*="final_value"]', report.finalValue);
  await selectIfExists(
    '[name="valuation_method"], select[id*="method"]',
    report.valuationMethod,
  );

  addLog(session, "تم تعبئة حقول النموذج.");
}

async function extractQrAndCertificate(
  session: AutomationSession,
  reportId: number,
): Promise<{ qrCodeBase64?: string; certificatePath?: string; taqeemReportNumber?: string }> {
  const { page } = session;
  let qrCodeBase64: string | undefined;
  let certificatePath: string | undefined;
  let taqeemReportNumber: string | undefined;

  try {
    const reportNumEl = await page.$(
      '[id*="report_number"], .report-number, [class*="report-num"]',
    );
    if (reportNumEl) {
      taqeemReportNumber = (await reportNumEl.innerText()).trim();
    }

    const qrImg = await page.$('img[src*="qr"], img[alt*="QR"], canvas[id*="qr"]');
    if (qrImg) {
      const qrSrc = await qrImg.getAttribute("src");
      if (qrSrc?.startsWith("data:")) {
        qrCodeBase64 = qrSrc;
      } else if (qrSrc) {
        const qrResponse = await page.context().request.get(qrSrc);
        const buffer = await qrResponse.body();
        qrCodeBase64 = `data:image/png;base64,${buffer.toString("base64")}`;
      }
      addLog(session, "تم استخراج QR Code.");
    }

    const certFilename = `certificate_${reportId}_${Date.now()}.pdf`;
    const certPath = path.join(UPLOADS_DIR, certFilename);
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
      page
        .click(
          'a[href*="certificate"], a[href*="شهادة"], button:has-text("تحميل الشهادة")',
        )
        .catch(() => {}),
    ]);
    if (download) {
      await download.saveAs(certPath);
      certificatePath = certPath;
      addLog(session, "تم تحميل الشهادة.");
    }
  } catch (err: any) {
    addLog(session, `تحذير: لم يتم استخراج QR/الشهادة - ${err.message}`);
  }

  return { qrCodeBase64, certificatePath, taqeemReportNumber };
}
