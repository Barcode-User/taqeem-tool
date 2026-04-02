import { chromium } from "playwright";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { db, reportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import {
  createSession,
  closeSession,
  waitForOtp,
  addLog,
  type AutomationSession,
} from "./session-manager";

const TAQEEM_URL = "https://qima.taqeem.gov.sa";
const UPLOADS_DIR = path.join(process.cwd(), "uploads");

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export type AutomationOptions = {
  username: string;
  password: string;
  headless?: boolean;
};

export type AutomationResult = {
  success: boolean;
  qrCodeBase64?: string;
  certificatePath?: string;
  taqeemReportNumber?: string;
  error?: string;
  logs: string[];
};

export async function startAutomation(
  reportId: number,
  options: AutomationOptions,
): Promise<string> {
  const sessionId = randomUUID();

  const browser = await chromium.launch({
    headless: options.headless ?? true,
    args: [
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu",
    ],
  });

  const context = await browser.newContext({
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  });

  const page = await context.newPage();
  const session = createSession(sessionId, reportId, browser, context, page);

  await db
    .update(reportsTable)
    .set({
      automationStatus: "running",
      automationError: null,
      automationSessionId: sessionId,
    })
    .where(eq(reportsTable.id, reportId));

  runAutomation(session, reportId, options).catch(async (err) => {
    addLog(session, `Fatal error: ${err.message}`);
    await db
      .update(reportsTable)
      .set({
        automationStatus: "failed",
        automationError: err.message,
      })
      .where(eq(reportsTable.id, reportId));
    await closeSession(sessionId);
  });

  return sessionId;
}

async function runAutomation(
  session: AutomationSession,
  reportId: number,
  options: AutomationOptions,
): Promise<void> {
  const { page } = session;

  try {
    const [report] = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId));

    if (!report) throw new Error(`Report ${reportId} not found`);

    addLog(session, "بدء عملية الأتمتة...");

    // ─── STEP 1: Login ───────────────────────────────────────────────
    addLog(session, "الانتقال إلى صفحة تسجيل الدخول...");
    await page.goto(`${TAQEEM_URL}/membership/login`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    addLog(session, "إدخال بيانات الدخول...");
    // ⚠️ TODO: Update these selectors based on actual TAQEEM login page
    await page.fill('input[name="username"], input[type="text"]', options.username);
    await page.fill('input[name="password"], input[type="password"]', options.password);
    await page.click('button[type="submit"], input[type="submit"]');

    // ─── STEP 2: Handle OTP ──────────────────────────────────────────
    addLog(session, "انتظار صفحة OTP...");
    await db
      .update(reportsTable)
      .set({ automationStatus: "waiting_otp" })
      .where(eq(reportsTable.id, reportId));

    const otp = await waitForOtp(session);
    addLog(session, "تم استلام OTP، جارٍ إدخاله...");

    // ⚠️ TODO: Update OTP field selector based on actual TAQEEM platform
    await page.fill('input[name="otp"], input[placeholder*="OTP"], input[placeholder*="رمز"]', otp);
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });

    addLog(session, "تم تسجيل الدخول بنجاح.");

    // ─── STEP 3: Navigate to New Report ─────────────────────────────
    addLog(session, "الانتقال لإنشاء تقرير جديد...");
    // ⚠️ TODO: Update URL/selector for creating new report
    await page.goto(`${TAQEEM_URL}/membership/report/create`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // ─── STEP 4: Fill Report Fields ─────────────────────────────────
    addLog(session, "تعبئة بيانات التقرير...");
    await fillReportForm(session, report);

    // ─── STEP 5: Upload PDF ─────────────────────────────────────────
    if (report.pdfFilePath && fs.existsSync(report.pdfFilePath)) {
      addLog(session, "رفع ملف PDF...");
      // ⚠️ TODO: Update file input selector
      const fileInput = await page.$('input[type="file"]');
      if (fileInput) {
        await fileInput.setInputFiles(report.pdfFilePath);
        addLog(session, "تم رفع ملف PDF.");
      }
    }

    // ─── STEP 6: Submit ─────────────────────────────────────────────
    addLog(session, "إرسال التقرير...");
    // ⚠️ TODO: Update submit button selector
    await page.click('button[type="submit"]:has-text("حفظ"), button:has-text("إرسال"), button:has-text("رفع")');
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });

    // ─── STEP 7: Get QR Code & Certificate ─────────────────────────
    addLog(session, "استخراج QR Code والشهادة...");
    const result = await extractQrAndCertificate(session, reportId);

    // ─── STEP 8: Update DB with results ────────────────────────────
    await db
      .update(reportsTable)
      .set({
        automationStatus: "completed",
        qrCodeBase64: result.qrCodeBase64 ?? null,
        certificatePath: result.certificatePath ?? null,
        taqeemSubmittedAt: new Date().toISOString(),
        taqeemReportNumber: result.taqeemReportNumber ?? report.taqeemReportNumber,
      })
      .where(eq(reportsTable.id, reportId));

    addLog(session, "✅ اكتملت العملية بنجاح!");
  } catch (err: any) {
    addLog(session, `❌ خطأ: ${err.message}`);
    await db
      .update(reportsTable)
      .set({
        automationStatus: "failed",
        automationError: err.message,
      })
      .where(eq(reportsTable.id, reportId));
    throw err;
  } finally {
    await closeSession(session.sessionId);
  }
}

async function fillReportForm(
  session: AutomationSession,
  report: any,
): Promise<void> {
  const { page } = session;

  // ⚠️ ═══════════════════════════════════════════════════════════
  // ⚠️  يجب تحديث هذه المحددات (selectors) بناءً على لقطات الشاشة
  // ⚠️  من منصة تقييم التي ستُرسلها
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
      if (el) await page.selectOption(selector, { label: value }).catch(() =>
        page.selectOption(selector, { value }).catch(() => {})
      );
    } catch {}
  };

  // Report info
  await fillIfExists('[name="report_number"], [id*="report_number"]', report.reportNumber);
  await fillIfExists('[name="report_date"], [id*="report_date"]', report.reportDate);
  await fillIfExists('[name="valuation_date"], [id*="valuation_date"]', report.valuationDate);
  await fillIfExists('[name="request_number"], [id*="request_number"]', report.requestNumber);

  // Client info
  await fillIfExists('[name="client_name"], [id*="client"]', report.clientName);
  await fillIfExists('[name="client_email"]', report.clientEmail);
  await fillIfExists('[name="client_phone"]', report.clientPhone);

  // Property info
  await selectIfExists('[name="property_type"], select[id*="property_type"]', report.propertyType);
  await selectIfExists('[name="property_use"], select[id*="use"]', report.propertyUse);
  await selectIfExists('[name="region"], select[id*="region"]', report.region);
  await fillIfExists('[name="city"], [id*="city"]', report.city);
  await fillIfExists('[name="district"], [id*="district"]', report.district);
  await fillIfExists('[name="deed_number"], [id*="deed"]', report.deedNumber);
  await fillIfExists('[name="land_area"], [id*="land_area"]', report.landArea);

  // Valuation
  await fillIfExists('[name="final_value"], [id*="final_value"]', report.finalValue);
  await selectIfExists('[name="valuation_method"], select[id*="method"]', report.valuationMethod);

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

  // ⚠️ TODO: Update selectors based on TAQEEM confirmation page
  try {
    // Try to get report number from the confirmation page
    const reportNumEl = await page.$('[id*="report_number"], .report-number, [class*="report-num"]');
    if (reportNumEl) {
      taqeemReportNumber = await reportNumEl.innerText();
      taqeemReportNumber = taqeemReportNumber.trim();
    }

    // Try to find QR code image
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

    // Try to download certificate PDF
    const certFilename = `certificate_${reportId}_${Date.now()}.pdf`;
    const certPath = path.join(UPLOADS_DIR, certFilename);

    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 5000 }).catch(() => null),
      page.click('a[href*="certificate"], a[href*="شهادة"], button:has-text("تحميل الشهادة")').catch(() => {}),
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
