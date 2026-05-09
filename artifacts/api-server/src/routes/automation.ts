import { Router } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import {
  insertReport,
  getReportById,
  getReportsByAutomationStatus,
  updateReport,
  insertCertifiedReport,
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
let _certifyAutoLoop  = false;    // تحكم في حلقة الانتظار التلقائية

function _certifyLog(msg: string) {
  _certifyState.logs.push(`[${new Date().toISOString()}] ${msg}`);
  console.log(`[CertifyBot] ${msg}`);
}

function getCertifyStatus(): CertifyState {
  return { ..._certifyState, logs: [..._certifyState.logs] };
}

// ── دالة مشتركة: تطبيق فلتر "بإنتظار الاعتماد" بشكل محدد وموثوق ────────────
async function _applyPendingFilter(page: any): Promise<boolean> {
  try {
    await page.waitForSelector("#report-status-filter, [id='report-status-filter']", { timeout: 20000 });
  } catch {
    _certifyLog("⚠️ لم يظهر عنصر الفلتر — المتابعة بدون فلتر");
    return false;
  }

  const tagName: string = await page.evaluate(() => {
    const el = document.querySelector("#report-status-filter, [id='report-status-filter']");
    return el ? el.tagName.toLowerCase() : "not_found";
  });
  _certifyLog(`🔎 نوع عنصر الفلتر: ${tagName}`);

  // ── الحالة 1: <select> عادي ─────────────────────────────────────────────────
  if (tagName === "select") {
    const result: { value: string | null; options: string[] } = await page.evaluate(() => {
      const sel = document.querySelector("#report-status-filter, [id='report-status-filter']") as HTMLSelectElement;
      if (!sel) return { value: null, options: [] };
      const options = Array.from(sel.options).map(o => `[${o.value}] ${o.text.trim()}`);
      for (const opt of Array.from(sel.options)) {
        const n = opt.text.trim().replace(/[أإآا]/g, "ا").replace(/[ةه]/g, "ه").replace(/\s+/g, " ");
        if (n.includes("نتظار") && n.includes("عتماد")) {
          return { value: opt.value, options };
        }
      }
      return { value: null, options };
    });
    _certifyLog(`📋 خيارات الفلتر: ${result.options.join(" | ")}`);
    if (result.value !== null) {
      await page.selectOption("#report-status-filter, [id='report-status-filter']", { value: result.value });
      _certifyLog(`✅ تم تطبيق الفلتر <select> (قيمة: "${result.value}")`);
      return true;
    }
    _certifyLog("⚠️ لم يُعثر على خيار 'بانتظار الاعتماد' داخل <select>");
    return false;
  }

  // ── الحالة 2: Angular mat-select / ng-select ─────────────────────────────────
  try {
    await page.click("#report-status-filter, [id='report-status-filter']", { timeout: 8000 });
    _certifyLog("🖱️ نقر على الفلتر — انتظار ظهور القائمة المنسدلة...");

    // انتظر ظهور الخيارات
    await page.waitForFunction(() => {
      const selectors = ["mat-option", "li[role='option']", "[role='option']", ".ng-option"];
      return selectors.some(s => document.querySelectorAll(s).length > 0);
    }, { timeout: 8000 }).catch(() => {});

    // اطبع كل الخيارات للتشخيص
    const allOpts: string[] = await page.evaluate(() => {
      const out: string[] = [];
      for (const sel of ["mat-option", "li[role='option']", "[role='option']", ".ng-option"]) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const t = (el.textContent || "").trim();
          if (t) out.push(t);
        }
      }
      return out;
    });
    _certifyLog(`📋 خيارات القائمة: ${allOpts.join(" | ") || "لا يوجد"}`);

    // اختر الخيار الصحيح بدقة (يجب أن يحتوي على كلتي الكلمتين)
    const clicked: string | null = await page.evaluate(() => {
      for (const sel of ["mat-option", "li[role='option']", "[role='option']", ".ng-option"]) {
        for (const el of Array.from(document.querySelectorAll(sel))) {
          const txt = (el.textContent || "").trim();
          const n = txt.replace(/[أإآا]/g, "ا").replace(/[ةه]/g, "ه").replace(/\s+/g, " ");
          // يجب أن يحتوي على "نتظار" و"عتماد" معاً — لتجنب الاختيار العشوائي
          if (n.includes("نتظار") && n.includes("عتماد")) {
            (el as HTMLElement).click();
            return txt;
          }
        }
      }
      // أغلق القائمة إن فشل الاختيار
      return null;
    });

    if (clicked) {
      _certifyLog(`✅ تم اختيار: "${clicked}"`);
      return true;
    }

    // أغلق القائمة إن لم يُعثر على الخيار
    await page.keyboard.press("Escape").catch(() => {});
    _certifyLog("⚠️ لم يُعثر على خيار 'بانتظار الاعتماد' في القائمة المنسدلة");
    return false;
  } catch (e: any) {
    _certifyLog(`⚠️ فشل تطبيق فلتر Angular: ${e.message?.slice(0, 80)}`);
    return false;
  }
}

// ── دالة مشتركة: استخراج أرقام التقارير من روابط /report/{رقم} فقط ─────────
// يتجاهل أي رقم آخر في الصفحة (pagination، sector IDs، إلخ)
async function _extractReportNumbers(page: any): Promise<string[]> {
  const numbers: string[] = await page.evaluate(() => {
    const seen = new Set<string>();
    const results: string[] = [];

    // ★ المصدر الوحيد المعتمد: روابط href تحتوي على /report/{رقم}
    // مثال: https://qima.taqeem.gov.sa/report/1724799
    for (const a of Array.from(document.querySelectorAll("a[href]"))) {
      const href = (a as HTMLAnchorElement).href || "";
      // مطابقة /report/ متبوعة برقم 5-10 خانات
      const m = href.match(/\/report\/(\d{5,10})(?:\?|#|\/|$)/);
      if (m && !seen.has(m[1])) {
        seen.add(m[1]);
        results.push(m[1]);
      }
    }
    return results;
  }).catch(() => [] as string[]);

  // سجّل الأرقام المُستخرجة مع مصدرها للتشخيص
  if (numbers.length > 0) {
    _certifyLog(`🔢 أرقام التقارير من روابط /report/: ${numbers.slice(0, 8).join(", ")}${numbers.length > 8 ? `... (${numbers.length} إجمالاً)` : ""}`);
  } else {
    _certifyLog("⚠️ لم يُعثر على روابط /report/{رقم} — قد يكون الفلتر لم ينطبق أو الصفحة فارغة");
  }
  return numbers;
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

    // ── تطبيق فلتر "بإنتظار الاعتماد" بشكل موثوق ───────────────────────────
    _certifyLog("🔍 تطبيق فلتر 'تقارير بإنتظار الإعتماد'...");
    await _applyPendingFilter(_certifyPage);

    // ── انتظر تحميل خلايا الجدول بعد الفلتر ────────────────────────────────
    _certifyLog("⏳ انتظار ظهور بيانات الجدول المفلتر...");
    try {
      await _certifyPage.waitForFunction(() =>
        Array.from(document.querySelectorAll("td, a")).some(el =>
          /^\d{5,10}$/.test((el.textContent || "").trim())
        ), { timeout: 15000 });
      _certifyLog("✅ ظهرت بيانات الجدول");
    } catch {
      _certifyLog("⚠️ لم تظهر بيانات خلال 15 ثانية — سيُقرأ الجدول على أي حال");
    }

    const numbers: string[] = await _extractReportNumbers(_certifyPage);

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
  // ── Guard: منع الاستدعاء المزدوج (race condition بين polling + approveAndExtract) ──
  if (_certifyExtracting) {
    _certifyLog("⚠️ الاستخراج جارٍ بالفعل — تجاهل الاستدعاء المكرر");
    // انتظر حتى ينتهي الاستدعاء الأول
    let waited = 0;
    while (_certifyExtracting && waited < 60000) {
      await new Promise(r => setTimeout(r, 500));
      waited += 500;
    }
    return { dcNumber: "", finalValue: "", reportNumber: _certifyState.openedReport ?? "", qrBase64: "" };
  }
  _certifyExtracting = true;

  try {
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
    _certifyLog(`📥 تحميل ملف QR مباشرةً (API Request Context): ${qrContentUrl.slice(0, 120)}`);
    try {
      // استخرج الكوكيز من المتصفح لإرسالها مع الطلب
      const browserCookies: Array<{name: string; value: string}> = await page.context().cookies();
      const cookieHeader = browserCookies.map(c => `${c.name}=${c.value}`).join("; ");

      // استخدم https مباشرةً مع rejectUnauthorized: false (تجاوز SSL)
      // لأن page.context().request لا يتجاوز TLS errors على Windows
      const httpsM = require("https") as typeof import("https");
      const { URL: URLClass } = require("url") as typeof import("url");

      const fetchWithRedirects = (targetUrl: string, depth = 0): Promise<{ statusCode: number; contentType: string; body: Buffer }> =>
        new Promise((resolve, reject) => {
          if (depth > 10) return reject(new Error("Too many redirects"));
          const parsed = new URLClass(targetUrl);
          const opts = {
            hostname: parsed.hostname,
            port: parsed.port || 443,
            path: parsed.pathname + parsed.search,
            method: "GET",
            rejectUnauthorized: false, // تجاوز SSL validation
            headers: {
              Cookie: cookieHeader,
              "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
              Accept: "application/pdf,*/*",
            },
          };
          const req = httpsM.request(opts, (res: any) => {
            // اتبع الـ redirects
            if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
              const loc = res.headers.location as string;
              const next = loc.startsWith("http") ? loc : `${parsed.protocol}//${parsed.host}${loc}`;
              _certifyLog(`↩️ Redirect ${res.statusCode} → ${next.slice(0, 80)}`);
              res.resume();
              resolve(fetchWithRedirects(next, depth + 1));
              return;
            }
            const chunks: Buffer[] = [];
            res.on("data", (c: Buffer) => chunks.push(c));
            res.on("end", () => resolve({
              statusCode: res.statusCode,
              contentType: (res.headers["content-type"] || "").toLowerCase(),
              body: Buffer.concat(chunks),
            }));
            res.on("error", reject);
          });
          req.on("error", reject);
          req.end();
        });

      _certifyLog("🌐 تحميل ملف QR بـ HTTPS مباشرةً (مع كوكيز المتصفح)...");
      const result = await fetchWithRedirects(qrContentUrl);
      const { statusCode, contentType, body: bodyBuf } = result;

      _certifyLog(`📄 Status: ${statusCode} | Content-Type: ${contentType} | حجم: ${Math.round(bodyBuf.length / 1024)} KB`);

      const magic = bodyBuf.slice(0, 4).toString("ascii");
      _certifyLog(`🔍 File magic: ${JSON.stringify(magic)}`);

      if (magic === "%PDF") {
        // ── PDF حقيقي ──
        certBuffer = bodyBuf;
        certFilename = `certificate_${reportNumber}_qr.pdf`;
        certMime = "application/pdf";
        _certifyLog(`✅ PDF حقيقي محمَّل: ${certFilename} (${Math.round(certBuffer.length / 1024)} KB)`);

      } else if (contentType.includes("text/html") || magic.startsWith("<")) {
        // ── HTML — افتح في تاب وحوّل بـ CDP ──
        _certifyLog("🌐 الاستجابة HTML — فتح في تاب وتحويل لـ PDF...");
        let qrPage: any = null;
        try {
          qrPage = await page.context().newPage();
          await qrPage.goto(qrContentUrl, { waitUntil: "networkidle", timeout: 30000 });
          await qrPage.waitForTimeout(3000);
          const cdp = await qrPage.context().newCDPSession(qrPage);
          const pdfResult: { data: string } = await cdp.send("Page.printToPDF", {
            landscape: false, printBackground: true, preferCSSPageSize: true,
            paperWidth: 8.27, paperHeight: 11.69,
            marginTop: 0.3, marginBottom: 0.3, marginLeft: 0.3, marginRight: 0.3,
          });
          await cdp.detach().catch(() => {});
          certBuffer = Buffer.from(pdfResult.data, "base64");
          certFilename = `certificate_${reportNumber}_qr.pdf`;
          certMime = "application/pdf";
          _certifyLog(`✅ PDF من HTML: ${certFilename} (${Math.round(certBuffer.length / 1024)} KB)`);
        } finally {
          if (qrPage) { try { await qrPage.close(); } catch {} }
        }

      } else {
        _certifyLog(`⚠️ نوع ملف غير معروف (magic: ${JSON.stringify(magic)}) — سيُرسل كما هو`);
        certBuffer = bodyBuf;
        certFilename = `certificate_${reportNumber}_qr.bin`;
        certMime = contentType || "application/octet-stream";
      }

    } catch (e: any) {
      _certifyLog(`⚠️ خطأ في تحميل ملف QR: ${e.message?.slice(0, 200)}`);
    }
  } else {
    _certifyLog("⚠️ لم يُعثر على URL في QR — لا يمكن تحميل الملف");
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

    // اجمع كامل الـ multipart body أولاً لحساب Content-Length الصحيح
    // (ASP.NET يحتاج Content-Length لقراءة IFormFile بشكل سليم)
    // نستخدم pipe() لأن fd.on("data") قد لا يُطلق stream تلقائياً
    const fdBuffer = await new Promise<Buffer>((resolve, reject) => {
      const { PassThrough } = require("stream") as typeof import("stream");
      const chunks: Buffer[] = [];
      const pt = new PassThrough();
      pt.on("data",  (c: Buffer) => chunks.push(c));
      pt.on("end",   ()          => resolve(Buffer.concat(chunks)));
      pt.on("error", reject);
      fd.pipe(pt);
    });

    _certifyLog(`📦 حجم الطلب الكامل: ${Math.round(fdBuffer.length / 1024)} KB`);

    let _apiSuccess = false;
    await new Promise<void>((resolve) => {
      const reqOpts = {
        hostname: "localhost",
        port: 5000,
        path: "/External/QrInformationApi",
        method: "POST",
        headers: {
          ...fd.getHeaders(),
          "Content-Length": fdBuffer.length,  // ضروري لـ ASP.NET IFormFile
        },
      };
      const req = http.request(reqOpts, (res: any) => {
        let body = "";
        res.on("data", (chunk: any) => { body += chunk; });
        res.on("end", () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            _certifyLog(`✅ QrInformationApi: ${res.statusCode} — ${body.slice(0, 200)}`);
            try { if (JSON.parse(body).success === true) _apiSuccess = true; } catch {}
          } else {
            _certifyLog(`⚠️ QrInformationApi: ${res.statusCode} — ${body.slice(0, 400)}`);
          }
          resolve();
        });
      });
      req.on("error", (err: any) => {
        _certifyLog(`❌ QrInformationApi فشل: ${err.message?.slice(0, 120)}`);
        resolve();
      });
      req.write(fdBuffer);
      req.end();
    });

    // ── حفظ السجل في جدول التقارير المعمدة ─────────────────────────────────
    if (_apiSuccess) {
      const certifiedAt = new Date().toISOString();
      insertCertifiedReport({
        reportCode:         extracted.dcNumber  || reportNumber || "",
        taqeemReportNumber: reportNumber        || "",
        certifiedAt,
      }).then(() => {
        _certifyLog(`💾 تم حفظ التقرير ${extracted.dcNumber || reportNumber} في سجل التقارير المعمدة`);
      }).catch((e: any) => {
        _certifyLog(`⚠️ فشل حفظ السجل: ${e?.message ?? e}`);
      });
    }

    // ── إذا نجح الإرسال انتقل للتقرير التالي تلقائياً ──────────────────────
    if (_apiSuccess) {
      _certifyLog("🔄 نجح الإرسال — إغلاق تاب التقرير والانتقال للتالي...");
      // setTimeout لكسر سلسلة الاستدعاءات وتجنب التعشيش العميق
      setTimeout(async () => {
        try {
          // ── انقل تاب التقرير لصفحة فارغة (يبدو للمستخدم أنه أُغلق بصرياً)
          // openCertifyReport ستغلقه فعلياً حين تفتح التالي — تجنباً لخطأ "page closed"
          if (_certifyReportPage) {
            try {
              await _certifyReportPage.goto("about:blank", { timeout: 5000 });
              _certifyLog("🔒 تم مسح تاب التقرير المنتهي");
            } catch {}
          }

          const next = await nextCertifyReport();
          if (!next) {
            // لا توجد تقارير إضافية — أغلق تاب التقرير ثم ابدأ حلقة الانتظار
            if (_certifyReportPage) {
              try { await _certifyReportPage.close(); } catch {}
              _certifyReportPage = null;
              _certifyLog("🔒 تم إغلاق تاب التقرير (لا توجد تقارير إضافية)");
            }
            _autoRefreshLoop().catch(e =>
              _certifyLog(`❌ خطأ في حلقة التحديث: ${e.message}`)
            );
            return;
          }
          // nextCertifyReport → openCertifyReport أغلقت القديم وفتحت الجديد بأمان
          _certifyLog(`📂 تقرير ${next.reportNumber} (${next.index} من ${next.total}) — انتظار تحميل الصفحة...`);
          await new Promise(r => setTimeout(r, 3000));
          await _approveAndExtract();
        } catch (e: any) {
          _certifyLog(`❌ خطأ في الانتقال للتقرير التالي: ${e.message}`);
        }
      }, 1000);
    }
  } catch (e: any) {
    _certifyLog(`❌ QrInformationApi خطأ عام: ${e.message?.slice(0, 120)}`);
  }

  return { dcNumber: extracted.dcNumber, finalValue: extracted.finalValue, reportNumber, qrBase64 };

  } finally {
    // أطلق القفل دائماً عند الانتهاء
    _certifyExtracting = false;
  }
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
          _certifyLog(`🎯 QR مكتشف على: ${result.url} — جارٍ الاستخراج...`);
          try {
            await _doExtractAndSend(page);
            _certifyLog("✅ اكتمل الاستخراج والإرسال التلقائي");
          } catch (e: any) {
            _certifyLog(`❌ خطأ في الاستخراج: ${e.message}`);
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

// ── يجلب أرقام التقارير المعلقة مجدداً دون إعادة بناء المتصفح ───────────────
async function _refreshPendingList(): Promise<string[]> {
  if (!_certifyPage) return [];
  _certifyLog("🔄 إعادة تحميل قائمة التقارير بإنتظار الاعتماد...");
  await _certifyPage.goto(CERTIFY_REPORTS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
  await _certifyPage.waitForTimeout(2000);

  // تطبيق الفلتر بالدالة المشتركة (محدد وموثوق — لا عشوائية)
  _certifyLog("🔍 تطبيق فلتر 'بإنتظار الاعتماد'...");
  await _applyPendingFilter(_certifyPage);

  // انتظر تحميل الجدول
  try {
    await _certifyPage.waitForFunction(() =>
      Array.from(document.querySelectorAll("td, a")).some(el =>
        /^\d{5,10}$/.test((el.textContent || "").trim())
      ), { timeout: 12000 });
  } catch {}

  // استخرج الأرقام بالدالة المشتركة
  const numbers = await _extractReportNumbers(_certifyPage);
  _certifyLog(`📊 وُجد ${numbers.length} تقرير: ${numbers.slice(0, 5).join(", ")}${numbers.length > 5 ? "..." : ""}`);
  return numbers;
}

// ── حلقة التحديث التلقائي: تُعيد تحميل الصفحة الرئيسية فور اكتمال التقارير ──
async function _autoRefreshLoop(): Promise<void> {
  _certifyAutoLoop = true;
  while (_certifyAutoLoop) {
    _certifyLog("🔄 اكتملت تقارير الشاشة الحالية — تحديث الصفحة الرئيسية...");

    // انتظر 15 ثانية قصيرة قبل إعادة التحميل (تجنب الضغط المتكرر)
    await new Promise(r => setTimeout(r, 15000));
    if (!_certifyAutoLoop) break;

    try {
      // أعد تحميل صفحة القائمة وطبّق الفلتر واستخرج التقارير الظاهرة
      const numbers = await _refreshPendingList();

      if (numbers.length === 0) {
        _certifyLog("⚠️ لا توجد تقارير بانتظار الاعتماد — إعادة المحاولة بعد 30 ثانية...");
        // انتظر 30 ثانية إضافية إن كانت القائمة فارغة
        await new Promise(r => setTimeout(r, 30000));
        continue;
      }

      _certifyLog(`✅ وُجد ${numbers.length} تقرير جديد على الشاشة — بدء الاعتماد...`);
      _certifyState.reportNumbers = numbers;
      _certifyState.currentIndex = 0;
      await openCertifyReport(numbers[0]);
      _certifyState.status = "approving";
      await _approveAndExtract();
      // عند انتهاء هذه الدفعة ستُطلق _autoRefreshLoop من جديد تلقائياً
      break;
    } catch (e: any) {
      _certifyLog(`❌ خطأ في التحديث التلقائي: ${e.message}`);
      await new Promise(r => setTimeout(r, 15000)); // انتظر قبل إعادة المحاولة
    }
  }
  if (!_certifyAutoLoop) _certifyLog("🛑 توقفت حلقة التحديث التلقائي");
}

async function stopCertifySession(): Promise<void> {
  _certifyAutoLoop = false; // أوقف حلقة الانتظار
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
