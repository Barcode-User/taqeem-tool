import { Router, type IRouter } from "express";
import healthRouter from "./health";
import automationRouter from "./automation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(automationRouter);

// تحميل routes قاعدة البيانات فقط إذا كانت DATABASE_URL متوفرة
if (process.env.DATABASE_URL) {
  import("./reports").then(({ default: reportsRouter }) => {
    router.use(reportsRouter);
  }).catch((err) => {
    console.error("[API] فشل تحميل routes التقارير:", err.message);
  });
} else {
  console.warn("[API] DATABASE_URL غير متوفرة — routes التقارير معطّلة (وضع الأتمتة فقط)");
}

export default router;
