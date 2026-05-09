import { Router } from "express";
import { insertCertifiedReport, listCertifiedReports } from "@workspace/db";

const router = Router();

// GET /certified-reports — قائمة التقارير المعمدة
router.get("/certified-reports", async (req, res) => {
  try {
    const list = await listCertifiedReports();
    res.json(list);
  } catch (err) {
    req.log.error({ err }, "Failed to list certified reports");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /certified-reports — إضافة تقرير معمَّد يدوياً
router.post("/certified-reports", async (req, res) => {
  try {
    const { reportCode, taqeemReportNumber, certifiedAt } = req.body ?? {};
    if (!reportCode || !taqeemReportNumber) {
      return res.status(400).json({ error: "reportCode و taqeemReportNumber مطلوبان" });
    }
    const record = await insertCertifiedReport({ reportCode, taqeemReportNumber, certifiedAt });
    res.status(201).json(record);
  } catch (err) {
    req.log.error({ err }, "Failed to insert certified report");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
