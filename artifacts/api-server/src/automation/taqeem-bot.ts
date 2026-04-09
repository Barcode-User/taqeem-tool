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

    // ════════════════════════════════════════════════════════
    // الصفحة 1 — البيانات الأساسية للتقرير
    // ════════════════════════════════════════════════════════
    addLog(session, "▶ الصفحة 1: فتح صفحة إنشاء تقرير جديد...");
    await page.goto(`${TAQEEM_URL}/report/create/1/13`, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    await waitForAngular(page);

    if (page.url().includes("/login") || page.url().includes("sso.taqeem")) {
      throw new Error("انتهت الجلسة — يرجى تسجيل الدخول مجدداً من صفحة الإعدادات.");
    }
    addLog(session, `✅ الصفحة 1 جاهزة: ${page.url()}`);

    // حالة مشتركة — يتتبع ما إذا تم رفع PDF بنجاح في أيّ صفحة
    const pdfState = { pdfUploaded: false };

    const els1 = await scanElements(page);
    await saveDebug(reportId, "page1", els1);
    await screenshot(page, `page1_before_${reportId}`);
    await fillPage1(session, report, els1, pdfState);
    await screenshot(page, `page1_after_${reportId}`);
    await clickSaveAndContinue(session);

    // ════════════════════════════════════════════════════════
    // الصفحة 2 — معلومات الأصل والموقع (Screens 3 & 4)
    // ════════════════════════════════════════════════════════
    addLog(session, "▶ الصفحة 2: انتظار تحميل صفحة معلومات الأصل...");
    await waitForAngular(page, 4000);
    addLog(session, `✅ الصفحة 2 جاهزة: ${page.url()}`);

    const els2 = await scanElements(page);
    await saveDebug(reportId, "page2", els2);
    await screenshot(page, `page2_before_${reportId}`);
    await fillPage2(session, report, els2, pdfState);
    await screenshot(page, `page2_after_${reportId}`);
    await clickSaveAndContinue(session);

    // ════════════════════════════════════════════════════════
    // الصفحة 3 — البيانات الإضافية (Screen 5)
    // ════════════════════════════════════════════════════════
    addLog(session, "▶ الصفحة 3: انتظار تحميل صفحة البيانات الإضافية...");
    await waitForAngular(page, 4000);
    addLog(session, `✅ الصفحة 3 جاهزة: ${page.url()}`);

    const els3 = await scanElements(page);
    await saveDebug(reportId, "page3", els3);
    await screenshot(page, `page3_before_${reportId}`);
    await fillPage3(session, report, els3, pdfState);
    await screenshot(page, `page3_after_${reportId}`);

    if (!pdfState.pdfUploaded && report.pdfFilePath) {
      addLog(session, "⚠️ لم يُرفع PDF في أي صفحة — يرجى رفعه يدوياً في المتصفح.");
    }

    await clickSaveAndContinue(session);

    // ════════════════════════════════════════════════════════
    // الصفحة 6 — مراجعة نهائية (Screen 6) — توقف هنا
    // ════════════════════════════════════════════════════════
    addLog(session, "▶ انتظار صفحة المراجعة النهائية...");
    await waitForAngular(page, 4000);
    await screenshot(page, `page6_review_${reportId}`);
    addLog(session, `✅ صفحة المراجعة جاهزة: ${page.url()}`);
    addLog(session, "🔵 اكتمل الإدخال — راجع البيانات ثم اضغط «إرسال التقرير» يدوياً.");

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

async function waitForAngular(page: Page, extra = 3000): Promise<void> {
  await page.waitForTimeout(extra);
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
    'button:has-text("Save")',
    'button[type="submit"]',
    'input[type="submit"]',
  ];
  for (const sel of btnSelectors) {
    try {
      const btn = await page.$(sel);
      if (btn) {
        await btn.click();
        await page.waitForTimeout(500);
        addLog(session, `✅ تم الضغط على الزر: ${sel}`);
        return;
      }
    } catch { /* جرّب التالي */ }
  }
  addLog(session, "⚠️ لم يُعثر على زر «حفظ واستمرار»");
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 1 — البيانات الأساسية للتقرير
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
  if (state.pdfUploaded) return;

  // مسار احتياطي مؤقت عند غياب الملف في التقرير
  const FALLBACK_PDF = "C:\\Users\\Barcode Users\\Downloads\\DC26153222_3_31_2026 1_21_22 PM_compressed.pdf";

  let resolvedPath: string = report.pdfFilePath ?? "";

  if (!resolvedPath || !fs.existsSync(resolvedPath)) {
    if (resolvedPath) {
      addLog(session, `⚠️ ملف PDF غير موجود في المسار: ${resolvedPath}`);
    } else {
      addLog(session, "⚠️ لا يوجد ملف PDF مرتبط بهذا التقرير.");
    }
    if (fs.existsSync(FALLBACK_PDF)) {
      addLog(session, `📂 استخدام الملف الاحتياطي: ${path.basename(FALLBACK_PDF)}`);
      resolvedPath = FALLBACK_PDF;
    } else {
      addLog(session, `⏭️ الملف الاحتياطي غير موجود أيضاً — تجاوز رفع PDF.`);
      state.pdfUploaded = true;
      return;
    }
  }

  const { page } = session;
  const filePath = resolvedPath;
  const fileName = path.basename(filePath);
  addLog(session, `📎 محاولة رفع: ${fileName}`);

  // ── فحص وجود حقل الرفع في الصفحة ────────────────────────────────────────
  const inputCount = await page.$$eval('input[type="file"]', (els) => els.length).catch(() => 0);
  if (inputCount === 0) {
    addLog(session, "⏭️ لا يوجد حقل رفع ملف في هذه الصفحة");
    return;
  }

  // سجّل معلومات الحقل
  const fileInfos = await page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLInputElement>('input[type="file"]')).map((el) => {
      let lbl = "";
      let p: Element | null = el.parentElement;
      for (let i = 0; i < 8 && p; i++) {
        const found = p.querySelector("label, mat-label, span");
        if (found) { lbl = found.textContent?.trim().slice(0, 40) ?? ""; break; }
        p = p.parentElement;
      }
      return { name: el.name, id: el.id, accept: el.accept, lbl };
    }),
  ).catch(() => []);
  fileInfos.forEach((f, i) =>
    addLog(session, `  [file${i}] name="${f.name}" id="${f.id}" label="${f.lbl}" accept="${f.accept}"`),
  );

  // ══ الطريقة 1: page.setInputFiles — الطريقة الأكثر موثوقية في Playwright ══
  // تعمل حتى مع الحقول المخفية — تضع الملف مباشرة في input بدون الحاجة للنقر
  addLog(session, `  ↳ [1] page.setInputFiles (report_file)`);
  try {
    // جرّب أولاً بالاسم المحدد
    await page.setInputFiles('input[name="report_file"]', filePath);
    await page.waitForTimeout(600);
    // تحقق من قبول الملف
    const count1 = await page.$eval(
      'input[name="report_file"]',
      (el: HTMLInputElement) => el.files?.length ?? 0,
    ).catch(() => 0);
    addLog(session, `  ↳ [1] files.length = ${count1}`);
    if (count1 > 0) {
      // أطلق أحداث التغيير لـ Angular
      await page.evaluate(() => {
        const el = document.querySelector<HTMLInputElement>('input[name="report_file"]');
        if (!el) return;
        el.dispatchEvent(new Event("change", { bubbles: true }));
        el.dispatchEvent(new Event("input",  { bubbles: true }));
      });
      await page.waitForTimeout(600);
      addLog(session, `✅ تم رفع PDF [1-setInputFiles]: ${fileName}`);
      state.pdfUploaded = true;
      return;
    }
  } catch (e: any) {
    addLog(session, `  ↳ [1] فشل: ${e.message}`);
  }

  // ══ الطريقة 2: DataTransfer مع Object.defineProperty — يتجاوز القراءة فقط ══
  // inp.files = ... لا تعمل، لكن Object.defineProperty تتجاوز هذا القيد
  addLog(session, `  ↳ [2] DataTransfer + Object.defineProperty`);
  try {
    const b64 = fs.readFileSync(filePath).toString("base64");
    const result2 = await page.evaluate(
      ({ b64, name }: { b64: string; name: string }) => {
        try {
          const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
          const file = new File([bytes], name, { type: "application/pdf" });
          const dt = new DataTransfer();
          dt.items.add(file);

          const inputs = Array.from(
            document.querySelectorAll<HTMLInputElement>('input[type="file"]'),
          );
          // الأولوية لـ report_file
          inputs.sort((a) => (a.name === "report_file" ? -1 : 1));

          for (const inp of inputs) {
            try {
              Object.defineProperty(inp, "files", {
                value: dt.files,
                writable: true,
                configurable: true,
              });
              inp.dispatchEvent(new Event("change", { bubbles: true }));
              inp.dispatchEvent(new Event("input",  { bubbles: true }));
              if (inp.files?.length) return `ok:${inp.name || inp.id}`;
            } catch { /* جرّب التالي */ }
          }
          return "no-input-accepted";
        } catch (e: any) {
          return `error:${e.message}`;
        }
      },
      { b64, name: fileName },
    );
    addLog(session, `  ↳ [2] نتيجة: ${result2}`);
    if (result2.startsWith("ok:")) {
      await page.waitForTimeout(800);
      addLog(session, `✅ تم رفع PDF [2-DataTransfer]: ${fileName}`);
      state.pdfUploaded = true;
      return;
    }
  } catch (e: any) {
    addLog(session, `  ↳ [2] فشل: ${e.message}`);
  }

  // ══ الطريقة 3: FileChooser — النقر على العنصر المرتبط بالحقل ══════════════
  addLog(session, `  ↳ [3] FileChooser`);
  const rfId = await page.$eval('input[name="report_file"]', (el) => el.id ?? "").catch(() => "");
  const clickTargets = [
    ...(rfId ? [`label[for="${rfId}"]`] : []),
    'label:has-text("ملف أصل التقرير")',
    'label:has-text("ملف التقرير")',
    'button:has-text("رفع")',
    'button:has-text("اختر")',
    'button:has-text("اختر ملف")',
    'label:has-text("رفع")',
    '[class*="upload"]:not(input)',
  ];
  for (const sel of clickTargets) {
    const el = await page.$(sel).catch(() => null);
    if (!el) continue;
    addLog(session, `  ↳ [3] FileChooser عبر: ${sel}`);
    try {
      const [fc] = await Promise.all([
        page.waitForEvent("filechooser", { timeout: 3000 }),
        el.click(),
      ]);
      await fc.setFiles(filePath);
      await page.waitForTimeout(800);
      addLog(session, `✅ تم رفع PDF [3-FileChooser]: ${fileName}`);
      state.pdfUploaded = true;
      return;
    } catch { /* جرّب التالي */ }
  }

  addLog(session, "⚠️ لم يُرفع PDF في هذه الصفحة — سيُحاوَل في الصفحة التالية.");
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
