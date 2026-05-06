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

let _certifyState: CertifyState = { status: "idle", logs: [], reportNumbers: [], currentIndex: 0 };
let _certifyPage: any = null;      // صفحة قائمة التقارير
let _certifyReportPage: any = null; // التاب الثاني للتقرير المفتوح
let _certifyCleanup: (() => Promise<void>) | null = null;

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

    // ── انتظر 30 ثانية ليكتمل تحميل الصفحة ──────────────────────────────────
    _certifyLog("⏳ انتظار 30 ثانية لاكتمال تحميل الصفحة...");
    for (let i = 30; i > 0; i--) {
      _certifyLog(`⏳ ${i} ثانية...`);
      await _certifyPage.waitForTimeout(1000);
    }
    _certifyLog(`📄 الصفحة: ${_certifyPage.url()}`);

    // ── اختر "تقارير بانتظار الاعتماد" من فلتر report-status-filter ─────────
    _certifyLog("🔍 البحث عن عنصر #report-status-filter...");

    // اكتشف نوع العنصر أولاً
    const filterTagName: string = await _certifyPage.evaluate(() => {
      const el = document.querySelector("#report-status-filter, [id='report-status-filter']");
      return el ? el.tagName.toLowerCase() : "not_found";
    });
    _certifyLog(`🔎 نوع عنصر الفلتر: ${filterTagName}`);

    let filterDone = false;

    // دالة مطابقة مرنة تتجاهل اختلاف الهمزة (إنتظار / انتظار / إعتماد / اعتماد)
    function _matchWaiting(txt: string): boolean {
      // نزيل الهمزات ونحوّل إلى حروف موحدة للمقارنة
      const normalized = txt
        .replace(/[أإآا]/g, "ا")
        .replace(/[ةه]/g, "ه");
      return normalized.includes("نتظار") && normalized.includes("عتماد");
    }

    // ── الحالة 1: <select> عادي ─────────────────────────────────────────────
    if (filterTagName === "select") {
      try {
        // سجّل جميع الخيارات المتاحة أولاً
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
          _certifyLog(`✅ تم اختيار القيمة "${optionValue}" من <select>`);
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
        await _certifyPage.click("#report-status-filter", { timeout: 8000 });
        _certifyLog("✅ نقر على الفلتر (فتح القائمة)");
        await _certifyPage.waitForTimeout(1500);

        // سجّل جميع الخيارات المرئية في الـ overlay
        const allOverlayOpts: string[] = await _certifyPage.evaluate(() => {
          const selectors = ["mat-option", "li[role='option']", "[role='option']", ".ng-option"];
          const found: string[] = [];
          for (const sel of selectors) {
            for (const el of Array.from(document.querySelectorAll(sel))) {
              const t = (el.textContent || "").trim();
              if (t) found.push(t);
            }
          }
          return found;
        });
        if (allOverlayOpts.length > 0) {
          _certifyLog(`📋 خيارات الـ overlay: ${allOverlayOpts.join(" | ")}`);
        }

        // ابحث عن الخيار مع تطبيع الهمزة
        const optClicked: string | null = await _certifyPage.evaluate(() => {
          const selectors = ["mat-option", "li[role='option']", "[role='option']", ".ng-option", ".dropdown-item"];
          for (const sel of selectors) {
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
          _certifyLog("⚠️ لم يُعثر على خيار 'بانتظار الاعتماد' بعد فتح القائمة");
        }
      } catch (e: any) {
        _certifyLog(`⚠️ فشل النقر على الفلتر: ${e.message}`);
      }
    }

    await _certifyPage.waitForTimeout(1000);

    // ── انتظر ظهور التقارير في الجدول ────────────────────────────────────────
    _certifyLog("⏳ انتظار ظهور التقارير في الجدول...");
    try {
      await _certifyPage.waitForFunction(() => {
        const cells = document.querySelectorAll("td, .mat-cell");
        for (const cell of Array.from(cells)) {
          if (/^\d{6,8}$/.test((cell.textContent || "").trim())) return true;
        }
        const links = document.querySelectorAll("table a, td a");
        for (const link of Array.from(links)) {
          if (/^\d{6,8}$/.test((link.textContent || "").trim())) return true;
        }
        return false;
      }, { timeout: 30000 });
      _certifyLog("✅ ظهرت التقارير في الجدول");
    } catch {
      _certifyLog("⚠️ انتهى وقت الانتظار — سيُحاوَل قراءة الجدول على أي حال");
    }

    // ── استخرج أرقام التقارير من الجدول المُفلتر ─────────────────────────────
    _certifyLog("📋 قراءة أرقام التقارير من الجدول...");
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
    _certifyState.currentIndex = 0;

    if (numbers.length > 0) {
      _certifyLog(`✅ وُجد ${numbers.length} تقرير بانتظار الاعتماد: ${numbers.slice(0, 5).join(", ")}${numbers.length > 5 ? "..." : ""}`);

      // ── تاب (2): افتح أول تقرير في تاب منفصل (استعراض فقط) ───────────────
      const firstNumber = numbers[0];
      const firstUrl = `${CERTIFY_REPORT_BASE}/${firstNumber}?office=${CERTIFY_OFFICE}`;
      _certifyLog(`🔗 فتح التقرير ${firstNumber} في تاب ثانٍ...`);
      _certifyReportPage = await context.newPage();
      await _certifyReportPage.goto(firstUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
      _certifyState.openedReport = firstNumber;
      _certifyLog(`✅ تم فتح التقرير ${firstNumber} (1 من ${numbers.length}) في تاب منفصل`);
      // حدّد checkbox الموافقة على السياسات تلقائياً
      await _checkPolicyCheckbox(_certifyReportPage);
    } else {
      _certifyLog("⚠️ لم يُعثر على تقارير بانتظار الاعتماد في الجدول — ربما الصفحة فارغة أو الفلتر لم ينطبق");
    }

    _certifyState.status = "ready";
    _certifyLog("✅ جاهز — التاب الأول: قائمة التقارير | التاب الثاني: التقرير المفتوح");

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
    // انتظر قليلاً لتحميل الصفحة
    await page.waitForTimeout(2000);

    // ابحث عن checkbox غير محدد بجانب نص "السياسات"
    const checked = await page.evaluate(() => {
      // ابحث عن كل checkbox في الصفحة
      const checkboxes = Array.from(document.querySelectorAll(
        "input[type='checkbox'], mat-checkbox, .mat-checkbox"
      ));
      for (const cb of checkboxes) {
        // تحقق من النص المجاور
        const label = cb.closest("label") ||
                      document.querySelector(`label[for='${(cb as HTMLInputElement).id}']`) ||
                      cb.parentElement;
        const labelText = (label?.textContent || cb.parentElement?.textContent || "").trim();
        if (labelText.includes("أقر بأن") || labelText.includes("المعلومات المدخلة") || labelText.includes("ملخص التقرير صحيحة")) {
          // إذا لم يكن محدداً، انقر عليه
          const isChecked = (cb as HTMLInputElement).checked ||
                            cb.classList.contains("mat-checkbox-checked") ||
                            cb.getAttribute("aria-checked") === "true";
          if (!isChecked) {
            (cb as HTMLElement).click();
            return `clicked:${labelText.substring(0, 50)}`;
          }
          return `already_checked:${labelText.substring(0, 50)}`;
        }
      }
      // آخر محاولة: ابحث عن label يحتوي على النص ثم انقر عليه
      const labels = Array.from(document.querySelectorAll("label, .checkbox-label, span"));
      for (const lbl of labels) {
        const txt = (lbl.textContent || "").trim();
        if (txt.includes("أقر بأن") || txt.includes("ملخص التقرير صحيحة")) {
          (lbl as HTMLElement).click();
          return `label_clicked:${txt.substring(0, 60)}`;
        }
      }
      return null;
    });

    if (checked) {
      _certifyLog(`☑️ Checkbox الموافقة: ${checked}`);
    } else {
      _certifyLog("⚠️ لم يُعثر على checkbox الموافقة على السياسات");
    }
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

// POST /api/automation/certify/start
router.post("/automation/certify/start", async (_req, res) => {
  try {
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
