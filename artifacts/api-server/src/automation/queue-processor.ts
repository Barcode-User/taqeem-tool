/**
 * queue-processor.ts
 * معالج الطابور — يُعالج جميع التقارير بحالة "queued" بالترتيب بعد نشاط الجلسة
 */

import { db, reportsTable } from "@workspace/db";
import { eq, asc } from "drizzle-orm";
import { startAutomation } from "./taqeem-bot";

let isProcessing = false;

/**
 * يُشغَّل بعد نجاح تسجيل الدخول — يمشي على جميع الطلبات المعلقة بالترتيب
 */
export async function processQueue(): Promise<void> {
  if (isProcessing) {
    console.log("[Queue] جارٍ المعالجة بالفعل — تجاهل الطلب");
    return;
  }

  isProcessing = true;
  console.log("[Queue] بدء معالجة الطلبات المعلقة...");

  try {
    const queued = await db
      .select({ id: reportsTable.id, reportNumber: reportsTable.reportNumber })
      .from(reportsTable)
      .where(eq(reportsTable.automationStatus, "queued"))
      .orderBy(asc(reportsTable.createdAt));

    if (queued.length === 0) {
      console.log("[Queue] لا توجد طلبات معلقة.");
      return;
    }

    console.log(`[Queue] ${queued.length} طلب معلق — سيتم معالجتها بالترتيب.`);

    for (const report of queued) {
      console.log(`[Queue] معالجة تقرير #${report.id} (${report.reportNumber ?? "بدون رقم"})...`);

      try {
        // تحديث الحالة إلى processing
        await db
          .update(reportsTable)
          .set({ automationStatus: "running" })
          .where(eq(reportsTable.id, report.id));

        const sessionId = await startAutomation(report.id);
        console.log(`[Queue] ✅ تقرير #${report.id} — بدأت جلسة ${sessionId}`);

        // انتظر انتهاء هذا التقرير قبل الانتقال للتالي
        await waitForCompletion(report.id);

      } catch (err: any) {
        console.error(`[Queue] ❌ فشل تقرير #${report.id}: ${err.message}`);
        await db
          .update(reportsTable)
          .set({ automationStatus: "failed", automationError: err.message })
          .where(eq(reportsTable.id, report.id));
        // استمر في الطلبات التالية حتى لو فشل هذا
      }

      // استراحة قصيرة بين الطلبات
      await sleep(3000);
    }

    console.log("[Queue] ✅ تم معالجة جميع الطلبات المعلقة.");

  } catch (err: any) {
    console.error(`[Queue] ❌ خطأ في معالج الطابور: ${err.message}`);
  } finally {
    isProcessing = false;
  }
}

/** انتظر حتى ينتهي التقرير (نجاح أو فشل) بحد أقصى 5 دقائق */
async function waitForCompletion(reportId: number, maxWaitMs = 5 * 60 * 1000): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < maxWaitMs) {
    await sleep(5000);
    const [report] = await db
      .select({ automationStatus: reportsTable.automationStatus })
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId));

    const done = ["completed", "failed", "idle"].includes(report?.automationStatus ?? "");
    if (done) return;
  }
  console.warn(`[Queue] انتهت مهلة الانتظار للتقرير #${reportId}`);
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** هل يوجد طلبات معلقة؟ */
export async function hasPendingQueue(): Promise<number> {
  const queued = await db
    .select({ id: reportsTable.id })
    .from(reportsTable)
    .where(eq(reportsTable.automationStatus, "queued"));
  return queued.length;
}
