/**
 * queue-processor.ts
 * معالج الطابور — متصفح واحد فقط في آن واحد لتجنب تداخل البيانات
 *
 * النموذج: event-driven (لا polling)
 *   - waitForCompletion لا تسأل DB كل N ثوانٍ
 *   - بدلاً من ذلك: البوت يستدعي notifyReportCompleted() عند الانتهاء مباشرة
 *   - Promise يُحلّ فوراً ← التقرير التالي يبدأ في أقل من 200ms
 */

import {
  getReportsByAutomationStatus,
  updateReport,
} from "@workspace/db";
import { startAutomation } from "./taqeem-bot";
import { canStartNewSession, getRunningSessionCount } from "./session-manager";

const MAX_CONCURRENT = 1;
let isProcessing = false;

// ── خريطة: reportId → دالة تُحلّ Promise الانتظار فوراً ────────────────────
const completionResolvers = new Map<number, (timedOut: boolean) => void>();

/**
 * يُستدعى من taqeem-bot.ts عند انتهاء كل تقرير (نجاح أو فشل)
 * يُحلّ Promise الطابور فوراً بدون أي تأخير
 */
export function notifyReportCompleted(reportId: number): void {
  const resolve = completionResolvers.get(reportId);
  if (resolve) {
    completionResolvers.delete(reportId);
    resolve(false);
    console.log(`[Queue] 🔔 تقرير #${reportId} انتهى — جاهز للتالي`);
  }
}

export async function processQueue(): Promise<void> {
  if (isProcessing) {
    console.log("[Queue] جارٍ المعالجة بالفعل — تجاهل الطلب");
    return;
  }

  isProcessing = true;
  console.log("[Queue] بدء معالجة الطلبات المعلقة...");

  try {
    while (true) {
      const queued = await getReportsByAutomationStatus("queued");
      if (queued.length === 0) {
        console.log("[Queue] لا توجد طلبات معلقة.");
        break;
      }

      const running = getRunningSessionCount();
      const slots   = MAX_CONCURRENT - running;

      if (slots <= 0) {
        // المتصفح مشغول — انتظر إشعار الانتهاء (لا polling، فقط Promise)
        console.log(`[Queue] المتصفح مشغول — انتظار إشعار الانتهاء...`);
        await waitForAnyCompletion();
        continue;
      }

      // شغّل التقرير الأول في الطابور
      const report = queued[0];
      console.log(`[Queue] ${queued.length} معلق | يعمل: ${running} | نبدأ: #${report.id}`);

      try {
        await updateReport(report.id, { automationStatus: "running" });
        const sessionId = await startAutomation(report.id);
        console.log(`[Queue] ✅ تقرير #${report.id} — جلسة ${sessionId}`);
        // انتظر الإشعار المباشر من البوت (لا polling)
        await waitForCompletion(report.id);
      } catch (err: any) {
        console.error(`[Queue] ❌ فشل تقرير #${report.id}: ${err.message}`);
        await updateReport(report.id, {
          automationStatus: "failed",
          automationError: err.message,
        });
        // أزل أي resolver معلّق لهذا التقرير
        completionResolvers.delete(report.id);
      }

      // توقف قصير جداً بين التقارير (100ms) — فقط لتجنب race conditions
      await sleep(100);
    }

    console.log("[Queue] ✅ تم معالجة جميع الطلبات المعلقة.");
  } catch (err: any) {
    console.error(`[Queue] ❌ خطأ في معالج الطابور: ${err.message}`);
  } finally {
    isProcessing = false;
  }
}

/**
 * ينتظر إشعاراً مباشراً من notifyReportCompleted
 * مهلة قصوى: 10 دقائق (حماية من الانتظار إلى الأبد)
 */
function waitForCompletion(reportId: number, maxWaitMs = 10 * 60 * 1000): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      completionResolvers.delete(reportId);
      console.warn(`[Queue] ⚠️ انتهت مهلة الانتظار للتقرير #${reportId} — تجاوز للتالي`);
      resolve();
    }, maxWaitMs);

    completionResolvers.set(reportId, (timedOut: boolean) => {
      clearTimeout(timer);
      resolve();
    });
  });
}

/**
 * ينتظر انتهاء أي تقرير جارٍ (يُستخدم عندما يكون المتصفح مشغولاً)
 * مهلة احتياطية: 30 ثانية
 */
function waitForAnyCompletion(maxWaitMs = 30_000): Promise<void> {
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, maxWaitMs);
    // لف كل الـ resolvers الموجودة لتُنبّه هذا الانتظار أيضاً
    const origResolvers = new Map(completionResolvers);
    for (const [id, orig] of origResolvers) {
      completionResolvers.set(id, (to: boolean) => {
        clearTimeout(timer);
        orig(to);
        resolve();
      });
    }
  });
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function hasPendingQueue(): Promise<number> {
  const queued = await getReportsByAutomationStatus("queued");
  return queued.length;
}

export { canStartNewSession, MAX_CONCURRENT };
