import { Router, type IRouter } from "express";
import healthRouter from "./health";
import automationRouter from "./automation";
import { isConfigured } from "@workspace/db";

const router: IRouter = Router();

router.use(healthRouter);
router.use(automationRouter);

// تحميل routes قاعدة البيانات فقط إذا كان SQL Server مُهيَّئاً
if (isConfigured()) {
  import("./reports").then(({ default: reportsRouter }) => {
    router.use(reportsRouter);
    console.log("[API] ✅ تم تحميل routes التقارير — متصل بـ SQL Server");
  }).catch((err) => {
    console.error("[API] فشل تحميل routes التقارير:", err.message);
  });
} else {
  console.warn("[API] MSSQL غير مُهيَّأ — routes التقارير معطّلة (وضع الأتمتة فقط)");
  console.warn("[API] لتفعيلها: أضف MSSQL_SERVER + MSSQL_PASSWORD في البيئة");
}

export default router;
