import { chromium } from "playwright";
import type { Browser, BrowserContext } from "playwright";
import { randomUUID } from "crypto";
import * as fs from "fs";
import * as path from "path";
import { execSync } from "child_process";
import { getReportsByAutomationStatus, updateReport } from "@workspace/db";

export type RoleKey = "entry" | "certifier";

/**
 * تُحوّل جميع تقارير "pending" إلى "queued" ثم تُشغّل معالج الطابور.
 * تُستدعى فقط بعد تسجيل دخول ناجح لدور "مدخل البيانات".
 */
async function queuePendingAndProcess(): Promise<void> {
  try {
    const { processQueue } = await import("./queue-processor.js");
    const pendingReports = await getReportsByAutomationStatus("pending");
    if (pendingReports.length > 0) {
      console.log(`[TaqeemLogin] 🔄 وجدت ${pendingReports.length} تقرير pending — سيُضاف للطابور`);
      for (const r of pendingReports) {
        await updateReport(r.id, { automationStatus: "queued" });
        console.log(`[TaqeemLogin] ✅ تقرير #${r.id} أُضيف للطابور`);
      }
    }
    processQueue().catch(err => console.error("[TaqeemLogin] خطأ في معالج الطابور:", err));
  } catch (err: any) {
    console.error("[TaqeemLogin] خطأ في queuePendingAndProcess:", err.message);
  }
}

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

// ─── حالة الجلسة لكل دور ─────────────────────────────────────────────────────
type RoleState = {
  activeFlow: ActiveLoginFlow | null;
  sharedBrowser: Browser | null;
  sharedContext: BrowserContext | null;
  storageStateFile: string;
  sessionMetaFile: string;
};

const roleState: Record<RoleKey, RoleState> = {
  entry: {
    activeFlow: null,
    sharedBrowser: null,
    sharedContext: null,
    storageStateFile: path.join(UPLOADS_DIR, "taqeem-session.json"),
    sessionMetaFile: path.join(UPLOADS_DIR, "taqeem-session.meta.json"),
  },
  certifier: {
    activeFlow: null,
    sharedBrowser: null,
    sharedContext: null,
    storageStateFile: path.join(UPLOADS_DIR, "taqeem-session-certifier.json"),
    sessionMetaFile: path.join(UPLOADS_DIR, "taqeem-session-certifier.meta.json"),
  },
};

// ─── دوال مساعدة للملفات ─────────────────────────────────────────────────────

function loadMeta(role: RoleKey): SessionMeta | null {
  const s = roleState[role];
  try {
    if (fs.existsSync(s.sessionMetaFile) && fs.existsSync(s.storageStateFile)) {
      const meta: SessionMeta = JSON.parse(fs.readFileSync(s.sessionMetaFile, "utf-8"));
      const age = Date.now() - new Date(meta.loggedInAt).getTime();
      if (age < SESSION_MAX_AGE_MS) return meta;
      clearSavedState(role);
    }
  } catch {}
  return null;
}

function saveMeta(role: RoleKey, username: string) {
  const s = roleState[role];
  const meta: SessionMeta = { loggedInAt: new Date().toISOString(), username };
  fs.writeFileSync(s.sessionMetaFile, JSON.stringify(meta), "utf-8");
}

function clearSavedState(role: RoleKey) {
  const s = roleState[role];
  try { fs.unlinkSync(s.storageStateFile); } catch {}
  try { fs.unlinkSync(s.sessionMetaFile); } catch {}
}

function addFlowLog(role: RoleKey, msg: string) {
  const s = roleState[role];
  if (!s.activeFlow) return;
  s.activeFlow.logs.push(`[${new Date().toISOString()}] ${msg}`);
  console.log(`[TaqeemLogin:${role}] ${msg}`);
}

function setSharedContext(role: RoleKey, browser: Browser, context: BrowserContext) {
  roleState[role].sharedBrowser = browser;
  roleState[role].sharedContext = context;
}

// ─── الدوال المُصدَّرة ────────────────────────────────────────────────────────

export function getLoginStatus(role: RoleKey = "entry"): {
  status: LoginStatus;
  username?: string;
  loggedInAt?: string;
  loginId?: string;
  logs: string[];
  error?: string;
  sessionExpiresAt?: string;
} {
  const s = roleState[role];
  if (s.activeFlow) {
    return {
      status: s.activeFlow.status,
      username: s.activeFlow.username,
      loggedInAt: s.activeFlow.loggedInAt?.toISOString(),
      loginId: s.activeFlow.loginId,
      logs: [...s.activeFlow.logs],
      error: s.activeFlow.error,
    };
  }
  const meta = loadMeta(role);
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

export async function startLogin(username: string, password: string, role: RoleKey = "entry"): Promise<string> {
  const s = roleState[role];
  if (s.activeFlow?.browser) {
    try { await s.activeFlow.browser.close(); } catch {}
  }
  s.activeFlow = null;

  const loginId = randomUUID();

  const chromiumExec = getChromiumExecutable();
  const isReplit = !!process.env.REPL_ID || !!process.env.REPLIT_ID;
  const headlessMode = isReplit ? true : false;

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
      console.log(`[TaqeemLogin:${role}] Using real Chrome channel`);
    } catch (e) {
      console.log(`[TaqeemLogin:${role}] Chrome channel not available: ${e} — falling back`);
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
  }

  const storageStateFile = s.storageStateFile;
  const storageState = fs.existsSync(storageStateFile) ? (storageStateFile as any) : undefined;

  const context = await browser.newContext({
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1280, height: 900 },
    ...(isReplit ? {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    } : {}),
    ...(storageState ? { storageState } : {}),
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).window ??= {};
    (globalThis as any).window.chrome = { runtime: {} };
  });

  s.activeFlow = {
    loginId,
    browser,
    context,
    status: "logging_in",
    username,
    otpResolver: null,
    logs: [],
  };

  runLoginFlow(role, s.activeFlow, username, password).catch((err) => {
    if (s.activeFlow?.loginId === loginId) {
      s.activeFlow.status = "failed";
      s.activeFlow.error = err.message;
      addFlowLog(role, `❌ فشل: ${err.message}`);
    }
  });

  return loginId;
}

async function runLoginFlow(role: RoleKey, flow: ActiveLoginFlow, username: string, password: string) {
  const s = roleState[role];
  const TAQEEM_URL = "https://qima.taqeem.gov.sa";
  const SSO_HOST = "sso.taqeem.gov.sa";
  const page = await flow.context.newPage();

  try {
    addFlowLog(role, "الانتقال إلى صفحة تسجيل الدخول...");

    try {
      await page.goto(`${TAQEEM_URL}/membership/login`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
    } catch (navErr: any) {
      addFlowLog(role, `❌ فشل الانتقال للموقع: ${navErr.message}`);
      throw new Error(
        `لا يمكن الوصول إلى ${TAQEEM_URL} — تأكد من اتصالك بالإنترنت وأن الموقع متاح من جهازك. ` +
        `(ملاحظة: الأتمتة يجب أن تشتغل من جهازك المحلي، وليس من Replit)`
      );
    }

    await page.waitForTimeout(2000);

    const currentUrlAfterNav = page.url();
    addFlowLog(role, `الصفحة الحالية: ${currentUrlAfterNav}`);

    if (currentUrlAfterNav === "about:blank" || currentUrlAfterNav === `${TAQEEM_URL}/membership/login`) {
      const bodyText = await page.innerText("body").catch(() => "");
      addFlowLog(role, `محتوى الصفحة (أول 200 حرف): ${bodyText.slice(0, 200)}`);
    }

    const currentUrl = page.url();
    if (!currentUrl.includes(SSO_HOST) && !currentUrl.includes("/login")) {
      addFlowLog(role, "تم استعادة الجلسة السابقة — لا حاجة لإعادة تسجيل الدخول.");
      await page.close();
      flow.status = "authenticated";
      flow.loggedInAt = new Date();
      await flow.context.storageState({ path: s.storageStateFile });
      saveMeta(role, username);
      setSharedContext(role, flow.browser, flow.context);
      if (role === "entry") queuePendingAndProcess();
      return;
    }

    addFlowLog(role, "إدخال بيانات الدخول على Keycloak SSO...");

    await page.waitForLoadState("load", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(2000);

    const pageTitle = await page.title().catch(() => "غير معروف");
    addFlowLog(role, `عنوان الصفحة: ${pageTitle}`);

    try {
      await page.screenshot({ path: `uploads/login-debug-${role}.png` });
      addFlowLog(role, `تم حفظ لقطة الشاشة في uploads/login-debug-${role}.png`);
    } catch {}

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
        addFlowLog(role, `تم العثور على حقل المستخدم: ${sel}`);
        break;
      } catch {}
    }

    if (!usernameField) {
      const allInputs = await page.$$eval('input', els => els.map(e => ({ type: e.type, name: e.name, id: e.id, placeholder: e.placeholder })));
      addFlowLog(role, `❌ الحقول المتاحة في الصفحة: ${JSON.stringify(allInputs)}`);
      throw new Error("لم يتم العثور على حقل اسم المستخدم في صفحة تسجيل الدخول");
    }

    await page.fill(usernameField, username);
    await page.fill('#password, input[name="password"], input[type="password"]', password);

    addFlowLog(role, "النقر على زر تسجيل الدخول...");
    await page.click('#kc-login, input[type="submit"], button[type="submit"]');

    await page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
    await page.waitForTimeout(3000);

    let stableUrl = page.url();
    for (let i = 0; i < 5; i++) {
      await page.waitForTimeout(1000);
      const newUrl = page.url();
      if (newUrl === stableUrl) break;
      stableUrl = newUrl;
    }

    addFlowLog(role, `بعد تسجيل الدخول — الصفحة: ${stableUrl}`);

    let afterLoginHostname = "";
    try { afterLoginHostname = new URL(stableUrl).hostname; } catch {}
    const isOnSSOHost = afterLoginHostname === SSO_HOST;

    if (isOnSSOHost) {
      addFlowLog(role, "ظهرت صفحة التحقق الثنائي...");
      flow.status = "waiting_otp";

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
            addFlowLog(role, "تم اختيار البريد الإلكتروني لاستقبال OTP ✅");
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
          addFlowLog(role, "تم النقر على زر إرسال OTP...");
          await page.waitForLoadState("domcontentloaded", { timeout: 15000 }).catch(() => {});
        } catch {}
      } else {
        addFlowLog(role, "لم يتم العثور على خيار البريد الإلكتروني — المتابعة مباشرة لإدخال OTP...");
      }

      addFlowLog(role, "في انتظار إدخال رمز OTP من البريد الإلكتروني...");
    } else {
      addFlowLog(role, "تسجيل الدخول اكتمل بدون OTP ✅");
      await page.close();
      flow.status = "authenticated";
      flow.loggedInAt = new Date();
      await flow.context.storageState({ path: s.storageStateFile });
      saveMeta(role, username);
      setSharedContext(role, flow.browser, flow.context);
      if (role === "entry") queuePendingAndProcess();
      return;
    }

    const otp = await new Promise<string>((resolve) => {
      flow.otpResolver = resolve;
    });

    addFlowLog(role, "تم استلام OTP — جارٍ إدخاله...");
    flow.status = "logging_in";

    const currentPageUrl = page.url();
    let currentHostname = "";
    try { currentHostname = new URL(currentPageUrl).hostname; } catch {}
    addFlowLog(role, `الصفحة عند إدخال OTP: ${currentPageUrl}`);

    if (currentHostname !== SSO_HOST) {
      addFlowLog(role, "الصفحة انتقلت للرئيسية — تسجيل الدخول مكتمل ✅");
    } else {
      const otpSelector = 'input[name="otp"], input[id="otp"], input[autocomplete="one-time-code"], input[maxlength="6"], input[type="number"], input[type="text"]';
      await page.waitForSelector(otpSelector, { timeout: 10000 });
      await page.fill(otpSelector, otp);
      await page.click('#kc-login, input[type="submit"], button[type="submit"]');
      await page.waitForLoadState("domcontentloaded", { timeout: 30000 });
    }

    addFlowLog(role, "تم تسجيل الدخول بنجاح ✅");
    addFlowLog(role, "جارٍ حفظ الجلسة للاستخدام طوال اليوم...");

    await page.close();
    flow.status = "authenticated";
    flow.loggedInAt = new Date();

    await flow.context.storageState({ path: s.storageStateFile });
    saveMeta(role, username);
    setSharedContext(role, flow.browser, flow.context);

    addFlowLog(role, "✅ الجلسة محفوظة — يمكنك الآن رفع أي عدد من التقارير بدون إعادة تسجيل الدخول.");
    if (role === "entry") queuePendingAndProcess();
  } catch (err: any) {
    try { await page.close(); } catch {}
    throw err;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// سياق معزول لعمليات الأتمتة — يستخدم دائماً جلسة مدخل البيانات
// ─────────────────────────────────────────────────────────────────────────────
export async function createIsolatedAutomationContext(): Promise<{
  context: BrowserContext;
  cleanup: () => Promise<void>;
} | null> {
  const s = roleState["entry"];
  const meta = loadMeta("entry");
  if (!meta || !fs.existsSync(s.storageStateFile)) {
    return null;
  }

  const isReplit = !!process.env.REPL_ID || !!process.env.REPLIT_ID;
  let automationBrowser: Browser;
  let ownsBrowser = false;

  if (s.sharedBrowser) {
    automationBrowser = s.sharedBrowser;
    ownsBrowser = false;
  } else {
    const chromiumExec = getChromiumExecutable();
    let newBrowser: Browser | null = null;

    if (!isReplit) {
      try {
        newBrowser = await chromium.launch({
          headless: false,
          channel: "chrome",
          slowMo: 30,
          args: [
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
          ],
        });
      } catch { newBrowser = null; }
    }

    if (!newBrowser) {
      newBrowser = await chromium.launch({
        headless: isReplit,
        slowMo: isReplit ? 0 : 80,
        args: isReplit
          ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
          : ["--disable-blink-features=AutomationControlled", "--no-first-run"],
        ...(chromiumExec ? { executablePath: chromiumExec } : {}),
      });
    }

    automationBrowser = newBrowser;
    ownsBrowser = true;
  }

  const isolatedContext = await automationBrowser.newContext({
    locale: "ar-SA",
    timezoneId: "Asia/Riyadh",
    viewport: { width: 1280, height: 900 },
    storageState: s.storageStateFile as any,
    ...(isReplit ? {
      userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    } : {}),
  });

  await isolatedContext.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => undefined });
    (globalThis as any).window ??= {};
    (globalThis as any).window.chrome = { runtime: {} };
  });

  const cleanup = async () => {
    try { await isolatedContext.close(); } catch {}
    if (ownsBrowser) {
      try { await automationBrowser.close(); } catch {}
    }
  };

  return { context: isolatedContext, cleanup };
}

export function submitLoginOtp(loginId: string, otp: string, role: RoleKey = "entry"): boolean {
  const s = roleState[role];
  if (!s.activeFlow || s.activeFlow.loginId !== loginId) return false;
  if (!s.activeFlow.otpResolver) return false;
  s.activeFlow.otpResolver(otp);
  s.activeFlow.otpResolver = null;
  return true;
}

export async function getAuthenticatedContext(): Promise<BrowserContext | null> {
  const s = roleState["entry"];

  if (s.sharedContext) {
    return s.sharedContext;
  }

  const meta = loadMeta("entry");
  if (meta && fs.existsSync(s.storageStateFile)) {
    const chromiumExec = getChromiumExecutable();
    const isReplit = !!process.env.REPL_ID || !!process.env.REPLIT_ID;

    let restoredBrowser: import("playwright").Browser | null = null;

    if (!isReplit) {
      try {
        restoredBrowser = await chromium.launch({
          headless: false,
          channel: "chrome",
          slowMo: 100,
          args: [
            "--disable-blink-features=AutomationControlled",
            "--no-first-run",
            "--no-default-browser-check",
          ],
        });
      } catch {
        restoredBrowser = null;
      }
    }

    if (!restoredBrowser) {
      restoredBrowser = await chromium.launch({
        headless: isReplit,
        slowMo: isReplit ? 0 : 100,
        args: isReplit
          ? ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
          : ["--disable-blink-features=AutomationControlled", "--no-first-run"],
        ...(chromiumExec ? { executablePath: chromiumExec } : {}),
      });
    }

    const browser = restoredBrowser;

    const context = await browser.newContext({
      locale: "ar-SA",
      timezoneId: "Asia/Riyadh",
      viewport: { width: 1280, height: 900 },
      storageState: s.storageStateFile as any,
      ...(isReplit ? {
        userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      } : {}),
    });

    setSharedContext("entry", browser, context);

    if (!s.activeFlow) {
      s.activeFlow = {
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

export async function logout(role: RoleKey = "entry"): Promise<void> {
  const s = roleState[role];
  if (s.sharedBrowser) {
    try { await s.sharedBrowser.close(); } catch {}
  }
  s.sharedBrowser = null;
  s.sharedContext = null;
  s.activeFlow = null;
  clearSavedState(role);
  console.log(`[TaqeemLogin:${role}] تم تسجيل الخروج وحذف الجلسة.`);
}
