/**
 * queue-processor.ts
 * معالج الطابور — يُعالج التقارير بالترتيب مع حد أقصى 2 متصفح في آن واحد
 */

import {
  getReportsByAutomationStatus,
  getReportAutomationStatus,
  updateReport,
} from "@workspace/db";
import { startAutomation } from "./taqeem-bot";
import { canStartNewSession, getRunningSessionCount } from "./session-manager";

const MAX_CONCURRENT = 2;
let isProcessing = false;

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

      // احسب كم يمكن تشغيله الآن
      const running = getRunningSessionCount();
      const slots   = MAX_CONCURRENT - running;

      if (slots <= 0) {
        // الحد الأقصى مشغول — انتظر حتى ينتهي واحد
        console.log(`[Queue] الحد الأقصى (${MAX_CONCURRENT}) مشغول — انتظار...`);
        await sleep(4000);
        continue;
      }

      // شغّل بقدر الفراغ المتاح
      const batch = queued.slice(0, slots);
      console.log(`[Queue] ${queued.length} معلق | يعمل: ${running} | نبدأ: ${batch.length}`);

      const promises = batch.map(async (report) => {
        try {
          await updateReport(report.id, { automationStatus: "running" });
          const sessionId = await startAutomation(report.id);
          console.log(`[Queue] ✅ تقرير #${report.id} — جلسة ${sessionId}`);
          await waitForCompletion(report.id);
        } catch (err: any) {
          console.error(`[Queue] ❌ فشل تقرير #${report.id}: ${err.message}`);
          await updateReport(report.id, {
            automationStatus: "failed",
            automationError: err.message,
          });
        }
      });

      await Promise.all(promises);
      await sleep(1000);
    }

    console.log("[Queue] ✅ تم معالجة جميع الطلبات المعلقة.");
  } catch (err: any) {
    console.error(`[Queue] ❌ خطأ في معالج الطابور: ${err.message}`);
  } finally {
    isProcessing = false;
  }
}

async function waitForCompletion(reportId: number, maxWaitMs = 5 * 60 * 1000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    await sleep(3000);
    const row = await getReportAutomationStatus(reportId);
    const done = ["completed", "failed", "idle"].includes(row?.automationStatus ?? "");
    if (done) return;
  }
  console.warn(`[Queue] انتهت مهلة الانتظار للتقرير #${reportId}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function hasPendingQueue(): Promise<number> {
  const queued = await getReportsByAutomationStatus("queued");
  return queued.length;
}

export { canStartNewSession, MAX_CONCURRENT };
