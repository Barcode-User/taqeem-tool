import app from "./app";
import { logger } from "./lib/logger";
import { getReportsByAutomationStatus, updateReport } from "@workspace/db";
import { processQueue } from "./automation/queue-processor";

// ── تنظيف الحالات العالقة عند بدء الخادم ──────────────────────────────────
async function resetStuckAutomations() {
  try {
    // أعِد ضبط "running" → "idle" (الخادم أُعيد تشغيله في الأثناء)
    const running = await getReportsByAutomationStatus("running");
    for (const r of running) {
      await updateReport(r.id, {
        automationStatus: "idle",
        automationError: "الخادم أُعيد تشغيله أثناء عمل الأتمتة — يرجى المحاولة مجدداً",
      });
    }
    if (running.length > 0) {
      logger.info({ count: running.length }, "تم إعادة ضبط الأتمتات العالقة");
    }

    // ابدأ معالجة أي تقارير كانت في الطابور قبل إعادة التشغيل
    const queued = await getReportsByAutomationStatus("queued");
    if (queued.length > 0) {
      logger.info({ count: queued.length }, "يوجد تقارير في الطابور — جارٍ المعالجة...");
      processQueue().catch(err =>
        logger.error({ err }, "خطأ في معالجة الطابور عند البدء")
      );
    }
  } catch (err) {
    logger.error({ err }, "خطأ في إعادة ضبط الأتمتات العالقة");
  }
}

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // نظّف الحالات العالقة بعد البدء مباشرةً
  resetStuckAutomations();
});
