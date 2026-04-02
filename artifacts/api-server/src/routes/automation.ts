import { Router } from "express";
import { db, reportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startAutomation } from "../automation/taqeem-bot";
import {
  getSessionByReportId,
  submitOtp,
} from "../automation/session-manager";

const router = Router();

// POST /api/automation/start/:reportId
router.post("/automation/start/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) {
      res.status(400).json({ error: "Invalid report ID" });
      return;
    }

    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    const body = { username: String(username), password: String(password) };

    const [report] = await db
      .select()
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId));

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    if (report.automationStatus === "running" || report.automationStatus === "waiting_otp") {
      res.status(409).json({ error: "Automation already running for this report" });
      return;
    }

    const sessionId = await startAutomation(reportId, {
      username: body.username,
      password: body.password,
      headless: true,
    });

    res.json({ sessionId, message: "Automation started" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to start automation");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/automation/otp/:sessionId
router.post("/automation/otp/:sessionId", async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { otp } = req.body;

    if (!otp) {
      res.status(400).json({ error: "OTP is required" });
      return;
    }

    const success = submitOtp(sessionId, String(otp));
    if (!success) {
      res.status(404).json({ error: "Session not found or not waiting for OTP" });
      return;
    }

    res.json({ message: "OTP submitted, automation resuming..." });
  } catch (err: any) {
    req.log.error({ err }, "Failed to submit OTP");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/automation/status/:reportId
router.get("/automation/status/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);

    const [report] = await db
      .select({
        id: reportsTable.id,
        automationStatus: reportsTable.automationStatus,
        automationError: reportsTable.automationError,
        automationSessionId: reportsTable.automationSessionId,
        qrCodeBase64: reportsTable.qrCodeBase64,
        certificatePath: reportsTable.certificatePath,
        taqeemSubmittedAt: reportsTable.taqeemSubmittedAt,
      })
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId));

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    const session = getSessionByReportId(reportId);
    const logs = session?.logs ?? [];

    res.json({
      reportId,
      automationStatus: report.automationStatus ?? "idle",
      automationError: report.automationError,
      sessionId: report.automationSessionId,
      qrCodeBase64: report.qrCodeBase64,
      hasCertificate: !!report.certificatePath,
      taqeemSubmittedAt: report.taqeemSubmittedAt,
      logs,
    });
  } catch (err: any) {
    req.log.error({ err }, "Failed to get automation status");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /api/automation/certificate/:reportId
router.get("/automation/certificate/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    const [report] = await db
      .select({ certificatePath: reportsTable.certificatePath })
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId));

    if (!report?.certificatePath) {
      res.status(404).json({ error: "Certificate not found" });
      return;
    }

    res.download(report.certificatePath, `certificate_${reportId}.pdf`);
  } catch (err: any) {
    req.log.error({ err }, "Failed to download certificate");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/automation/retry/:reportId
router.post("/automation/retry/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }

    await db
      .update(reportsTable)
      .set({ automationStatus: "idle", automationError: null })
      .where(eq(reportsTable.id, reportId));

    const sessionId = await startAutomation(reportId, {
      username: String(username),
      password: String(password),
      headless: true,
    });

    res.json({ sessionId, message: "Automation retry started" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to retry automation");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

export default router;
