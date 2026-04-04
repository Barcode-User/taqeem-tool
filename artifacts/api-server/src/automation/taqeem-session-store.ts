import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
const STORAGE_STATE_FILE = path.join(UPLOADS_DIR, "taqeem-session.json");
const SESSION_META_FILE = path.join(UPLOADS_DIR, "taqeem-session.meta.json");
const SESSION_MAX_AGE_MS = 10 * 60 * 60 * 1000; // 10 hours

if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

export type LoginStatus =
  | "not_logged_in"
  | "logging_in"
  | "waiting_otp"
  | "authenticated"
  | "failed";

type SessionMeta = {
  loggedInAt: string;
  username: string;
};

type ActiveLoginFlow = {
  loginId: string;
  browser: Browser;
  context: BrowserContext;
  status: LoginStatus;
  username: string;
  error?: string;
  otpResolver: ((otp: string) => void) | null;
  logs: string[];
  loggedInAt?: Date;
};

let activeFlow: ActiveLoginFlow | null = null;
let sharedBrowser: Browser | null = null;
let sharedContext: BrowserContext | null = null;

function loadMeta(): SessionMeta | null {
  try {
    if (fs.existsSync(SESSION_META_FILE) && fs.existsSync(STORAGE_STATE_FILE)) {
      const meta: SessionMeta = JSON.parse(fs.readFileSync(SESSION_META_FILE, "utf-8"));
      const age = Date.now() - new Date(meta.loggedInAt).getTime();
      if (age < SESSION_MAX_AGE_MS) return meta;
      clearSavedState();
    }
  } catch {}
  return null;
}

function saveMeta(username: string) {
  const meta: SessionMeta = { loggedInAt: new Date().toISOString(), username };
  fs.writeFileSync(SESSION_META_FILE, JSON.stringify(meta), "utf-8");
}

function clearSavedState() {
  try { fs.unlinkSync(STORAGE_STATE_FILE); } catch {}
  try { fs.unlinkSync(SESSION_META_FILE); } catch {}
}

function addFlowLog(msg: string) {
  if (!activeFlow) return;
  activeFlow.logs.push(`[${new Date().toISOString()}] ${msg}`);
  console.log(`[TaqeemLogin] ${msg}`);
}

export function getLoginStatus(): {
  status: LoginStatus;
  username?: string;
  loggedInAt?: string;
  loginId?: string;
  logs: string[];
  error?: string;
  sessionExpiresAt?: string;
} {
  if (activeFlow) {
    return {
      status: activeFlow.status,
      username: activeFlow.username,
      loggedInAt: activeFlow.loggedInAt?.toISOString(),
      loginId: activeFlow.loginId,
      logs: [...activeFlow.logs],
      error: activeFlow.error,
    };
  }
  const meta = loadMeta();
  if (meta) {
    const expiresAt = new Date(new Date(meta.loggedInAt).getTime() + SESSION_MAX_AGE_MS);
    return {
      status: "authenticated",
      username: meta.username,
      loggedInAt: meta.loggedInAt,
      sessionExpiresAt: expiresAt.toISOString(),
      logs: [],
    };
  }
  return { status: "not_logged_in", logs: [] };
}

export async function startLogin(username: string, password: string): Promise<string> {
  if (activeFlow?.browser) {
    try { await activeFlow.browser.close(); } catch {}
  }
  activeFlow = null;

  const loginId = randomUUID();

  const browser = await chromium.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
  });

  const storageState = fs.existsSync(STORAGE_STATE_FILE)
    ? (STORAGE_STATE_FILE as any)
    : undefined;

  const context = await browser.newContext({
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1280, height: 900 },
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ...(storageState ? { storageState } : {}),
  });

  activeFlow = {
    loginId,
    browser,
    context,
    status: "logging_in",
    username,
    otpResolver: null,
    logs: [],
  };

  runLoginFlow(activeFlow, username, password).catch((err) => {
    if (activeFlow?.loginId === loginId) {
      activeFlow.status = "failed";
      activeFlow.error = err.message;
      addFlowLog(`❌ فشل: ${err.message}`);
    }
  });

  return loginId;
}

async function runLoginFlow(flow: ActiveLoginFlow, username: string, password: string) {
  const TAQEEM_URL = "https://qima.taqeem.gov.sa";
  const page = await flow.context.newPage();

  try {
    addFlowLog("الانتقال إلى صفحة تسجيل الدخول...");

    // ⚠️ TODO: Update URL if needed
    await page.goto(`${TAQEEM_URL}/membership/login`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });

    // Check if already logged in (session restored from storage state)
    if (!page.url().includes("/login")) {
      addFlowLog("تم استعادة الجلسة السابقة — لا حاجة لإعادة تسجيل الدخول.");
      await page.close();
      flow.status = "authenticated";
      flow.loggedInAt = new Date();
      await flow.context.storageState({ path: STORAGE_STATE_FILE });
      saveMeta(username);
      setSharedContext(flow.browser, flow.context);
      return;
    }

    addFlowLog("إدخال بيانات الدخول...");
    // ⚠️ TODO: تحديث محددات حقول اسم المستخدم وكلمة المرور
    await page.fill('input[name="username"], input[type="text"]:first-of-type', username);
    await page.fill('input[name="password"], input[type="password"]', password);
    await page.click('button[type="submit"], input[type="submit"]');

    addFlowLog("انتظار صفحة التحقق برمز OTP...");
    flow.status = "waiting_otp";

    // ⚠️ TODO: تحديث انتظار صفحة OTP
    await page.waitForURL(/otp|verify|تحقق/, { timeout: 15000 }).catch(() => {});

    const otp = await new Promise<string>((resolve) => {
      flow.otpResolver = resolve;
    });

    addFlowLog("تم استلام OTP — جارٍ إدخاله...");
    flow.status = "logging_in";

    // ⚠️ TODO: تحديث محدد حقل OTP
    await page.fill('input[name="otp"], input[placeholder*="رمز"], input[maxlength="6"]', otp);
    await page.click('button[type="submit"], input[type="submit"]');
    await page.waitForNavigation({ waitUntil: "networkidle", timeout: 30000 });

    addFlowLog("تم تسجيل الدخول بنجاح ✅");
    addFlowLog("جارٍ حفظ الجلسة للاستخدام طوال اليوم...");

    await page.close();
    flow.status = "authenticated";
    flow.loggedInAt = new Date();

    // Save session cookies/storage to disk
    await flow.context.storageState({ path: STORAGE_STATE_FILE });
    saveMeta(username);

    // Keep context alive for reuse
    setSharedContext(flow.browser, flow.context);

    addFlowLog("✅ الجلسة محفوظة — يمكنك الآن رفع أي عدد من التقارير بدون إعادة تسجيل الدخول.");

    // تشغيل معالج الطابور في الخلفية
    import("./queue-processor").then(({ processQueue }) => {
      processQueue().catch((err) =>
        console.error("[TaqeemLogin] خطأ في معالج الطابور:", err)
      );
    });
  } catch (err: any) {
    try { await page.close(); } catch {}
    throw err;
  }
}

function setSharedContext(browser: Browser, context: BrowserContext) {
  sharedBrowser = browser;
  sharedContext = context;
}

export function submitLoginOtp(loginId: string, otp: string): boolean {
  if (!activeFlow || activeFlow.loginId !== loginId) return false;
  if (!activeFlow.otpResolver) return false;
  activeFlow.otpResolver(otp);
  activeFlow.otpResolver = null;
  return true;
}

export async function getAuthenticatedContext(): Promise<BrowserContext | null> {
  // 1. Use in-memory shared context if available
  if (sharedContext) {
    try {
      // Quick health check — try creating a page and closing it
      // (skipped for performance; rely on navigation errors instead)
      return sharedContext;
    } catch {
      sharedContext = null;
    }
  }

  // 2. Try restoring from saved state file
  const meta = loadMeta();
  if (meta && fs.existsSync(STORAGE_STATE_FILE)) {
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    });

    const context = await browser.newContext({
      locale: "ar-SA",
      timezoneId: "Asia/Riyadh",
      viewport: { width: 1280, height: 900 },
      storageState: STORAGE_STATE_FILE as any,
      userAgent:
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    });

    setSharedContext(browser, context);

    // Restore flow metadata so status endpoint reflects logged-in state
    if (!activeFlow) {
      activeFlow = {
        loginId: "restored",
        browser,
        context,
        status: "authenticated",
        username: meta.username,
        otpResolver: null,
        logs: ["تم استعادة الجلسة من الملف المحفوظ."],
        loggedInAt: new Date(meta.loggedInAt),
      };
    }

    return context;
  }

  return null;
}

export async function logout(): Promise<void> {
  if (sharedBrowser) {
    try { await sharedBrowser.close(); } catch {}
  }
  sharedBrowser = null;
  sharedContext = null;
  activeFlow = null;
  clearSavedState();
  console.log("[TaqeemLogin] تم تسجيل الخروج وحذف الجلسة.");
}
