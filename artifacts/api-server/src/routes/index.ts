import { Router, type IRouter } from "express";
import healthRouter from "./health";
import automationRouter from "./automation";
import reportsRouter from "./reports";

const router: IRouter = Router();

router.use(healthRouter);
router.use(automationRouter);
router.use(reportsRouter);

console.log("[API] ✅ تم تحميل جميع الـ routes");

export default router;
