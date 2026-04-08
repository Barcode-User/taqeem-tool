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

    const els1 = await scanElements(page);
    await saveDebug(reportId, "page1", els1);
    await screenshot(page, `page1_before_${reportId}`);
    await fillPage1(session, report, els1);
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
    await fillPage2(session, report, els2);
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
    await fillPage3(session, report, els3);
    await screenshot(page, `page3_after_${reportId}`);
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
    const result: any[] = [];
    document.querySelectorAll("input, select, textarea").forEach((el: any) => {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) return;
      let labelText = "";
      const id = el.id;
      if (id) {
        const lbl = document.querySelector(`label[for="${id}"]`);
        if (lbl) labelText = lbl.textContent?.trim() ?? "";
      }
      if (!labelText) {
        let parent = el.parentElement;
        for (let i = 0; i < 6 && parent; i++) {
          const t = parent.textContent?.replace(el.value ?? "", "").trim() ?? "";
          if (t && t.length < 80) { labelText = t; break; }
          parent = parent.parentElement;
        }
      }
      result.push({
        tag: el.tagName,
        type: (el as HTMLInputElement).type ?? "",
        name: el.name ?? "",
        id: el.id ?? "",
        placeholder: (el as HTMLInputElement).placeholder ?? "",
        formControlName: el.getAttribute("formcontrolname") ?? "",
        ariaLabel: el.getAttribute("aria-label") ?? "",
        value: (el as HTMLInputElement).value ?? "",
        labelText: labelText.substring(0, 70),
        y: Math.round(rect.y),
      });
    });
    return result.sort((a: any, b: any) => a.y - b.y);
  });
}

function buildSelector(el: any): string {
  if (el.formControlName) return `[formcontrolname="${el.formControlName}"]`;
  if (el.name)            return `${el.tag.toLowerCase()}[name="${el.name}"]`;
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

// تعبئة حقل نصي (Angular-safe)
async function fillAngular(
  session: AutomationSession, selector: string,
  value: string | number | null | undefined, label: string,
): Promise<void> {
  if (value === null || value === undefined || String(value).trim() === "") {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }
  const val = String(value);
  const { page } = session;
  try {
    await page.waitForSelector(selector, { timeout: 3000 });
    await page.evaluate((args: { sel: string; v: string }) => {
      const el = document.querySelector(args.sel) as HTMLInputElement | null;
      if (!el) return;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
      if (setter) setter.call(el, args.v); else el.value = args.v;
      el.dispatchEvent(new Event("input",  { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      el.dispatchEvent(new Event("blur",   { bubbles: true }));
    }, { sel: selector, v: val });
    addLog(session, `✅ ${label}: ${val}`);
  } catch {
    addLog(session, `⚠️ لم يُعبَّأ "${label}"`);
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

// اختيار من قائمة منسدلة
async function selectAngular(
  session: AutomationSession, selector: string,
  value: string | null | undefined, label: string,
): Promise<void> {
  if (!value || value.trim() === "") {
    addLog(session, `⏭️ تخطي "${label}" — لا توجد قيمة`);
    return;
  }
  const { page } = session;
  try {
    await page.waitForSelector(selector, { timeout: 3000 });
    await page.selectOption(selector, { label: value }).catch(() =>
      page.selectOption(selector, { value }).catch(() => {}),
    );
    await page.evaluate((sel) => {
      const el = document.querySelector(sel);
      if (el) el.dispatchEvent(new Event("change", { bubbles: true }));
    }, selector);
    addLog(session, `✅ ${label}: ${value}`);
  } catch {
    try {
      await page.click(selector);
      await page.waitForTimeout(400);
      await page.getByRole("option", { name: value }).first().click();
      addLog(session, `✅ ${label} (mat): ${value}`);
    } catch {
      addLog(session, `⚠️ لم يُحدَّد "${label}": ${value}`);
    }
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
async function fillPage1(session: AutomationSession, report: any, els: any[]): Promise<void> {
  addLog(session, `📋 الصفحة 1: ${els.length} عنصر مكتشف`);
  els.forEach((el, i) =>
    addLog(session, `  [${i}] ${el.tag} fcn="${el.formControlName}" name="${el.name}" lbl="${el.labelText}"`),
  );

  const inputs  = els.filter(e => e.tag === "INPUT" && !["file","radio","checkbox"].includes(e.type));
  const selects = els.filter(e => e.tag === "SELECT");

  const find = (arr: any[], rx: RegExp) =>
    arr.find(e => rx.test(e.formControlName + e.name + e.placeholder + e.labelText + e.ariaLabel));

  // الغرض من التقييم
  const purposeEl = find(selects, /purpose|غرض|valuation.?purpose/i);
  if (purposeEl) await selectAngular(session, buildSelector(purposeEl), report.valuationPurpose, "الغرض من التقييم");

  // فرضية القيمة
  const hypothesisEl = find(selects, /hypothesis|فرضية|premise/i);
  if (hypothesisEl) await selectAngular(session, buildSelector(hypothesisEl), report.valuationHypothesis, "فرضية القيمة");

  // أساس القيمة
  const basisEl = find(selects, /basis|أساس.القيمة|value.?basis/i);
  if (basisEl) await selectAngular(session, buildSelector(basisEl), report.valuationBasis, "أساس القيمة");

  // نوع التقرير
  const reportTypeEl = find(selects, /report.?type|نوع.*تقرير/i);
  if (reportTypeEl) await selectAngular(session, buildSelector(reportTypeEl), report.reportType, "نوع التقرير");

  // رقم التقرير / الطلب
  const reportNumEl = find(inputs, /report.?number|رقم.*تقرير|request.?number|رقم.*طلب/i);
  if (reportNumEl) await fillAngular(session, buildSelector(reportNumEl), report.reportNumber, "رقم التقرير");

  // تاريخ إصدار التقرير
  const reportDateEl = find(inputs, /report.?date|تاريخ.*تقرير|تاريخ.*إصدار/i);
  if (reportDateEl) await fillDate(session, buildSelector(reportDateEl), report.reportDate, "تاريخ إصدار التقرير");

  // اسم العميل / الجهة المستفيدة
  const clientEl = find(inputs, /client.?name|customer|اسم.*عميل|جهة.*مستفيدة/i);
  if (clientEl) await fillAngular(session, buildSelector(clientEl), report.clientName, "اسم العميل");

  // البريد الإلكتروني
  const emailEl = find(inputs, /email|بريد/i) ?? els.find(e => e.tag === "INPUT" && e.type === "email");
  if (emailEl) await fillAngular(session, buildSelector(emailEl), report.clientEmail, "البريد الإلكتروني");

  // رقم الهاتف
  const phoneEl = find(inputs, /phone|mobile|هاتف|جوال/i);
  if (phoneEl) await fillAngular(session, buildSelector(phoneEl), report.clientPhone, "رقم الهاتف");

  // المستخدم المقصود
  const userEl = find(inputs, /intended.?user|مستخدم.*مقصود/i);
  if (userEl) await fillAngular(session, buildSelector(userEl), report.intendedUser, "المستخدم المقصود");

  // رفع ملف PDF في الصفحة 1
  await uploadPdf(session, report);
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 2 — معلومات الأصل + أسلوب التقييم + الموقع (Screens 3 & 4)
// ─────────────────────────────────────────────────────────────────────────────
async function fillPage2(session: AutomationSession, report: any, els: any[]): Promise<void> {
  addLog(session, `📋 الصفحة 2: ${els.length} عنصر مكتشف`);
  els.forEach((el, i) =>
    addLog(session, `  [${i}] ${el.tag} fcn="${el.formControlName}" name="${el.name}" lbl="${el.labelText}"`),
  );

  const inputs    = els.filter(e => e.tag === "INPUT" && !["file","radio","checkbox"].includes(e.type));
  const selects   = els.filter(e => e.tag === "SELECT");
  const checkboxes = els.filter(e => e.type === "checkbox");

  const find = (arr: any[], rx: RegExp) =>
    arr.find(e => rx.test(e.formControlName + e.name + e.placeholder + e.labelText + e.ariaLabel));

  // ── معلومات الأصل ─────────────────────────────────────────────────────────

  // نوع الأصل محل التقييم
  const propTypeEl = find(selects, /asset.?type|property.?type|نوع.*أصل|نوع.*عقار/i);
  if (propTypeEl) await selectAngular(session, buildSelector(propTypeEl), report.propertyType, "نوع الأصل");

  // استخدام/قطاع الأصل
  const propUseEl = find(selects, /use|usage|قطاع|استخدام/i);
  if (propUseEl) await selectAngular(session, buildSelector(propUseEl), report.propertyUse, "استخدام الأصل");

  // تاريخ معاينة الأصل
  const inspDateEl = find(inputs, /inspection.?date|معاين|تاريخ.*فحص/i);
  if (inspDateEl) await fillDate(session, buildSelector(inspDateEl), report.inspectionDate, "تاريخ المعاينة");

  // الرأي النهائي في القيمة
  const finalValEl = find(inputs, /final.?value|final.?opinion|الرأي.*القيمة|رأي.*نهائي/i);
  if (finalValEl) await fillAngular(session, buildSelector(finalValEl), report.finalValue, "الرأي النهائي في القيمة");

  // ── أسلوب السوق ───────────────────────────────────────────────────────────
  // أساسي تقدير القيمة — checkbox
  const marketCheckEl = find(checkboxes, /market|سوق|مقارن/i);
  if (marketCheckEl) {
    const useMarket = !!(report.valuationMethod && /سوق|market/i.test(report.valuationMethod));
    await checkBox(session, buildSelector(marketCheckEl), useMarket, "أسلوب السوق");
  }

  // طريقه المعاملات المعارة (قيمة أسلوب السوق)
  const marketValEl = find(inputs, /market.?value|comparable|معاملات.*معارة|قيمة.*سوق/i);
  if (marketValEl) await fillAngular(session, buildSelector(marketValEl), report.marketValue ?? report.finalValue, "طريقة المعاملات المعارة");

  // أسلوب الدخل
  const incomeEl = find(selects, /income|دخل/i);
  if (incomeEl) await selectAngular(session, buildSelector(incomeEl), "غير مستخدم", "أسلوب الدخل");

  // أسلوب التكلفة
  const costEl = find(selects, /cost|تكلفة/i);
  if (costEl) await selectAngular(session, buildSelector(costEl), "مساعد لتقدير القيمة", "أسلوب التكلفة");

  // ── معلومات الموقع ────────────────────────────────────────────────────────

  // الدولة (ثابت)
  const countryEl = find(selects, /country|دولة/i);
  if (countryEl) await selectAngular(session, buildSelector(countryEl), "المملكة العربية السعودية", "الدولة");

  // المنطقة
  const regionEl = find(selects, /region|province|منطقة/i);
  if (regionEl) await selectAngular(session, buildSelector(regionEl), report.region, "المنطقة");

  // المدينة
  const cityEl = find(selects, /city|مدينة/i) ?? find(inputs, /city|مدينة/i);
  if (cityEl) await selectAngular(session, buildSelector(cityEl), report.city, "المدينة");

  // الحي
  const districtEl = find(inputs, /district|neighborhood|حي/i);
  if (districtEl) await fillAngular(session, buildSelector(districtEl), report.district, "الحي");

  // الشارع
  const streetEl = find(inputs, /street|شارع/i);
  if (streetEl) await fillAngular(session, buildSelector(streetEl), report.street, "الشارع");

  // الإحداثيات (خط الطول / العرض)
  let lat: string | null = null;
  let lng: string | null = null;
  if (report.coordinates) {
    const parts = String(report.coordinates).split(",").map((s: string) => s.trim());
    if (parts.length === 2) { lat = parts[0]; lng = parts[1]; }
  }

  const lngEl = find(inputs, /longitude|خط.*طول/i);
  if (lngEl && lng) await fillAngular(session, buildSelector(lngEl), lng, "خط الطول");

  const latEl = find(inputs, /latitude|خط.*عرض/i);
  if (latEl && lat) await fillAngular(session, buildSelector(latEl), lat, "خط العرض");
}

// ─────────────────────────────────────────────────────────────────────────────
// الصفحة 3 — البيانات الإضافية (Screen 5)
// ─────────────────────────────────────────────────────────────────────────────
async function fillPage3(session: AutomationSession, report: any, els: any[]): Promise<void> {
  addLog(session, `📋 الصفحة 3: ${els.length} عنصر مكتشف`);
  els.forEach((el, i) =>
    addLog(session, `  [${i}] ${el.tag} fcn="${el.formControlName}" name="${el.name}" lbl="${el.labelText}"`),
  );

  const inputs    = els.filter(e => e.tag === "INPUT" && !["file","radio","checkbox"].includes(e.type));
  const selects   = els.filter(e => e.tag === "SELECT");
  const checkboxes = els.filter(e => e.type === "checkbox");
  const { page } = session;

  const find = (arr: any[], rx: RegExp) =>
    arr.find(e => rx.test(e.formControlName + e.name + e.placeholder + e.labelText + e.ariaLabel));

  // رقم الصك / سند الملكية
  const deedEl = find(inputs, /deed|صك|سند/i);
  if (deedEl) await fillAngular(session, buildSelector(deedEl), report.deedNumber, "رقم الصك");

  // نوع الملكية
  const ownerTypeEl = find(selects, /ownership.?type|ملكية/i);
  if (ownerTypeEl) await selectAngular(session, buildSelector(ownerTypeEl), report.ownershipType, "نوع الملكية");

  // الاتجاهات المطلة على الشارع
  const facadeEl = find(selects, /facade|direction|اتجاه|مطلة|واجهة/i);
  if (facadeEl) await selectAngular(session, buildSelector(facadeEl), report.streetFacades, "الاتجاهات المطلة");

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

  // مساحة الأرض (م²)
  const landEl = find(inputs, /land.?area|مساحة.*أرض|area.?land/i);
  if (landEl) await fillAngular(session, buildSelector(landEl), report.landArea, "مساحة الأرض");

  // مساحة مسطحات البناء
  const buildEl = find(inputs, /building.?area|مساحة.*بناء|floor.?area/i);
  if (buildEl) await fillAngular(session, buildSelector(buildEl), report.buildingArea, "مساحة البناء");

  // نسبة البناء المصرح بها (%)
  const ratioEl = find(inputs, /ratio|permit|نسبة.*بناء|مصرح/i);
  if (ratioEl) await fillAngular(session, buildSelector(ratioEl), report.permittedBuildingRatio, "نسبة البناء المصرح بها");

  // عدد الأدوار المصرح به
  const floorsEl = find(inputs, /floor|أدوار|طابق/i);
  if (floorsEl) await fillAngular(session, buildSelector(floorsEl), report.permittedFloorsCount ?? report.floorsCount, "عدد الأدوار");

  // حالة البناء
  const buildStatusEl = find(selects, /building.?status|حالة.*بناء/i);
  if (buildStatusEl) await selectAngular(session, buildSelector(buildStatusEl), report.buildingStatus, "حالة البناء");

  // نوع الصبي / نوع العقار الفرعي
  const subTypeEl = find(selects, /sub.?type|نوع.*صبي|نوع.*فرعي/i);
  if (subTypeEl) await selectAngular(session, buildSelector(subTypeEl), report.propertySubType, "نوع العقار الفرعي");

  // عمر الأصل
  const ageEl = find(inputs, /age|عمر/i);
  if (ageEl) await fillAngular(session, buildSelector(ageEl), report.buildingAge, "عمر الأصل");

  // عرض الشارع
  const swEl = find(inputs, /street.?width|عرض.*شارع/i);
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
}

// ─────────────────────────────────────────────────────────────────────────────
// رفع ملف PDF — محاولات متعددة
// ─────────────────────────────────────────────────────────────────────────────
async function uploadPdf(session: AutomationSession, report: any): Promise<void> {
  if (!report.pdfFilePath) {
    addLog(session, "⏭️ لا يوجد ملف PDF مرتبط بهذا التقرير.");
    return;
  }
  if (!fs.existsSync(report.pdfFilePath)) {
    addLog(session, `⚠️ ملف PDF غير موجود في المسار: ${report.pdfFilePath}`);
    return;
  }

  const { page } = session;
  addLog(session, `📎 رفع ملف PDF: ${report.pdfFilePath}`);
  let uploaded = false;

  // المحاولة 1: مباشر على كل input[type=file]
  try {
    const fis = await page.$$('input[type="file"]');
    for (const fi of fis) {
      try {
        await fi.setInputFiles(report.pdfFilePath);
        await page.waitForTimeout(800);
        addLog(session, "✅ تم رفع PDF (direct).");
        uploaded = true;
        break;
      } catch { /* جرّب التالي */ }
    }
  } catch { /* تجاهل */ }

  // المحاولة 2: زر رفع + file chooser
  if (!uploaded) {
    const btns = [
      'button:has-text("رفع")', 'button:has-text("اختر")', 'button:has-text("upload")',
      'button:has-text("Browse")', '[class*="upload"]', 'label[for*="file"]',
    ];
    for (const sel of btns) {
      const btn = await page.$(sel).catch(() => null);
      if (!btn) continue;
      try {
        const [fc] = await Promise.all([
          page.waitForEvent("filechooser", { timeout: 3000 }),
          btn.click(),
        ]);
        await fc.setFiles(report.pdfFilePath);
        await page.waitForTimeout(800);
        addLog(session, `✅ تم رفع PDF (chooser).`);
        uploaded = true;
        break;
      } catch { /* جرّب التالي */ }
    }
  }

  // المحاولة 3: إظهار الحقل المخفي قسراً
  if (!uploaded) {
    try {
      await page.evaluate(() => {
        document.querySelectorAll('input[type="file"]').forEach((el: any) => {
          Object.assign(el.style, {
            opacity: "1", display: "block", visibility: "visible",
            position: "fixed", top: "0", left: "0", width: "80px", height: "80px", zIndex: "99999",
          });
        });
      });
      await page.waitForTimeout(300);
      const fi = await page.$('input[type="file"]');
      if (fi) {
        await fi.setInputFiles(report.pdfFilePath);
        await page.waitForTimeout(800);
        addLog(session, "✅ تم رفع PDF (force show).");
        uploaded = true;
      }
    } catch { /* تجاهل */ }
  }

  if (!uploaded) {
    addLog(session, "⚠️ لم يتمكن النظام من رفع PDF تلقائياً — يرجى رفعه يدوياً في المتصفح.");
  }
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
