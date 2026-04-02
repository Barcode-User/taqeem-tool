import { Router, type IRouter } from "express";
import healthRouter from "./health";
import reportsRouter from "./reports";
import automationRouter from "./automation";

const router: IRouter = Router();

router.use(healthRouter);
router.use(reportsRouter);
router.use(automationRouter);

export default router;
