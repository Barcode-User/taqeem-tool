/**
 * queue-processor.ts
 * معالج الطابور — يُعالج جميع التقارير بحالة "queued" بالترتيب بعد نجاح الجلسة
 */

import {
  getReportsByAutomationStatus,
  getReportAutomationStatus,
  updateReport,
} from "@workspace/db";
import { startAutomation } from "./taqeem-bot";

let isProcessing = false;

export async function processQueue(): Promise<void> {
  if (isProcessing) {
    console.log("[Queue] جارٍ المعالجة بالفعل — تجاهل الطلب");
    return;
  }

  isProcessing = true;
  console.log("[Queue] بدء معالجة الطلبات المعلقة...");

  try {
    const queued = await getReportsByAutomationStatus("queued");

    if (queued.length === 0) {
      console.log("[Queue] لا توجد طلبات معلقة.");
      return;
    }

    console.log(`[Queue] ${queued.length} طلب معلق — سيتم معالجتها بالترتيب.`);

    for (const report of queued) {
      console.log(`[Queue] معالجة تقرير #${report.id} (${report.reportNumber ?? "بدون رقم"})...`);

      try {
        await updateReport(report.id, { automationStatus: "running" });

        const sessionId = await startAutomation(report.id);
        console.log(`[Queue] ✅ تقرير #${report.id} — بدأت جلسة ${sessionId}`);

        await waitForCompletion(report.id);
      } catch (err: any) {
        console.error(`[Queue] ❌ فشل تقرير #${report.id}: ${err.message}`);
        await updateReport(report.id, {
          automationStatus: "failed",
          automationError: err.message,
        });
      }

      await sleep(3000);
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
    await sleep(5000);
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
