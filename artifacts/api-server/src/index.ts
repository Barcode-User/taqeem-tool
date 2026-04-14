import app from "./app";
import { logger } from "./lib/logger";
import { getReportsByAutomationStatus, updateReport } from "@workspace/db";

// ── تنظيف الحالات العالقة عند بدء الخادم ──────────────────────────────────
// أي تقرير بحالة "running" عند البدء يعني أن الخادم أُعيد تشغيله في الأثناء
// نُعيد ضبطها إلى "idle" حتى يتمكن المستخدم من إعادة تشغيل الأتمتة
async function resetStuckAutomations() {
  try {
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
