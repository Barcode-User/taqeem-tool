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

    // ─── STEP 1: الانتقال لصفحة إنشاء تقرير ─────────────────────────
    addLog(session, "فتح صفحة إنشاء تقرير جديد...");
    await page.goto(`${TAQEEM_URL}/report/create/1/13`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });

    // انتظار تحميل Angular
    await page.waitForTimeout(3000);

    if (page.url().includes("/login") || page.url().includes("sso.taqeem")) {
      throw new Error("انتهت الجلسة — يرجى تسجيل الدخول مجدداً من صفحة الإعدادات.");
    }

    addLog(session, `✅ تم فتح الصفحة: ${page.url()}`);

    // ─── تشخيص: قراءة جميع عناصر النموذج ───────────────────────────
    const formElements = await page.evaluate(() => {
      const result: any[] = [];
      document.querySelectorAll("input, select, textarea").forEach((el: any) => {
        const rect = el.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return; // مخفي
        // اقرأ النص القريب من العنصر (label)
        let labelText = "";
        const id = el.id;
        if (id) {
          const lbl = document.querySelector(`label[for="${id}"]`);
          if (lbl) labelText = lbl.textContent?.trim() ?? "";
        }
        if (!labelText) {
          // ابحث في العنصر الأب
          let parent = el.parentElement;
          for (let i = 0; i < 5 && parent; i++) {
            const t = parent.textContent?.replace(el.value, "").trim();
            if (t && t.length < 60) { labelText = t; break; }
            parent = parent.parentElement;
          }
        }
        result.push({
          tag: el.tagName,
          type: el.type ?? "",
          name: el.name ?? "",
          id: el.id ?? "",
          placeholder: el.placeholder ?? "",
          formControlName: el.getAttribute("formcontrolname") ?? "",
          ngModel: el.getAttribute("[(ngmodel)]") ?? el.getAttribute("ng-model") ?? "",
          ariaLabel: el.getAttribute("aria-label") ?? "",
          value: el.value ?? "",
          labelText: labelText.substring(0, 50),
          y: Math.round(rect.y),
        });
      });
      return result.sort((a, b) => a.y - b.y);
    });

    // سجّل العناصر في ملف للتشخيص
    const debugPath = path.join(UPLOADS_DIR, `form_debug_${reportId}_${Date.now()}.json`);
    fs.writeFileSync(debugPath, JSON.stringify(formElements, null, 2));
    addLog(session, `🔍 وُجد ${formElements.length} عنصر في النموذج — مُحفَظ في: ${debugPath}`);
    formElements.forEach((el, i) => {
      addLog(session, `  [${i}] ${el.tag} | name="${el.name}" | id="${el.id}" | formControlName="${el.formControlName}" | placeholder="${el.placeholder}" | label="${el.labelText}"`);
    });

    // لقطة شاشة أولية
    const ss1 = path.join(UPLOADS_DIR, `before_fill_${reportId}_${Date.now()}.png`);
    await page.screenshot({ path: ss1, fullPage: true }).catch(() => {});
    addLog(session, `📸 لقطة قبل التعبئة: ${ss1}`);

    // ─── STEP 2: تعبئة النموذج ───────────────────────────────────────
    addLog(session, "بدء تعبئة بيانات التقرير...");
    await fillReportForm(session, report, formElements);

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
    }

    // لقطة شاشة بعد التعبئة
    const ss2 = path.join(UPLOADS_DIR, `after_fill_${reportId}_${Date.now()}.png`);
    await page.screenshot({ path: ss2, fullPage: true }).catch(() => {});
    addLog(session, `📸 لقطة بعد التعبئة: ${ss2}`);

    await updateReport(reportId, {
      automationStatus: "waiting_review",
      automationError: null,
    });

    addLog(session, "✅ اكتملت التعبئة — راجع البيانات في المتصفح ثم اضغط «حفظ واستمرار» يدوياً.");
    addLog(session, "🔵 المتصفح مفتوح للمراجعة.");

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
// تعبئة النموذج — متوافق مع Angular (يُطلق أحداث input/change)
// ─────────────────────────────────────────────────────────────────────────────
async function fillReportForm(
  session: AutomationSession,
  report: any,
  formElements: any[],
): Promise<void> {
  const { page } = session;

  // ── دالة تعبئة حقل نصي بطريقة Angular-safe ──────────────────────────────
  const fillAngular = async (selector: string, value: string | number | null | undefined, label: string) => {
    if (value === null || value === undefined || String(value).trim() === "") return;
    const val = String(value);
    try {
      await page.waitForSelector(selector, { timeout: 3000 });
      await page.click(selector);
      await page.keyboard.press("Control+a");
      await page.keyboard.press("Delete");
      await page.type(selector, val, { delay: 30 });
      // أطلق حدث input/change لـ Angular
      await page.evaluate((sel) => {
        const el = document.querySelector(sel) as HTMLInputElement | null;
        if (!el) return;
        el.dispatchEvent(new Event("input",  { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("blur",   { bubbles: true }));
      }, selector);
      addLog(session, `✅ ${label}: ${val}`);
    } catch {
      addLog(session, `⚠️ لم يُعبَّأ "${label}"`);
    }
  };

  // ── دالة اختيار من قائمة (select native أو Angular Material) ─────────────
  const selectAngular = async (selector: string, value: string | null | undefined, label: string) => {
    if (!value) return;
    try {
      await page.waitForSelector(selector, { timeout: 3000 });
      // حاول native select أولاً
      await page.selectOption(selector, { label: value }).catch(() =>
        page.selectOption(selector, { value }).catch(() => {})
      );
      await page.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) {
          el.dispatchEvent(new Event("change", { bubbles: true }));
        }
      }, selector);
      addLog(session, `✅ ${label}: ${value}`);
    } catch {
      // جرّب Angular Material mat-select (click ثم اختيار من القائمة)
      try {
        await page.click(selector);
        await page.waitForTimeout(500);
        await page.getByRole("option", { name: value }).first().click();
        addLog(session, `✅ ${label} (mat-select): ${value}`);
      } catch {
        addLog(session, `⚠️ لم يُحدَّد "${label}": ${value}`);
      }
    }
  };

  // ── بناء محددات من عناصر النموذج المكتشفة ─────────────────────────────────
  // نبني selector لكل عنصر بالأولوية: formControlName → name → id → placeholder
  const buildSelector = (el: any): string => {
    if (el.formControlName) return `[formcontrolname="${el.formControlName}"]`;
    if (el.name)            return `${el.tag.toLowerCase()}[name="${el.name}"]`;
    if (el.id)              return `#${el.id}`;
    if (el.placeholder)     return `[placeholder="${el.placeholder}"]`;
    return "";
  };

  // خريطة العناصر: نُرتّبها حسب الموضع (y) لمعرفة ترتيبها في الصفحة
  const inputs   = formElements.filter(e => e.tag === "INPUT" && e.type !== "file" && e.type !== "radio" && e.type !== "checkbox");
  const selects  = formElements.filter(e => e.tag === "SELECT");
  const radios   = formElements.filter(e => e.type === "radio");

  addLog(session, `📋 إجمالي الحقول: ${inputs.length} input, ${selects.length} select, ${radios.length} radio`);

  // ════════════════════════════════════════════════════════════════════
  // الاستراتيجية الأولى: البحث بـ formControlName / name / placeholder
  // ════════════════════════════════════════════════════════════════════

  // عنوان التقرير
  const titleEl = inputs.find(e =>
    /title|عنوان|report.?name|reportname/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  );
  if (titleEl) {
    await fillAngular(buildSelector(titleEl), report.reportNumber, "عنوان التقرير");
  }

  // الغرض من التقييم
  const purposeEl = selects.find(e =>
    /purpose|غرض|valuation.?purpose/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  ) ?? selects[0];
  if (purposeEl) await selectAngular(buildSelector(purposeEl), report.valuationPurpose, "الغرض من التقييم");

  // فرضية القيمة
  const hypothesisEl = selects.find(e =>
    /hypothesis|فرضية|premise/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  ) ?? selects[1];
  if (hypothesisEl) await selectAngular(buildSelector(hypothesisEl), report.valuationHypothesis, "فرضية القيمة");

  // أساس القيمة / طريقة التقييم
  const methodEl = selects.find(e =>
    /method|أساس|approach|valuation.?method/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  ) ?? selects[2];
  if (methodEl) await selectAngular(buildSelector(methodEl), report.valuationMethod, "أساس القيمة");

  // نوع التقرير (radio)
  if (report.reportType && radios.length > 0) {
    try {
      const radio = radios.find(r => r.value === report.reportType) ?? radios[0];
      const rSel = buildSelector(radio);
      if (rSel) {
        await page.check(rSel);
        addLog(session, `✅ نوع التقرير: ${report.reportType}`);
      }
    } catch {
      addLog(session, `⚠️ لم يُحدَّد نوع التقرير`);
    }
  }

  // تاريخ التقييم
  const valDateEl = inputs.find(e =>
    /valuation.?date|تاريخ.*تقييم|inspection.?date/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  );
  if (valDateEl) await fillAngular(buildSelector(valDateEl), report.valuationDate, "تاريخ التقييم");

  // تاريخ إصدار التقرير
  const issueDateEl = inputs.find(e =>
    /issue.?date|report.?date|تاريخ.*إصدار|تاريخ.*تقرير/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  );
  if (issueDateEl) await fillAngular(buildSelector(issueDateEl), report.reportDate, "تاريخ إصدار التقرير");

  // الافتراضات
  const assumEl = inputs.find(e =>
    /assumption|افتراض/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  );
  if (assumEl) await fillAngular(buildSelector(assumEl), report.notes, "الافتراضات");

  // الرأي النهائي في القيمة
  const finalValEl = inputs.find(e =>
    /final.?value|final.?opinion|الرأي|القيمة/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  );
  if (finalValEl) await fillAngular(buildSelector(finalValEl), report.finalValue, "الرأي النهائي في القيمة");

  // اسم العميل
  const clientNameEl = inputs.find(e =>
    /client.?name|customer|اسم.*العميل|اسم.عميل/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  );
  if (clientNameEl) await fillAngular(buildSelector(clientNameEl), report.clientName, "اسم العميل");

  // رقم الهاتف
  const phoneEl = inputs.find(e =>
    /phone|mobile|هاتف|جوال/i.test(e.formControlName + e.name + e.placeholder + e.labelText)
  );
  if (phoneEl) await fillAngular(buildSelector(phoneEl), report.clientPhone, "رقم الهاتف");

  // البريد الإلكتروني
  const emailEl = inputs.find(e =>
    /email|بريد/i.test(e.formControlName + e.name + e.placeholder + e.labelText) || e.type === "email"
  );
  if (emailEl) await fillAngular(buildSelector(emailEl), report.clientEmail, "البريد الإلكتروني");

  await page.waitForTimeout(500);
  addLog(session, "✅ انتهت محاولة تعبئة الحقول.");
}

export async function submitSavedForm(reportId: number): Promise<void> {
  const context = await getAuthenticatedContext();
  if (!context) throw new Error("لا توجد جلسة مسجّلة.");
  const pages = context.pages();
  const formPage = pages.find(p => p.url().includes("/report/create"));
  if (!formPage) throw new Error("لم يتم العثور على صفحة النموذج المفتوحة.");
  await formPage.click('button:has-text("حفظ واستمرار")');
  await formPage.waitForLoadState("networkidle", { timeout: 30000 });
  await updateReport(reportId, {
    status: "submitted",
    automationStatus: "completed",
    taqeemSubmittedAt: new Date().toISOString(),
  });
}
