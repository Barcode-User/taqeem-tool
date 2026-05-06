import { createIsolatedContextForRole } from "./taqeem-session-store.js";

const REPORTS_URL = "https://qima.taqeem.gov.sa/membership/reports/sector/1";

export type CertifyStatus = "idle" | "running" | "ready" | "failed";

type CertifyState = {
  status: CertifyStatus;
  error?: string;
  startedAt?: Date;
  logs: string[];
};

let state: CertifyState = { status: "idle", logs: [] };
let cleanupFn: (() => Promise<void>) | null = null;

function log(msg: string) {
  state.logs.push(`[${new Date().toISOString()}] ${msg}`);
  console.log(`[CertifyBot] ${msg}`);
}

export function getCertifyStatus(): CertifyState {
  return { ...state, logs: [...state.logs] };
}

export async function startCertifySession(): Promise<void> {
  if (state.status === "running") return;

  if (cleanupFn) {
    try { await cleanupFn(); } catch {}
    cleanupFn = null;
  }

  state = { status: "running", logs: [], startedAt: new Date() };
  log("بدء جلسة التعميد...");

  try {
    const session = await createIsolatedContextForRole("certifier");
    if (!session) {
      state.status = "failed";
      state.error = "لا توجد جلسة معمد بيانات — سجّل الدخول أولاً من صفحة جلسة تقييم";
      log("❌ " + state.error);
      return;
    }

    cleanupFn = session.cleanup;
    const { context } = session;

    log("فتح المتصفح بجلسة معمد البيانات...");
    const page = await context.newPage();

    log(`الانتقال إلى صفحة التقارير: ${REPORTS_URL}`);
    try {
      await page.goto(REPORTS_URL, { waitUntil: "domcontentloaded", timeout: 60000 });
    } catch (navErr: any) {
      state.status = "failed";
      state.error = `لا يمكن الوصول للموقع — تأكد من أن الأتمتة تعمل على جهازك المحلي. (${navErr.message})`;
      log("❌ " + state.error);
      try { await session.cleanup(); } catch {}
      cleanupFn = null;
      return;
    }

    await page.waitForTimeout(3000);
    log(`الصفحة المحملة: ${page.url()}`);

    // ─── اختيار فلتر الحالة ────────────────────────────────────────────────
    log("البحث عن فلتر الحالة...");

    const statusFilterSelectors = [
      'select[name*="status" i]',
      'select[id*="status" i]',
      'select[placeholder*="الحالة" i]',
      'mat-select[placeholder*="الحالة" i]',
      'mat-select[aria-label*="الحالة" i]',
      '[formcontrolname*="status" i]',
      '[formcontrolname*="Status" i]',
      'select',
    ];

    let filterSelected = false;
    for (const sel of statusFilterSelectors) {
      try {
        const elements = await page.$$(sel);
        for (const el of elements) {
          const text = await el.textContent().catch(() => "");
          if (!text?.includes("الحالة") && sel !== 'select') continue;

          // محاولة اختيار "تقارير غير مكتملة" أو مكافئها
          if (sel.startsWith("mat-select")) {
            await el.click();
            await page.waitForTimeout(800);
            const option = await page.$('mat-option:has-text("غير مكتملة"), mat-option:has-text("مسودة"), mat-option:has-text("Draft")');
            if (option) {
              await option.click();
              filterSelected = true;
              log("تم اختيار فلتر الحالة (mat-select) ✅");
              break;
            }
          } else {
            await page.selectOption(sel, { label: /غير مكتملة|مسودة|Draft/i } as any).catch(async () => {
              const opts = await page.$$eval(sel + ' option', opts => opts.map(o => ({ value: (o as HTMLOptionElement).value, text: o.textContent?.trim() })));
              log(`خيارات متاحة: ${JSON.stringify(opts)}`);
            });
            filterSelected = true;
            log("تم اختيار فلتر الحالة (select) ✅");
            break;
          }
        }
        if (filterSelected) break;
      } catch {}
    }

    if (!filterSelected) {
      log("⚠️ لم يتم العثور على فلتر الحالة — الصفحة مفتوحة ويمكنك الاختيار يدوياً");
    }

    await page.waitForTimeout(1500);
    log("✅ الصفحة جاهزة — المتصفح مفتوح للتعميد اليدوي");
    state.status = "ready";

  } catch (err: any) {
    state.status = "failed";
    state.error = err.message;
    log("❌ خطأ: " + err.message);
    if (cleanupFn) { try { await cleanupFn(); } catch {} cleanupFn = null; }
  }
}

export async function stopCertifySession(): Promise<void> {
  if (cleanupFn) {
    try { await cleanupFn(); } catch {}
    cleanupFn = null;
  }
  state = { status: "idle", logs: [] };
  console.log("[CertifyBot] جلسة التعميد أُغلقت.");
}
