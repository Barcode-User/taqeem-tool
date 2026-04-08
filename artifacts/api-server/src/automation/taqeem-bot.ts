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

    // ─── STEP 1: الانتقال لصفحة إنشاء تقرير جديد ────────────────────
    addLog(session, "فتح صفحة إنشاء تقرير جديد...");
    await page.goto(`${TAQEEM_URL}/report/create/1/13`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    if (page.url().includes("/login") || page.url().includes("sso.taqeem")) {
      throw new Error("انتهت الجلسة — يرجى تسجيل الدخول مجدداً من صفحة الإعدادات.");
    }

    addLog(session, `✅ تم فتح الصفحة: ${page.url()}`);

    // ─── STEP 2: تعبئة النموذج ───────────────────────────────────────
    addLog(session, "بدء تعبئة بيانات التقرير...");
    await fillReportForm(session, report);

    // ─── STEP 3: رفع ملف PDF ────────────────────────────────────────
    if (report.pdfFilePath && fs.existsSync(report.pdfFilePath)) {
      addLog(session, "رفع ملف PDF...");
      try {
        const fileInput = await page.$('input[type="file"]');
        if (fileInput) {
          await fileInput.setInputFiles(report.pdfFilePath);
          await page.waitForTimeout(1000);
          addLog(session, "✅ تم رفع ملف PDF.");
        } else {
          addLog(session, "⚠️ لم يُعثر على حقل رفع الملف.");
        }
      } catch (e: any) {
        addLog(session, `⚠️ خطأ في رفع PDF: ${e.message}`);
      }
    } else {
      addLog(session, "⚠️ لا يوجد ملف PDF مرتبط بهذا التقرير.");
    }

    // ─── STEP 4: لقطة شاشة للمراجعة ────────────────────────────────
    const screenshotPath = path.join(UPLOADS_DIR, `filled_form_${reportId}_${Date.now()}.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true }).catch(() => {});
    addLog(session, `📸 لقطة شاشة محفوظة في: ${screenshotPath}`);

    // ─── تحديث الحالة: جاهز للمراجعة ────────────────────────────────
    await updateReport(reportId, {
      automationStatus: "waiting_review",
      automationError: null,
    });

    addLog(session, "✅ تم تعبئة جميع الحقول — راجع البيانات في المتصفح ثم اضغط «حفظ واستمرار» أو «حفظ وإغلاق» يدوياً.");
    addLog(session, "🔵 المتصفح مفتوح أمامك للمراجعة — لن يُغلق تلقائياً.");

    // لا نُغلق الصفحة — نتركها مفتوحة للمستخدم للمراجعة
    closeSession(session.sessionId);

  } catch (err: any) {
    addLog(session, `❌ خطأ: ${err.message}`);
    await updateReport(reportId, { automationStatus: "failed", automationError: err.message });
    try { await page.close(); } catch {}
    closeSession(session.sessionId);
    throw err;
  }
}

async function fillReportForm(session: AutomationSession, report: any): Promise<void> {
  const { page } = session;

  // ─── أدوات مساعدة ────────────────────────────────────────────────

  // تعبئة حقل نصي بالبحث عن تسمية اللافتة أولاً ثم الـ placeholder
  const fillByLabel = async (labelAr: string, value: string | number | null | undefined) => {
    if (value === null || value === undefined || value === "") return;
    const val = String(value);
    try {
      await page.getByLabel(labelAr, { exact: false }).first().fill(val);
      addLog(session, `✅ ${labelAr}: ${val}`);
      return;
    } catch {}
    // fallback: ابحث عن input بعد اللافتة
    try {
      const label = page.locator(`label, span, div`).filter({ hasText: new RegExp(labelAr, "i") }).first();
      const input = label.locator("xpath=following::input[1] | xpath=following::textarea[1]");
      await input.fill(val);
      addLog(session, `✅ ${labelAr}: ${val}`);
    } catch {
      addLog(session, `⚠️ لم يتم تعبئة "${labelAr}"`);
    }
  };

  // اختيار قيمة من قائمة منسدلة
  const selectByLabel = async (labelAr: string, value: string | null | undefined) => {
    if (!value) return;
    try {
      const sel = page.getByLabel(labelAr, { exact: false }).first();
      await sel.selectOption({ label: value }).catch(() => sel.selectOption({ value }));
      addLog(session, `✅ ${labelAr}: ${value}`);
      return;
    } catch {}
    // fallback: ابحث عن select بعد اللافتة
    try {
      const label = page.locator(`label, span, div`).filter({ hasText: new RegExp(labelAr, "i") }).first();
      const select = label.locator("xpath=following::select[1]");
      await select.selectOption({ label: value }).catch(() => select.selectOption({ value }));
      addLog(session, `✅ ${labelAr}: ${value}`);
    } catch {
      addLog(session, `⚠️ لم يتم تحديد "${labelAr}": ${value}`);
    }
  };

  // تحديد زر radio
  const checkRadio = async (labelAr: string) => {
    try {
      await page.getByLabel(labelAr, { exact: false }).first().check();
      addLog(session, `✅ نوع التقرير: ${labelAr}`);
    } catch {
      addLog(session, `⚠️ لم يتم تحديد نوع التقرير "${labelAr}"`);
    }
  };

  // تعبئة حقل تاريخ
  const fillDate = async (labelAr: string, value: string | null | undefined) => {
    if (!value) return;
    // تحويل التاريخ لصيغة YYYY-MM-DD إذا لزم
    const dateVal = value.replace(/\//g, "-");
    try {
      const input = page.getByLabel(labelAr, { exact: false }).first();
      await input.fill(dateVal);
      await page.keyboard.press("Tab");
      addLog(session, `✅ ${labelAr}: ${dateVal}`);
    } catch {
      addLog(session, `⚠️ لم يتم تعبئة تاريخ "${labelAr}"`);
    }
  };

  await page.waitForTimeout(1500);

  // ════════════════════════════════════════════════════════════════════
  // معلومات التقرير
  // ════════════════════════════════════════════════════════════════════

  // عنوان التقرير (نستخدم رقم التقرير كعنوان)
  await fillByLabel("عنوان التقرير", report.reportNumber);

  // الغرض من التقييم (dropdown)
  await selectByLabel("الغرض من التقييم", report.valuationPurpose);

  // فرضية القيمة (dropdown)
  await selectByLabel("فرضية القيمة", report.valuationBasis);

  // أساس القيمة (dropdown)
  await selectByLabel("أساس القيمة", report.valuationMethod);

  // نوع التقرير (radio buttons)
  // القيم الممكنة: تقرير مفصل | ملخص التقرير | مراجعة مع قيمة جديدة | مراجعة بدون قيمة جديدة
  if (report.reportType) {
    await checkRadio(report.reportType);
  }

  // تاريخ التقييم
  await fillDate("تاريخ التقييم", report.valuationDate);

  // تاريخ إصدار التقرير
  await fillDate("تاريخ إصدار التقرير", report.reportDate);

  // الافتراضات
  await fillByLabel("الافتراضات", report.notes);

  // الرأي النهائي في القيمة
  await fillByLabel("الرأي النهائي في القيمة", report.finalValue);

  await page.waitForTimeout(500);

  // ════════════════════════════════════════════════════════════════════
  // بيانات العميل
  // ════════════════════════════════════════════════════════════════════

  // اسم العميل
  await fillByLabel("اسم العميل", report.clientName);

  // رقم الهاتف
  await fillByLabel("رقم الهاتف", report.clientPhone);

  // البريد الإلكتروني
  await fillByLabel("البريد الإلكتروني", report.clientEmail);

  await page.waitForTimeout(500);

  addLog(session, "✅ اكتملت تعبئة جميع الحقول.");
}

export async function submitSavedForm(reportId: number): Promise<void> {
  // يُستدعى لاحقاً إذا أراد المستخدم الإرسال التلقائي بعد المراجعة
  const context = await getAuthenticatedContext();
  if (!context) throw new Error("لا توجد جلسة مسجّلة.");

  const pages = context.pages();
  const formPage = pages.find(p => p.url().includes("/report/create"));
  if (!formPage) throw new Error("لم يتم العثور على صفحة النموذج المفتوحة.");

  // الضغط على حفظ واستمرار
  await formPage.click('button:has-text("حفظ واستمرار")');
  await formPage.waitForLoadState("networkidle", { timeout: 30000 });

  await updateReport(reportId, {
    status: "submitted",
    automationStatus: "completed",
    taqeemSubmittedAt: new Date().toISOString(),
  });
}
