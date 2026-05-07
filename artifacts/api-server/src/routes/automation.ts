import { Router } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import {
  insertReport,
  getReportById,
  getReportsByAutomationStatus,
  updateReport,
} from "@workspace/db";
import { startAutomation } from "../automation/taqeem-bot";
import { getSessionByReportId, submitOtp, isAnySessionRunning, canStartNewSession } from "../automation/session-manager";
import {
  startLogin,
  submitLoginOtp,
  getLoginStatus,
  logout,
  getAuthenticatedContext,
  createIsolatedContextForRole,
} from "../automation/taqeem-session-store";
import { hasPendingQueue, MAX_CONCURRENT, processQueue } from "../automation/queue-processor";

// ─────────────────────────────────────────────────────────────────────────────
// CERTIFY BOT STATE — مدمج مباشرة لتجنب مشاكل الاستيراد على Windows
// ─────────────────────────────────────────────────────────────────────────────
const CERTIFY_REPORTS_URL = "https://qima.taqeem.gov.sa/membership/reports/sector/1";
const CERTIFY_REPORT_BASE = "https://qima.taqeem.gov.sa/report";
const CERTIFY_OFFICE = "13";

type CertifyStatus = "idle" | "running" | "ready" | "failed";
type CertifyState = {
  status: CertifyStatus;
  error?: string;
  logs: string[];
  reportNumbers: string[];
  currentIndex: number;
  openedReport?: string;
};

const CERTIFY_BOT_VERSION = "v6.0 — 2026-05-07 — download certificate PDF via شهادة التسجيل";

let _certifyState: CertifyState = { status: "idle", logs: [], reportNumbers: [], currentIndex: 0 };
let _certifyPage: any = null;      // صفحة قائمة التقارير
let _certifyReportPage: any = null; // التاب الثاني للتقرير المفتوح
let _certifyCleanup: (() => Promise<void>) | null = null;
let _certifyExtracting = false;    // منع الاستخراج المزدوج

function _certifyLog(msg: string) {
  _certifyState.logs.push(`[${new Date().toISOString()}] ${msg}`);
  console.log(`[CertifyBot] ${msg}`);
}

function getCertifyStatus(): CertifyState {
  return { ..._certifyState, logs: [..._certifyState.logs] };
}

async function startCertifySession(): Promise<void> {
  if (_certifyState.status === "running") return;
  if (_certifyCleanup) { try { await _certifyCleanup(); } catch {} _certifyCleanup = null; }

  _certifyState = { status: "running", logs: [], reportNumbers: [], currentIndex: 0 };
  _certifyLog("بدء جلسة التعميد...");

  try {
    const session = await createIsolatedContextForRole("certifier");
    if (!session) {
      _certifyState.status = "failed";
      _certifyState.error = "لا توجد جلسة معمد بيانات — سجّل الدخول أولاً من صفحة جلسة تقييم";
      _certifyLog("❌ " + _certifyState.error);
      return;
    }

    _certifyCleanup = session.cleanup;
    const context = session.context;

    // ── تاب (1): قائمة التقارير ──────────────────────────────────────────────
    _certifyLog("📂 فتح صفحة قائمة التقارير...");
    _certifyPage = await context.newPage();

    try {
      await _certifyPage.goto(CERTIFY_REPORTS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (navErr: any) {
      _certifyState.status = "failed";
      _certifyState.error = `لا يمكن الوصول للموقع — تأكد أن الأتمتة تعمل على جهازك المحلي. (${navErr.message})`;
      _certifyLog("❌ " + _certifyState.error);
      if (_certifyCleanup) { try { await _certifyCleanup(); } catch {} _certifyCleanup = null; }
      _certifyPage = null;
      return;
    }

    _certifyLog(`📄 الصفحة: ${_certifyPage.url()}`);

    // ── انتظر ظهور عنصر الفلتر أولاً ────────────────────────────────────────
    _certifyLog("⏳ انتظار تحميل عنصر الفلتر...");
    try {
      await _certifyPage.waitForSelector(
        "#report-status-filter, [id='report-status-filter']",
        { timeout: 60000 }
      );
      _certifyLog("✅ عنصر الفلتر جاهز");
    } catch {
      _certifyLog("⚠️ لم يظهر عنصر الفلتر خلال 60 ثانية — محاولة المتابعة");
    }

    // ── اكتشف نوع العنصر وطبّق الفلتر ───────────────────────────────────────
    _certifyLog("🔍 تطبيق فلتر 'تقارير بإنتظار الإعتماد'...");

    const filterTagName: string = await _certifyPage.evaluate(() => {
      const el = document.querySelector("#report-status-filter, [id='report-status-filter']");
      return el ? el.tagName.toLowerCase() : "not_found";
    });
    _certifyLog(`🔎 نوع عنصر الفلتر: ${filterTagName}`);

    let filterDone = false;

    // ── الحالة 1: <select> عادي ─────────────────────────────────────────────
    if (filterTagName === "select") {
      try {
        const allOptions: string[] = await _certifyPage.evaluate(() => {
          const sel = document.querySelector("#report-status-filter") as HTMLSelectElement;
          if (!sel) return [];
          return Array.from(sel.options).map(o => `[${o.value}] ${o.text}`);
        });
        _certifyLog(`📋 خيارات الفلتر: ${allOptions.join(" | ")}`);

        const optionValue: string | null = await _certifyPage.evaluate(() => {
          const sel = document.querySelector("#report-status-filter") as HTMLSelectElement;
          if (!sel) return null;
          for (const opt of Array.from(sel.options)) {
            const n = opt.text.replace(/[أإآا]/g, "ا").replace(/[ةه]/g, "ه");
            if (n.includes("نتظار") && n.includes("عتماد")) return opt.value;
          }
          return null;
        });
        if (optionValue !== null) {
          await _certifyPage.selectOption("#report-status-filter", { value: optionValue });
          _certifyLog(`✅ تم تطبيق الفلتر (قيمة: "${optionValue}")`);
          filterDone = true;
        } else {
          _certifyLog("⚠️ لم يُعثر على خيار 'بانتظار الاعتماد' داخل <select>");
        }
      } catch (e: any) {
        _certifyLog(`⚠️ selectOption فشل: ${e.message}`);
      }
    }

    // ── الحالة 2: Angular mat-select أو ng-select ────────────────────────────
    if (!filterDone) {
      try {
        await _certifyPage.click("#report-status-filter", { timeout: 10000 });
        _certifyLog("✅ نقر على الفلتر — انتظار ظهور القائمة...");
        await _certifyPage.waitForTimeout(1500);

        const allOverlayOpts: string[] = await _certifyPage.evaluate(() => {
          const found: string[] = [];
          for (const sel of ["mat-option", "li[role='option']", "[role='option']", ".ng-option"]) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              const t = (el.textContent || "").trim();
              if (t) found.push(t);
            }
          }
          return found;
        });
        if (allOverlayOpts.length > 0) {
          _certifyLog(`📋 خيارات القائمة: ${allOverlayOpts.join(" | ")}`);
        }

        const optClicked: string | null = await _certifyPage.evaluate(() => {
          for (const sel of ["mat-option", "li[role='option']", "[role='option']", ".ng-option", ".dropdown-item"]) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              const txt = (el.textContent || "").trim();
              const n = txt.replace(/[أإآا]/g, "ا").replace(/[ةه]/g, "ه");
              if (n.includes("نتظار") && n.includes("عتماد")) {
                (el as HTMLElement).click();
                return txt;
              }
            }
          }
          return null;
        });

        if (optClicked) {
          _certifyLog(`✅ تم اختيار: "${optClicked}"`);
          filterDone = true;
        } else {
          _certifyLog("⚠️ لم يُعثر على الخيار المطلوب في القائمة");
        }
      } catch (e: any) {
        _certifyLog(`⚠️ فشل تطبيق الفلتر: ${e.message}`);
      }
    }

    // ── انتظر تحميل خلايا الجدول بعد الفلتر (max 15 ثانية) ─────────────────
    _certifyLog("⏳ انتظار ظهور بيانات الجدول المفلتر...");
    try {
      await _certifyPage.waitForFunction(() => {
        // ابحث عن أي خلية جدول تحتوي على رقم 5+ أرقام
        return Array.from(document.querySelectorAll("td, a")).some(el => {
          const t = (el.textContent || "").trim();
          return /^\d{5,10}$/.test(t);
        });
      }, { timeout: 15000 });
      _certifyLog("✅ ظهرت بيانات الجدول");
    } catch {
      _certifyLog("⚠️ لم تظهر بيانات خلال 15 ثانية — سيُقرأ الجدول على أي حال");
    }

    // ── تشخيص: طباعة نماذج من روابط الصفحة ─────────────────────────────────
    _certifyLog("📋 قراءة روابط التقارير من الصفحة...");
    const debugLinks: string[] = await _certifyPage.evaluate(() =>
      Array.from(document.querySelectorAll("a[href]"))
        .map(a => (a as HTMLAnchorElement).href)
        .filter(h => h && !h.endsWith("#") && h !== location.href)
        .slice(0, 15)
    ).catch(() => [] as string[]);
    _certifyLog(`🔍 روابط الصفحة (أول 15): ${debugLinks.join(" | ") || "لا يوجد"}`);

    // ── استخرج أرقام التقارير — 3 استراتيجيات بالتسلسل ─────────────────────
    const numbers: string[] = await _certifyPage.evaluate(() => {
      const seen = new Set<string>();
      const results: string[] = [];
      const addNum = (n: string) => {
        // تجاهل أرقام أقل من 5 خانات (pagination، sector IDs، إلخ)
        if (n.length < 5) return;
        if (!seen.has(n)) { seen.add(n); results.push(n); }
      };

      // ★ الاستراتيجية 1 (الأدق): نص الرابط هو رقم فقط (عمود "الرقم" في الجدول)
      for (const a of Array.from(document.querySelectorAll("a"))) {
        const txt = (a.textContent || "").trim();
        if (/^\d{5,10}$/.test(txt)) addNum(txt);
      }

      // ★ الاستراتيجية 2: خلايا <td> تحتوي على رقم فقط
      for (const td of Array.from(document.querySelectorAll("td"))) {
        const txt = (td.textContent || "").trim();
        if (/^\d{5,10}$/.test(txt)) addNum(txt);
      }

      // ★ الاستراتيجية 3: آخر جزء من href يكون رقم 5+ خانات
      for (const a of Array.from(document.querySelectorAll("a[href]"))) {
        const href = (a as HTMLAnchorElement).href || "";
        // مطابقة /NNNNN في نهاية الـ href (قبل ؟ أو # أو نهاية النص)
        const m = href.match(/\/(\d{5,10})(?:\?|#|$)/);
        if (m) addNum(m[1]);
      }

      return results;
    }).catch(() => [] as string[]);

    _certifyState.reportNumbers = numbers;
    _certifyState.currentIndex = 0;

    if (numbers.length > 0) {
      _certifyLog(`✅ وُجد ${numbers.length} تقرير بانتظار الاعتماد: ${numbers.slice(0, 5).join(", ")}${numbers.length > 5 ? "..." : ""}`);

      // افتح أول تقرير عبر openCertifyReport التي تبدأ polling watcher تلقائياً
      await openCertifyReport(numbers[0]);

      // ابدأ الاعتماد التلقائي فوراً بعد تحديد الـ checkbox
      _certifyState.status = "approving";
      _certifyLog("🚀 بدء الاعتماد التلقائي — جارٍ إرسال النموذج...");
      _approveAndExtract().catch(e =>
        _certifyLog(`❌ خطأ في الاعتماد التلقائي: ${e.message}`)
      );
    } else {
      _certifyLog("⚠️ لم يُعثر على تقارير بانتظار الاعتماد في الجدول — ربما الصفحة فارغة أو الفلتر لم ينطبق");
      _certifyState.status = "ready";
    }

  } catch (err: any) {
    _certifyState.status = "failed";
    _certifyState.error = err.message;
    _certifyLog("❌ خطأ: " + err.message);
    if (_certifyCleanup) { try { await _certifyCleanup(); } catch {} _certifyCleanup = null; }
    _certifyPage = null;
    _certifyReportPage = null;
  }
}

// ── تحديد checkbox الموافقة على السياسات ───────────────────────────────────
async function _checkPolicyCheckbox(page: any): Promise<void> {
  try {
    await page.waitForTimeout(2000);
    _certifyLog("🔍 البحث عن checkbox الموافقة...");

    // Strategy 1: input[type=checkbox] بجانب نص "أقر بأن"
    const strategies = [
      // checkbox داخل label يحتوي النص
      () => page.locator("label").filter({ hasText: /أقر بأن|المعلومات المدخلة|ملخص التقرير صحيحة/ }).locator("input[type='checkbox']").first(),
      // checkbox مستقل + label[for=id]
      () => page.locator("input[type='checkbox']").filter({ has: page.locator("xpath=..//label[contains(text(),'أقر')]") }).first(),
      // mat-checkbox
      () => page.locator("mat-checkbox").filter({ hasText: /أقر بأن|المعلومات المدخلة/ }).first(),
      // أي checkbox في الصفحة (fallback)
      () => page.locator("input[type='checkbox']").first(),
    ];

    for (let i = 0; i < strategies.length; i++) {
      try {
        const loc = strategies[i]();
        const count = await loc.count();
        if (count === 0) continue;

        const isChecked = await loc.isChecked().catch(() => false);
        if (isChecked) {
          _certifyLog(`☑️ Checkbox مُحدَّد مسبقاً (strategy ${i + 1})`);
          return;
        }
        await loc.scrollIntoViewIfNeeded({ timeout: 3000 });
        await loc.check({ timeout: 6000 });
        _certifyLog(`☑️ تم تحديد checkbox (strategy ${i + 1})`);
        return;
      } catch { /* جرّب التالي */ }
    }

    // Strategy fallback: انقر على الـ label مباشرة
    try {
      const labelLoc = page.locator("label, span").filter({ hasText: /أقر بأن|المعلومات المدخلة/ }).first();
      if (await labelLoc.count() > 0) {
        await labelLoc.click({ timeout: 6000 });
        _certifyLog("☑️ تم النقر على label الموافقة (fallback)");
        return;
      }
    } catch {}

    _certifyLog("⚠️ لم يُعثر على checkbox الموافقة على السياسات");
  } catch (e: any) {
    _certifyLog(`⚠️ خطأ في تحديد checkbox: ${e.message}`);
  }
}

// يفتح التقرير في التاب الثاني (يبقي التاب الأول على قائمة التقارير)
async function openCertifyReport(reportNumber: string): Promise<void> {
  if (!_certifyPage) throw new Error("المتصفح غير مفتوح — شغّل بداية التعميد أولاً");
  const context = _certifyPage.context();
  const url = `${CERTIFY_REPORT_BASE}/${reportNumber}?office=${CERTIFY_OFFICE}`;
  _certifyLog(`🔗 فتح تقرير رقم ${reportNumber} في التاب الثاني...`);
  // أغلق التاب القديم إن وُجد وافتح واحداً جديداً
  if (_certifyReportPage) {
    try { await _certifyReportPage.close(); } catch {}
  }
  _certifyReportPage = await context.newPage();
  // بدّء المراقب التلقائي قبل التنقل لرصد صفحة الشهادة
  _certifyExtracting = false;
  _watchForCertificatePage(_certifyReportPage);
  await _certifyReportPage.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
  _certifyState.openedReport = reportNumber;
  const idx = _certifyState.reportNumbers.indexOf(reportNumber);
  if (idx !== -1) _certifyState.currentIndex = idx;
  _certifyLog(`✅ التقرير ${reportNumber} مفتوح (${_certifyState.currentIndex + 1} من ${_certifyState.reportNumbers.length})`);
  // حدّد checkbox الموافقة تلقائياً
  await _checkPolicyCheckbox(_certifyReportPage);
}

async function nextCertifyReport(): Promise<{ reportNumber: string; index: number; total: number } | null> {
  if (!_certifyPage) throw new Error("المتصفح غير مفتوح — شغّل بداية التعميد أولاً");
  const nextIndex = _certifyState.currentIndex + 1;
  if (nextIndex >= _certifyState.reportNumbers.length) {
    _certifyLog("⚠️ لا توجد تقارير إضافية في هذه الصفحة");
    return null;
  }
  const reportNumber = _certifyState.reportNumbers[nextIndex];
  _certifyState.currentIndex = nextIndex;
  await openCertifyReport(reportNumber);
  return { reportNumber, index: nextIndex + 1, total: _certifyState.reportNumbers.length };
}

// ── استخراج بيانات الشهادة وإرسالها (يُستدعى تلقائياً أو يدوياً) ─────────
async function _doExtractAndSend(page: any): Promise<{
  dcNumber: string; finalValue: string; reportNumber: string; qrBase64: string;
}> {
  await page.waitForTimeout(2000);

  // 1) استخرج رقم DC والقيمة النهائية
  _certifyLog("📋 استخراج بيانات الشهادة...");
  const extracted: { dcNumber: string; finalValue: string } = await page.evaluate(() => {
    const fullText = document.body.innerText || "";
    const dcMatch = fullText.match(/DC\d+/i);
    const dcNumber = dcMatch ? dcMatch[0].toUpperCase() : "";
    const valMatch = fullText.match(/الر[أا]ي النهائي.*?[:：]\s*([\d,،٬]+)/);
    const finalValue = valMatch ? valMatch[1].replace(/[,،٬]/g, "") : "";
    return { dcNumber, finalValue };
  });
  _certifyLog(`📌 رقم DC: ${extracted.dcNumber || "(لم يُعثر)"} | القيمة: ${extracted.finalValue || "(لم تُعثر)"}`);

  // 2) مسح QR — استخراج صورة QR كـ base64 + URL المحتوى من رابط الصورة
  _certifyLog("🔍 مسح QR Code...");
  let qrBase64 = "";     // صورة QR كـ base64 PNG (للإرسال في qrCodeBase64)
  let qrContentUrl = ""; // URL المستخرج من محتوى QR (للفتح في تاب جديد)

  const QR_SELECTORS = [
    "img[src*='apiqrserver']",
    "img[src*='create-qr']",
    "img[src*='qr']",
    "img[alt*='qr' i]",
    "img[alt*='QR']",
    "[class*='qr'] img",
    "[class*='certificate'] img",
  ].join(", ");

  try {
    // أ) استخرج src رابط صورة QR من الصفحة
    const qrSrc: string = await page.evaluate((sel: string) => {
      const img = document.querySelector(sel) as HTMLImageElement | null;
      return img?.src || "";
    }, QR_SELECTORS).catch(() => "");

    if (qrSrc) {
      _certifyLog(`📷 وجدت صورة QR: ${qrSrc.slice(0, 120)}`);

      // ب) استخرج URL محتوى QR من query params (data / text / content)
      try {
        const u = new URL(qrSrc);
        const raw = u.searchParams.get("data") || u.searchParams.get("text") || u.searchParams.get("content") || "";
        if (raw) {
          qrContentUrl = decodeURIComponent(raw);
          _certifyLog(`✅ محتوى QR (URL للفتح): ${qrContentUrl.slice(0, 200)}`);
        }
      } catch {}

      // ج) التقط صورة عنصر QR كـ PNG base64 — هذا هو qrCodeBase64
      const qrElem = await page.$(QR_SELECTORS);
      if (qrElem) {
        const qrBuf: Buffer = await qrElem.screenshot({ type: "png" });
        qrBase64 = qrBuf.toString("base64");
        _certifyLog(`🖼️ صورة QR (base64 PNG): ${Math.round(qrBuf.length / 1024)} KB`);
      }
    } else {
      _certifyLog("⚠️ لم يُعثر على صورة QR في الصفحة");
    }
  } catch (e: any) {
    _certifyLog(`⚠️ خطأ في مسح QR: ${e.message}`);
  }

  // 3) فتح URL من QR في تاب جديد → التقاط screenshot كامل للصفحة → إرساله كملف
  const reportNumber = _certifyState.openedReport ?? "";
  const submittedAt = new Date().toISOString();
  let certBuffer: Buffer = Buffer.alloc(0);
  let certFilename = `certificate_${reportNumber || "report"}.png`;
  let certMime = "image/png";

  if (qrContentUrl.startsWith("http")) {
    _certifyLog(`🌐 فتح URL من QR في تاب جديد: ${qrContentUrl.slice(0, 120)}`);
    let qrPage: any = null;
    try {
      qrPage = await page.context().newPage();
      await qrPage.goto(qrContentUrl, { waitUntil: "networkidle", timeout: 30000 });
      _certifyLog(`✅ صفحة QR محملة: ${qrPage.url()}`);

      // انتظر ثلاث ثوانٍ لتحميل أي محتوى ديناميكي
      await qrPage.waitForTimeout(3000);

      // التقاط screenshot كامل للصفحة (full page)
      _certifyLog("📸 التقاط screenshot للصفحة...");
      const screenshotBuf: Buffer = await qrPage.screenshot({
        type: "png",
        fullPage: true,
      });
      certBuffer = screenshotBuf;
      certFilename = `certificate_${reportNumber}_qr.png`;
      certMime = "image/png";
      _certifyLog(`✅ Screenshot جاهز: ${certFilename} (${Math.round(certBuffer.length / 1024)} KB)`);
    } catch (e: any) {
      _certifyLog(`⚠️ خطأ في فتح/تصوير صفحة QR: ${e.message?.slice(0, 120)}`);
    } finally {
      if (qrPage) { try { await qrPage.close(); } catch {} }
    }
  } else {
    _certifyLog("⚠️ لم يُعثر على URL في QR — لا يمكن فتح الصفحة");
  }

  _certifyLog(`📊 الملف: ${certBuffer.length > 0 ? `${certFilename} (${Math.round(certBuffer.length / 1024)} KB)` : "غير متوفر"}`);

  // 4) إرسال لـ QrInformationApi باستخدام form-data + http.request
  _certifyLog("📡 إرسال البيانات + PDF لـ QrInformationApi...");
  try {
    const FormDataLib = require("form-data");
    const http = require("http") as typeof import("http");
    const fd = new FormDataLib();
    fd.append("reportCode",         extracted.dcNumber  || "");
    fd.append("taqeemReportNumber", reportNumber        || "");
    fd.append("taqeemSubmittedAt",  submittedAt         || "");
    fd.append("qrCodeBase64",       qrBase64            || "");
    fd.append("finalValue",         extracted.finalValue|| "");
    if (certBuffer.length > 0) {
      fd.append("certificatePath", certBuffer, {
        filename: certFilename,
        contentType: certMime,
        knownLength: certBuffer.length,
      });
      _certifyLog(`📎 إضافة certificatePath: ${certFilename} (${Math.round(certBuffer.length / 1024)} KB)`);
    } else {
      _certifyLog("⚠️ certificatePath فارغ — سيُرسل الطلب بدون ملف");
    }

    await new Promise<void>((resolve) => {
      const reqOpts = {
        hostname: "localhost",
        port: 5000,
        path: "/External/QrInformationApi",
        method: "POST",
        headers: fd.getHeaders(),
      };
      const req = http.request(reqOpts, (res: any) => {
        let body = "";
        res.on("data", (chunk: any) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            _certifyLog(`✅ QrInformationApi: ${res.statusCode}`);
          } else {
            _certifyLog(`⚠️ QrInformationApi: ${res.statusCode} — ${body.slice(0, 300)}`);
          }
          resolve();
        });
      });
      req.on("error", (err: any) => {
        _certifyLog(`❌ QrInformationApi فشل: ${err.message?.slice(0, 120)}`);
        resolve();
      });
      fd.pipe(req);
    });
  } catch (e: any) {
    _certifyLog(`❌ QrInformationApi خطأ عام: ${e.message?.slice(0, 120)}`);
  }

  return { dcNumber: extracted.dcNumber, finalValue: extracted.finalValue, reportNumber, qrBase64 };
}


// ── مراقب Polling: يفحص كل ثانيتين إن ظهر QR (يعمل مع SPA والضغط اليدوي) ──
function _watchForCertificatePage(page: any): void {
  (async () => {
    _certifyLog("👁️ بدء مراقبة صفحة التقرير بـ polling (كل 2 ثانية)...");
    let consecutiveFails = 0;
    const MAX_FAILS = 15; // يتحمل حتى 30 ثانية من الأخطاء المتتالية (أثناء التنقل)
    while (consecutiveFails < MAX_FAILS) {
      await new Promise(r => setTimeout(r, 2000));
      if (_certifyExtracting) { consecutiveFails = 0; continue; }
      try {
        const result: { hasQR: boolean; url: string } = await page.evaluate(() => {
          const hasQR = Array.from(document.querySelectorAll("img")).some((img: any) =>
            img.src && (
              img.src.includes("qr") ||
              img.src.includes("create-qr") ||
              img.src.includes("registration") ||
              img.src.includes("certificate") ||
              img.src.includes("qrcode")
            )
          );
          return { hasQR, url: window.location.href };
        });
        consecutiveFails = 0;
        if (result.hasQR && !_certifyExtracting) {
          _certifyExtracting = true;
          _certifyLog(`🎯 QR مكتشف على: ${result.url} — جارٍ الاستخراج...`);
          try {
            await _doExtractAndSend(page);
            _certifyLog("✅ اكتمل الاستخراج والإرسال التلقائي");
          } catch (e: any) {
            _certifyLog(`❌ خطأ في الاستخراج: ${e.message}`);
          } finally {
            _certifyExtracting = false;
          }
          break;
        }
      } catch (err: any) {
        consecutiveFails++;
        if (consecutiveFails % 5 === 0) {
          _certifyLog(`⚠️ polling: ${consecutiveFails}/${MAX_FAILS} خطأ متتالٍ (الصفحة قد تكون تتنقل...)`);
        }
      }
    }
    _certifyLog("🛑 توقف مراقب الـ polling");
  })();
}

// ── اعتماد التقرير: ضغط الزر + استخراج البيانات + إرسال للـ API ───────────
async function _approveAndExtract(): Promise<{
  dcNumber: string; finalValue: string; reportNumber: string; qrBase64: string;
}> {
  _certifyLog("🚀 بدء تنفيذ اعتماد التقرير...");

  // إذا كان _certifyReportPage null، حاول استعادته من التابات المفتوحة
  if (!_certifyReportPage && _certifyPage) {
    _certifyLog("⚠️ _certifyReportPage null — البحث عن تاب التقرير...");
    const ctx = _certifyPage.context();
    const allPages = ctx.pages();
    _certifyLog(`📑 عدد التابات المفتوحة: ${allPages.length}`);
    for (const p of allPages) {
      const url = p.url();
      _certifyLog(`  → ${url}`);
      if (url.includes("/report/") || (url.includes(CERTIFY_REPORT_BASE) && p !== _certifyPage)) {
        _certifyReportPage = p;
        _certifyLog(`✅ تم العثور على تاب التقرير: ${url}`);
        break;
      }
    }
  }

  if (!_certifyReportPage) throw new Error("لا يوجد تقرير مفتوح في التاب الثاني — افتح تقريراً أولاً");
  const page = _certifyReportPage;
  _certifyLog(`📄 صفحة التقرير: ${page.url()}`);

  // 1) سجّل جميع الأزرار الموجودة على الصفحة للتشخيص
  _certifyLog("🔍 قراءة قائمة الأزرار على صفحة التقرير...");
  const allBtns: string[] = await page.evaluate(() => {
    return Array.from(document.querySelectorAll("button, [role='button'], a.btn, input[type='submit']"))
      .map(el => (el.textContent || "").trim())
      .filter(t => t.length > 0);
  });
  _certifyLog(`📋 الأزرار: ${allBtns.join(" | ")}`);

  // 2) انقر زر الاعتماد — input[type=submit]#confirm
  _certifyLog("🖱️ محاولة النقر على زر الاعتماد (input#confirm)...");
  let btnClicked = false;

  // انتظر قليلاً بعد تحديد checkbox
  await page.waitForTimeout(1000);

  // ── تحقق أولاً من وجود #mainForm — إذا لم يوجد انتقل للتالي ────────────────
  const hasMainForm: boolean = await page.evaluate(() => !!document.getElementById("mainForm")).catch(() => false);
  if (!hasMainForm) {
    _certifyLog("⚠️ هذا التقرير ليس له نموذج اعتماد (#mainForm غير موجود) — الانتقال للتقرير التالي تلقائياً...");
    const next = await nextCertifyReport().catch(() => null);
    if (next) {
      _certifyLog(`➡️ فتح التقرير التالي: ${next.reportNumber} (${next.index} من ${next.total})`);
      await new Promise(r => setTimeout(r, 2000));
      return await _approveAndExtract();
    } else {
      _certifyLog("⚠️ لا توجد تقارير أخرى في القائمة");
      return { dcNumber: "", finalValue: "", reportNumber: _certifyState.openedReport ?? "", qrBase64: "" };
    }
  }

  // ── محاولة 1: form.submit() + hidden input لاسم الزر (يتجاوز vD تماماً) ──
  // ملاحظة: form.submit() لا يُضيف قيمة أي submit button تلقائياً
  // لذا نُضيف hidden input باسم "confirm" قبل الإرسال ليعرف الخادم الإجراء
  _certifyLog("📤 محاولة form.submit() مع hidden confirm input...");
  try {
    const submitResult: string = await page.evaluate(() => {
      // استخدم #mainForm فقط — لا fallback لأي نموذج آخر
      const form = document.getElementById("mainForm") as HTMLFormElement | null;
      if (!form) return "no_mainForm";

      // تأكد من تحديد الـ checkbox
      const cb = form.querySelector("input[type='checkbox'][name='policy']") as HTMLInputElement | null
              || form.querySelector("input[type='checkbox']") as HTMLInputElement | null;
      if (cb && !cb.checked) { cb.checked = true; }

      // تأكد من أن زر confirm ليس disabled
      const confirmBtn = document.getElementById("confirm") as HTMLInputElement | null;
      if (confirmBtn) confirmBtn.disabled = false;

      // أضف hidden input بقيمة زر confirm (الخادم يحتاجها لمعرفة الإجراء)
      const existing = form.querySelector("input[type='hidden'][name='confirm']");
      if (!existing) {
        const hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = "confirm";
        hidden.value = confirmBtn?.value || "اعتماد التقرير";
        form.appendChild(hidden);
      }

      // أرسل النموذج مباشرة — لا يُطلق أي حدث JS
      form.submit();
      return "submitted";
    });
    _certifyLog(`📤 form.submit() result: ${submitResult}`);
    if (submitResult === "submitted") {
      btnClicked = true;
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      _certifyLog(`✅ الصفحة بعد submit: ${page.url()}`);
    }
  } catch (e: any) {
    _certifyLog(`↪️ form.submit() فشل: ${(e as Error).message?.slice(0, 120)}`);
  }

  // ── محاولة 2: clone النموذج كاملاً + submit (يُزيل كل معالجات JS) ──
  if (!btnClicked) {
    _certifyLog("🔄 محاولة clone النموذج + submit...");
    try {
      await page.evaluate(() => {
        // استخدم #mainForm فقط — لا fallback
        const form = document.getElementById("mainForm") as HTMLFormElement | null;
        if (!form) return;
        // تحديد checkbox في النموذج الأصلي
        const cb = form.querySelector("input[type='checkbox']") as HTMLInputElement | null;
        if (cb && !cb.checked) cb.checked = true;
        // إضافة hidden input قبل clone
        let hidden = form.querySelector("input[type='hidden'][name='confirm']") as HTMLInputElement | null;
        if (!hidden) {
          hidden = document.createElement("input");
          hidden.type = "hidden"; hidden.name = "confirm"; hidden.value = "اعتماد التقرير";
          form.appendChild(hidden);
        }
        // clone لإزالة جميع event listeners ثم submit
        const clone = form.cloneNode(true) as HTMLFormElement;
        form.replaceWith(clone);
        clone.submit();
      });
      btnClicked = true;
      await page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
      _certifyLog(`✅ clone+submit — الصفحة: ${page.url()}`);
    } catch (e: any) {
      _certifyLog(`↪️ clone+submit فشل: ${(e as Error).message?.slice(0, 120)}`);
    }
  }

  if (!btnClicked) {
    _certifyLog("⚠️ فشل الضغط التلقائي — المراقب Polling سيرصد الضغط اليدوي تلقائياً");
  }

  // ── المراقب Polling يتولى الاستخراج (يعمل بالتوازي منذ openCertifyReport) ──
  // هنا ننتظر فقط إن نجح الضغط التلقائي — وإلا يعمل المراقب مع الضغط اليدوي
  if (btnClicked) {
    _certifyLog("⏳ انتظار ظهور QR بعد الضغط التلقائي...");
    try {
      await page.waitForFunction(() => {
        return Array.from(document.querySelectorAll("img")).some(
          (img: any) => img.src && (
            img.src.includes("qr") || img.src.includes("create-qr") ||
            img.src.includes("registration") || img.src.includes("certificate")
          )
        );
      }, { timeout: 30000 });
      _certifyLog("✅ ظهر QR — يمكن للمراقب الـ polling الاستخراج");
    } catch {
      _certifyLog("⚠️ QR لم يظهر بعد 30 ثانية — المراقب سيواصل المراقبة");
    }
    return await _doExtractAndSend(page);
  }

  // إذا فشل الضغط التلقائي — أعد قيمة فارغة وأترك المراقب يعمل
  _certifyLog("ℹ️ المراقب Polling يعمل في الخلفية — اضغط زر الاعتماد يدوياً في المتصفح");
  return { dcNumber: "", finalValue: "", reportNumber: _certifyState.openedReport ?? "", qrBase64: "" };
}

async function stopCertifySession(): Promise<void> {
  if (_certifyReportPage) { try { await _certifyReportPage.close(); } catch {} _certifyReportPage = null; }
  if (_certifyCleanup) { try { await _certifyCleanup(); } catch {} _certifyCleanup = null; }
  _certifyState = { status: "idle", logs: [], reportNumbers: [], currentIndex: 0 };
  _certifyPage = null;
}

const router = Router();

// ─── إعداد رفع الملفات ────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}_${file.originalname}`);
  },
});
const upload = multer({ storage: diskStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─────────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/automation/session-status?role=entry|certifier
router.get("/automation/session-status", async (req, res) => {
  const role = req.query.role === "certifier" ? "certifier" : "entry";
  const status = getLoginStatus(role);
  const pendingCount = role === "entry" ? await hasPendingQueue().catch(() => 0) : 0;
  res.json({ ...status, pendingQueueCount: pendingCount });
});

// POST /api/automation/login  { username, password, role? }
router.post("/automation/login", async (req, res) => {
  try {
    const { username, password, role: rawRole } = req.body;
    const role = rawRole === "certifier" ? "certifier" : "entry";
    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    const loginId = await startLogin(String(username), String(password), role);
    res.json({ loginId, message: "بدأت عملية تسجيل الدخول — انتظر رمز OTP" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to start login");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/automation/login-otp  { loginId, otp, role? }
router.post("/automation/login-otp", (req, res) => {
  const { loginId, otp, role: rawRole } = req.body;
  const role = rawRole === "certifier" ? "certifier" : "entry";
  if (!loginId || !otp) {
    res.status(400).json({ error: "loginId and otp are required" });
    return;
  }
  const ok = submitLoginOtp(String(loginId), String(otp), role);
  if (!ok) {
    res.status(400).json({ error: "جلسة تسجيل الدخول غير موجودة أو انتهت" });
    return;
  }
  res.json({ message: "تم إرسال OTP — جارٍ إكمال تسجيل الدخول..." });
});

// POST /api/automation/logout  { role? }
router.post("/automation/logout", async (req, res) => {
  const role = req.body?.role === "certifier" ? "certifier" : "entry";
  await logout(role);
  res.json({ message: "تم تسجيل الخروج وحذف الجلسة." });
});

// ─────────────────────────────────────────────────────────────────────────────
// CERTIFY BOT — يُستخدم من قِبَل معمد البيانات
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/automation/certify/status
router.get("/automation/certify/status", (_req, res) => {
  res.json(getCertifyStatus());
});

// GET /api/automation/certify/version
router.get("/automation/certify/version", (_req, res) => {
  res.json({ version: CERTIFY_BOT_VERSION });
});

// POST /api/automation/certify/start
router.post("/automation/certify/start", async (_req, res) => {
  try {
    _certifyLog(`🤖 CertifyBot ${CERTIFY_BOT_VERSION}`);
    startCertifySession().catch(err =>
      console.error("[certify-start] unexpected error:", err)
    );
    res.json({ message: "جارٍ فتح المتصفح وتحميل صفحة التقارير..." });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/certify/stop
router.post("/automation/certify/stop", async (_req, res) => {
  await stopCertifySession();
  res.json({ message: "تم إغلاق جلسة التعميد." });
});

// POST /api/automation/certify/open  { reportNumber }
router.post("/automation/certify/open", async (req, res) => {
  const { reportNumber } = req.body ?? {};
  if (!reportNumber) {
    res.status(400).json({ error: "reportNumber مطلوب" });
    return;
  }
  try {
    await openCertifyReport(String(reportNumber));
    res.json({ message: `تم فتح التقرير ${reportNumber}` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/certify/next  — انتقل للتقرير التالي تلقائياً
router.post("/automation/certify/next", async (_req, res) => {
  try {
    const result = await nextCertifyReport();
    if (!result) {
      res.json({ done: true, message: "انتهت جميع التقارير في هذه الصفحة" });
    } else {
      res.json({ done: false, ...result });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/certify/approve  — اعتماد التقرير الحالي واستخراج البيانات وإرسالها
router.post("/automation/certify/approve", async (_req, res) => {
  try {
    const result = await _approveAndExtract();
    res.json({ success: true, ...result, qrBase64: result.qrBase64 ? `data:image/png;base64,${result.qrBase64}` : "" });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/automation/certify/refresh  — إعادة قراءة أرقام التقارير من الصفحة الحالية
router.post("/automation/certify/refresh", async (_req, res) => {
  if (!_certifyPage) {
    res.status(400).json({ error: "المتصفح غير مفتوح" });
    return;
  }
  try {
    const numbers: string[] = await _certifyPage.evaluate(() => {
      const results: string[] = [];
      const links = document.querySelectorAll("table a, td a, .mat-cell a, [class*='cell'] a");
      for (const link of Array.from(links)) {
        const text = (link.textContent || "").trim();
        if (/^\d{6,8}$/.test(text) && !results.includes(text)) results.push(text);
      }
      if (results.length === 0) {
        const cells = document.querySelectorAll("td, .mat-cell");
        for (const cell of Array.from(cells)) {
          const text = (cell.textContent || "").trim();
          if (/^\d{6,8}$/.test(text) && !results.includes(text)) results.push(text);
        }
      }
      return results;
    }).catch(() => [] as string[]);
    _certifyState.reportNumbers = numbers;
    res.json({ reportNumbers: numbers, count: numbers.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL SUBMIT — يُستدعى من النظام الخارجي
// POST /api/automation/submit-external
//
// الطلب: multipart/form-data
//   • data  → JSON string لبيانات التقرير
//   • pdf   → ملف PDF (stream)
//
// الاستجابة عند الجلسة نشطة:   { status: "processing", reportId, sessionId }
// الاستجابة عند الجلسة منتهية: { status: "queued",     reportId }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/automation/submit-external", upload.single("pdf"), async (req, res) => {
  try {
    // ─── التحقق من وجود الملف ───────────────────────────────────────────────
    if (!req.file) {
      res.status(400).json({ error: "يجب إرسال ملف PDF في الحقل 'pdf'" });
      return;
    }

    // ─── تحليل بيانات JSON ──────────────────────────────────────────────────
    let reportData: Record<string, any> = {};
    if (req.body.data) {
      try {
        reportData = JSON.parse(req.body.data);
      } catch {
        res.status(400).json({ error: "حقل 'data' يجب أن يكون JSON صالحاً" });
        return;
      }
    }

    // ─── حفظ التقرير في قاعدة البيانات ────────────────────────────────────
    const report = await insertReport({
      reportNumber:                reportData.reportNumber             ?? null,
      reportDate:                  reportData.reportDate               ?? null,
      valuationDate:               reportData.valuationDate            ?? null,
      inspectionDate:              reportData.inspectionDate           ?? null,
      commissionDate:              reportData.commissionDate           ?? null,
      requestNumber:               reportData.requestNumber            ?? null,
      valuerName:                  reportData.valuerName               ?? null,
      licenseNumber:               reportData.licenseNumber            ?? null,
      licenseDate:                 reportData.licenseDate              ?? null,
      membershipNumber:            reportData.membershipNumber         ?? null,
      membershipType:              reportData.membershipType           ?? null,
      valuerPercentage:            reportData.valuerPercentage         ?? null,
      secondValuerName:            reportData.secondValuerName         ?? null,
      secondValuerPercentage:      reportData.secondValuerPercentage   ?? null,
      secondValuerLicenseNumber:   reportData.secondValuerLicenseNumber  ?? null,
      secondValuerMembershipNumber:reportData.secondValuerMembershipNumber ?? null,
      clientName:                  reportData.clientName               ?? null,
      clientEmail:                 reportData.clientEmail              ?? null,
      clientPhone:                 reportData.clientPhone              ?? null,
      intendedUser:                reportData.intendedUser             ?? null,
      reportType:                  reportData.reportType               ?? null,
      valuationPurpose:            reportData.valuationPurpose         ?? null,
      valuationHypothesis:         reportData.valuationHypothesis      ?? null,
      valuationBasis:              reportData.valuationBasis           ?? null,
      propertyType:                reportData.propertyType             ?? null,
      propertySubType:             reportData.propertySubType          ?? null,
      region:                      reportData.region                   ?? null,
      city:                        reportData.city                     ?? null,
      district:                    reportData.district                 ?? null,
      street:                      reportData.street                   ?? null,
      blockNumber:                 reportData.blockNumber              ?? null,
      plotNumber:                  reportData.plotNumber               ?? null,
      planNumber:                  reportData.planNumber               ?? null,
      propertyUse:                 reportData.propertyUse              ?? null,
      deedNumber:                  reportData.deedNumber               ?? null,
      deedDate:                    reportData.deedDate                 ?? null,
      ownerName:                   reportData.ownerName                ?? null,
      ownershipType:               reportData.ownershipType            ?? null,
      buildingPermitNumber:        reportData.buildingPermitNumber     ?? null,
      buildingStatus:              reportData.buildingStatus           ?? null,
      buildingAge:                 reportData.buildingAge              ?? null,
      landArea:                    reportData.landArea                 ?? null,
      buildingArea:                reportData.buildingArea             ?? null,
      basementArea:                reportData.basementArea             ?? null,
      annexArea:                   reportData.annexArea                ?? null,
      floorsCount:                 reportData.floorsCount              ?? null,
      permittedFloorsCount:        reportData.permittedFloorsCount     ?? null,
      permittedBuildingRatio:      reportData.permittedBuildingRatio   ?? null,
      streetWidth:                 reportData.streetWidth              ?? null,
      streetFacades:               reportData.streetFacades            ?? null,
      utilities:                   reportData.utilities                ?? null,
      coordinates:                 reportData.coordinates              ?? null,
      valuationMethod:             reportData.valuationMethod          ?? null,
      marketValue:                 reportData.marketValue              ?? null,
      incomeValue:                 reportData.incomeValue              ?? null,
      costValue:                   reportData.costValue                ?? null,
      finalValue:                  reportData.finalValue               ?? null,
      pricePerMeter:               reportData.pricePerMeter            ?? null,
      companyName:                 reportData.companyName              ?? null,
      commercialRegNumber:         reportData.commercialRegNumber      ?? null,
      notes:                       reportData.notes                    ?? null,
      pdfFileName:  req.file.originalname,
      pdfFilePath:  req.file.path,
      status:           "reviewed",
      automationStatus: "queued",
    });

    // ─── هل الجلسة نشطة؟ ────────────────────────────────────────────────────
    const sessionContext = await getAuthenticatedContext();

    if (sessionContext) {
      if (!canStartNewSession(MAX_CONCURRENT)) {
        // الحد الأقصى (متصفح واحد) مشغول — أضف للطابور
        console.log(`[ExternalSubmit] 🕐 تقرير #${report.id} — أُضيف للطابور (المتصفح مشغول)`);
        res.status(202).json({
          status:     "queued",
          reportId:   report.id,
          draftSaved: true,
          message:    "تم حفظ الطلب وسيُرفع تلقائياً بعد انتهاء الطلب الحالي",
        });
        return;
      }

      // ✅ يوجد فراغ — ابدأ فوراً
      console.log(`[ExternalSubmit] ✅ تقرير #${report.id} — رفع فوري (جلسة نشطة)`);
      const sessionId = await startAutomation(report.id);

      res.status(202).json({
        status:    "processing",
        reportId:  report.id,
        sessionId,
        draftSaved: true,
        message:   "تم حفظ الطلب وجارٍ رفعه فوراً على منصة تقييم",
      });
    } else {
      // 🕐 جلسة منتهية — يبقى مسودة حتى تسجيل الدخول
      console.log(`[ExternalSubmit] 🕐 تقرير #${report.id} — محفوظ كمسودة (لا توجد جلسة)`);

      res.status(202).json({
        status:    "queued",
        reportId:  report.id,
        draftSaved: true,
        message:   "تم حفظ الطلب كمسودة وسيُرفع تلقائياً عند تسجيل الدخول التالي",
      });
    }

  } catch (err: any) {
    req.log.error({ err }, "Failed to process external submission");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORT AUTOMATION
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/automation/start/:reportId
router.post("/automation/start/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) {
      res.status(400).json({ error: "Invalid report ID" });
      return;
    }

    const report = await getReportById(reportId);

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    // إذا كان "running" أو "waiting_otp" — تحقق هل يوجد جلسة فعلية في الذاكرة
    if (report.automationStatus === "running" || report.automationStatus === "waiting_otp") {
      const existingSession = getSessionByReportId(reportId);
      if (existingSession) {
        // جلسة حقيقية تعمل فعلاً
        res.status(409).json({ error: "التقرير قيد المعالجة بالفعل" });
        return;
      }
      // لا توجد جلسة — الحالة عالقة من جلسة سابقة (مثلاً إعادة تشغيل الخادم)
      // أعد الضبط وابدأ من جديد
      await updateReport(reportId, { automationStatus: "idle", automationError: "تم إعادة الضبط تلقائياً — كانت الحالة عالقة" });
    }

    if (!canStartNewSession(MAX_CONCURRENT)) {
      // المتصفح الواحد مشغول — اترك في الطابور
      await updateReport(reportId, { automationStatus: "queued" });
      res.json({ status: "queued", message: "تمت إضافة الطلب للطابور (المتصفح مشغول بطلب آخر)" });
      return;
    }

    const sessionId = await startAutomation(reportId);
    res.json({ sessionId, message: "بدأت عملية الرفع الآلي" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to start automation");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// GET /api/automation/status/:reportId
router.get("/automation/status/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) {
      res.status(400).json({ error: "Invalid report ID" });
      return;
    }

    const report = await getReportById(reportId);

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    const session = getSessionByReportId(reportId);
    const logs = session?.logs ?? [];

    // كشف الحالة العالقة: status=running لكن لا توجد جلسة فعلية في الذاكرة
    const dbStatus = report.automationStatus ?? "idle";
    const isStale = (dbStatus === "running" || dbStatus === "waiting_otp") && !session;

    res.json({
      reportId,
      automationStatus: dbStatus,
      isStale,
      automationError:  report.automationError,
      sessionId:        report.automationSessionId,
      qrCodeBase64:     report.qrCodeBase64,
      hasCertificate:   !!report.certificatePath,
      taqeemSubmittedAt: report.taqeemSubmittedAt,
      logs,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to get automation status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/automation/certificate/:reportId
router.get("/automation/certificate/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    const report = await getReportById(reportId);

    if (!report?.certificatePath) {
      res.status(404).json({ error: "Certificate not found" });
      return;
    }

    res.download(report.certificatePath);
  } catch (err: any) {
    req.log.error({ err }, "Failed to download certificate");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/automation/retry/:reportId
router.post("/automation/retry/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) {
      res.status(400).json({ error: "Invalid report ID" });
      return;
    }

    if (!canStartNewSession(MAX_CONCURRENT)) {
      // المتصفح مشغول — أضف للطابور
      await updateReport(reportId, { automationStatus: "queued", automationError: null });
      res.json({ status: "queued", message: "تمت إضافة الطلب للطابور (المتصفح مشغول بطلب آخر)" });
      return;
    }

    await updateReport(reportId, { automationStatus: "idle", automationError: null });
    const sessionId = await startAutomation(reportId);
    res.json({ sessionId, message: "تمت إعادة المحاولة" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to retry automation");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/automation/retry-bulk — إعادة المحاولة لمجموعة تقارير دفعة واحدة
// Body: { ids: number[] }
router.post("/automation/retry-bulk", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids مطلوب ويجب أن يكون مصفوفة غير فارغة" });
      return;
    }

    const results: { id: number; status: string; message: string }[] = [];

    for (const rawId of ids) {
      const reportId = parseInt(String(rawId), 10);
      if (isNaN(reportId)) {
        results.push({ id: rawId, status: "error", message: "ID غير صالح" });
        continue;
      }

      try {
        const report = await getReportById(reportId);
        if (!report) {
          results.push({ id: reportId, status: "error", message: "التقرير غير موجود" });
          continue;
        }

        // كل التقارير تذهب للطابور — processQueue ستشغّل الأول فوراً والباقي بالترتيب
        await updateReport(reportId, { automationStatus: "queued", automationError: null });
        results.push({ id: reportId, status: "queued", message: "أُضيف للطابور" });
      } catch (err: any) {
        results.push({ id: reportId, status: "error", message: err.message });
      }
    }

    const queued  = results.filter(r => r.status === "queued").length;
    const errors  = results.filter(r => r.status === "error").length;

    res.json({
      message: `تم إضافة ${queued} تقرير للطابور — سيُعالَج واحداً بعد الآخر تلقائياً`,
      results,
    });

    // ابدأ معالجة الطابور في الخلفية (بدون await — لا نعيق الـ response)
    processQueue().catch(err =>
      req.log.error({ err }, "processQueue error after retry-bulk")
    );
  } catch (err: any) {
    req.log.error({ err }, "Failed to retry bulk");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// GET /api/automation/queue — عرض الطلبات المعلقة في الطابور
router.get("/automation/queue", async (_req, res) => {
  try {
    const queued = await getReportsByAutomationStatus("queued");
    res.json({ count: queued.length, queue: queued });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
