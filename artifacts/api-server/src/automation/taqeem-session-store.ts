import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";

function getChromiumExecutable(): string | undefined {
  if (process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH) {
    return process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH;
  }
  try {
    const p = execSync("which chromium 2>/dev/null || which chromium-browser 2>/dev/null || which google-chrome 2>/dev/null", { encoding: "utf-8" }).trim();
    if (p) return p;
  } catch {}
  return undefined;
}

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

  const chromiumExec = getChromiumExecutable();
  // على Replit: headless=true، على الجهاز المحلي: headless=false (لرؤية المتصفح)
  const isReplit = !!process.env.REPL_ID || !!process.env.REPLIT_ID;
  const headlessMode = isReplit ? true : false;

  // محاولة استخدام Chrome الحقيقي أولاً (يتجاوز Cloudflare أفضل من Chromium)
  let browser: import("playwright").Browser | null = null;
  if (!isReplit) {
    try {
      browser = await chromium.launch({
        headless: false,
        channel: "chrome",
        slowMo: 150,
        args: [
          "--disable-blink-features=AutomationControlled",
          "--no-first-run",
          "--no-default-browser-check",
        ],
      });
      console.log("[TaqeemLogin] Using real Chrome channel");
    } catch (e) {
      console.log(`[TaqeemLogin] Chrome channel not available: ${e} — falling back`);
      browser = null;
    }
  }

  if (!browser) {
    const chromiumArgs = isReplit
      ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
      : ["--disable-blink-features=AutomationControlled", "--no-first-run", "--no-default-browser-check"];
    browser = await chromium.launch({
      headless: headlessMode,
      slowMo: headlessMode ? 0 : 150,
      args: chromiumArgs,
      ...(chromiumExec ? { executablePath: chromiumExec } : {}),
    });
    console.log(`[TaqeemLogin] Using Chromium: ${chromiumExec ?? "playwright-default"} | headless: ${headlessMode}`);
  }

  const storageState = fs.existsSync(STORAGE_STATE_FILE)
    ? (STORAGE_STATE_FILE as any)
    : undefined;

  const context = await browser.newContext({
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1280, height: 900 },
    // لا نضع userAgent مزيف مع Chrome الحقيقي — Cloudflare يكتشفه
    ...(isReplit ? {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    } : {}),
    ...(storageState ? { storageState } : {}),
  });

  // إخفاء علامات الأتمتة من الـ JavaScript
  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    (window as any).chrome = { runtime: {} };
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
  const SSO_HOST = "sso.taqeem.gov.sa";
  const page = await flow.context.newPage();

  try {
    addFlowLog("الانتقال إلى صفحة تسجيل الدخول...");

    try {
      await page.goto(`${TAQEEM_URL}/membership/login`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (navErr: any) {
      addFlowLog(`❌ فشل الانتقال للموقع: ${navErr.message}`);
      throw new Error(
        `لا يمكن الوصول إلى ${TAQEEM_URL} — تأكد من اتصالك بالإنترنت وأن الموقع متاح من جهازك. ` +
        `(ملاحظة: الأتمتة يجب أن تشتغل من جهازك المحلي، وليس من Replit)`
      );
    }

    await page.waitForTimeout(2000);

    const currentUrlAfterNav = page.url();
    addFlowLog(`الصفحة الحالية: ${currentUrlAfterNav}`);

    // تحقق سريع إذا كانت الصفحة فارغة أو تحتوي على خطأ شبكة
    if (currentUrlAfterNav === "about:blank" || currentUrlAfterNav === `${TAQEEM_URL}/membership/login`) {
      const bodyText = await page.innerText("body").catch(() => "");
      addFlowLog(`محتوى الصفحة (أول 200 حرف): ${bodyText.slice(0, 200)}`);
    }

    // إذا لم نصل إلى SSO ولم نبقَ في /login — نحن مسجلون مسبقاً
    const currentUrl = page.url();
    if (!currentUrl.includes(SSO_HOST) && !currentUrl.includes("/login")) {
      addFlowLog("تم استعادة الجلسة السابقة — لا حاجة لإعادة تسجيل الدخول.");
      await page.close();
      flow.status = "authenticated";
      flow.loggedInAt = new Date();
      await flow.context.storageState({ path: STORAGE_STATE_FILE });
      saveMeta(username);
      setSharedContext(flow.browser, flow.context);
      return;
    }

    // ─── إدخال بيانات الدخول على Keycloak ───────────────────────────
    addFlowLog("إدخال بيانات الدخول على Keycloak SSO...");

    // انتظار تحميل الصفحة بالكامل
    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const pageTitle = await page.title().catch(() => "غير معروف");
    addFlowLog(`عنوان الصفحة: ${pageTitle}`);

    // حفظ لقطة شاشة للتشخيص
    try {
      await page.screenshot({ path: "uploads/login-debug.png" });
      addFlowLog("تم حفظ لقطة الشاشة في uploads/login-debug.png");
    } catch {}

    // محاولة إيجاد حقل المستخدم بعدة محددات
    const usernameSelectors = [
      '#username',
      'input[name="username"]',
      'input[type="text"]',
      'input[autocomplete="username"]',
      'input[id*="user" i]',
      'input[name*="user" i]',
      'input[placeholder*="اسم" i]',
      'input[placeholder*="user" i]',
    ];

    let usernameField = null;
    for (const sel of usernameSelectors) {
      try {
        await page.waitForSelector(sel, { timeout: 5000 });
        usernameField = sel;
        addFlowLog(`تم العثور على حقل المستخدم: ${sel}`);
        break;
      } catch {}
    }

    if (!usernameField) {
      const allInputs = await page.$$eval('input', els => els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder })));
      addFlowLog(`❌ الحقول المتاحة في الصفحة: ${JSON.stringify(allInputs)}`);
      throw new Error("لم يتم العثور على حقل اسم المستخدم في صفحة تسجيل الدخول");
    }

    await page.fill(usernameField, username);
    await page.fill('#password, input[name="password"], input[type="password"]', password);

    addFlowLog("النقر على زر تسجيل الدخول...");
    await page.click('#kc-login, input[type="submit"], button[type="submit"]');

    // انتظار حتى تستقر الصفحة بعد الانتقالات المتسلسلة (Keycloak → callback → TAQEEM)
    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    // انتظار إضافي لاستقرار الـ redirects
    let stableUrl = page.url();
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(1000);
      const newUrl = page.url();
      if (newUrl === stableUrl) break;
      stableUrl = newUrl;
    }

    addFlowLog(`بعد تسجيل الدخول — الصفحة: ${stableUrl}`);

    // ─── التحقق من صفحة OTP أو اختيار الطريقة ──────────────────────
    // التحقق بالـ hostname وليس الـ URL كاملاً (لتفادي الـ iss parameter المشفّر)
    let afterLoginHostname = "";
    try { afterLoginHostname = new URL(stableUrl).hostname; } catch {}
    const isOnSSOHost = afterLoginHostname === SSO_HOST;
    const isOnOtpPage = isOnSSOHost && /otp|verify|تحقق|confirm|channel|method|authenticate|login-actions/i.test(stableUrl);

    if (isOnSSOHost) {
      addFlowLog("ظهرت صفحة التحقق الثنائي...");
      flow.status = "waiting_otp";

      // ─── اختيار البريد الإلكتروني إذا ظهرت صفحة الاختيار ──────────
      const emailSelectors = [
        'input[type="radio"][value*="email" i]',
        'input[type="radio"][value*="mail" i]',
        'label:has-text("البريد الإلكتروني") input[type="radio"]',
        'label:has-text("email" i) input[type="radio"]',
        'li:has-text("البريد الإلكتروني")',
        'div:has-text("البريد الإلكتروني") input',
        'button:has-text("البريد الإلكتروني")',
        'button:has-text("Email" i)',
        '[data-value*="email" i]',
        'a:has-text("البريد الإلكتروني")',
        'a:has-text("email" i)',
      ];

      let selectedEmail = false;
      for (const sel of emailSelectors) {
        try {
          const el = await page.$(sel);
          if (el) {
            await el.click();
            selectedEmail = true;
            addFlowLog("تم اختيار البريد الإلكتروني لاستقبال OTP ✅");
            await page.waitForTimeout(1000);
            break;
          }
        } catch {}
      }

      if (selectedEmail) {
        try {
          await page.click(
            'input[type="submit"], button[type="submit"], button:has-text("تأكيد"), button:has-text("التالي"), button:has-text("إرسال"), button:has-text("Continue")',
            { timeout: 5000 }
          );
          addFlowLog("تم النقر على زر إرسال OTP...");
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        } catch {}
      } else {
        addFlowLog("لم يتم العثور على خيار البريد الإلكتروني — المتابعة مباشرة لإدخال OTP...");
      }

      addFlowLog("في انتظار إدخال رمز OTP من البريد الإلكتروني...");
    } else {
      // لا يوجد OTP — تسجيل الدخول مكتمل مباشرة
      addFlowLog("تسجيل الدخول اكتمل بدون OTP ✅");
      await page.close();
      flow.status = "authenticated";
      flow.loggedInAt = new Date();
      await flow.context.storageState({ path: STORAGE_STATE_FILE });
      saveMeta(username);
      setSharedContext(flow.browser, flow.context);
      import("./queue-processor").then(({ processQueue }) => {
        processQueue().catch((err) => console.error("[TaqeemLogin] خطأ في معالج الطابور:", err));
      });
      return;
    }

    // ─── انتظار إدخال OTP ────────────────────────────────────────────
    const otp = await new Promise<string>((resolve) => {
      flow.otpResolver = resolve;
    });

    addFlowLog("تم استلام OTP — جارٍ إدخاله...");
    flow.status = "logging_in";

    // تحقق إذا كانت الصفحة لا تزال على SSO أم انتقلت للرئيسية بالفعل
    const currentPageUrl = page.url();
    let currentHostname = "";
    try { currentHostname = new URL(currentPageUrl).hostname; } catch {}
    addFlowLog(`الصفحة عند إدخال OTP: ${currentPageUrl}`);

    if (currentHostname !== SSO_HOST) {
      // الصفحة انتقلت للرئيسية — تسجيل الدخول مكتمل بدون حاجة لإدخال OTP
      addFlowLog("الصفحة انتقلت للرئيسية — تسجيل الدخول مكتمل ✅");
    } else {
      // لا تزال على SSO — أدخل الـ OTP
      const otpSelector = 'input[name="otp"], input[id="otp"], input[autocomplete="one-time-code"], input[maxlength="6"], input[type="number"], input[type="text"]';
      await page.waitForSelector(otpSelector, { timeout: 10000 });
      await page.fill(otpSelector, otp);
      await page.click('#kc-login, input[type="submit"], button[type="submit"]');
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
    }

    addFlowLog("تم تسجيل الدخول بنجاح ✅");
    addFlowLog("جارٍ حفظ الجلسة للاستخدام طوال اليوم...");

    await page.close();
    flow.status = "authenticated";
    flow.loggedInAt = new Date();

    await flow.context.storageState({ path: STORAGE_STATE_FILE });
    saveMeta(username);
    setSharedContext(flow.browser, flow.context);

    addFlowLog("✅ الجلسة محفوظة — يمكنك الآن رفع أي عدد من التقارير بدون إعادة تسجيل الدخول.");

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
    const chromiumExec = getChromiumExecutable();
    const browser = await chromium.launch({
      headless: true,
      args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"],
      ...(chromiumExec ? { executablePath: chromiumExec } : {}),
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
