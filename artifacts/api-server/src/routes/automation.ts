import { Router } from "express";
import { db, reportsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { startAutomation } from "../automation/taqeem-bot";
import { getSessionByReportId, submitOtp } from "../automation/session-manager";
import {
  startLogin,
  submitLoginOtp,
  getLoginStatus,
  logout,
} from "../automation/taqeem-session-store";

const router = Router();

// ─────────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT (login once, reuse all day)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/automation/session-status
router.get("/automation/session-status", (_req, res) => {
  res.json(getLoginStatus());
});

// POST /api/automation/login  — start login flow (username + password)
router.post("/automation/login", async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: "username and password are required" });
      return;
    }
    const loginId = await startLogin(String(username), String(password));
    res.json({ loginId, message: "بدأت عملية تسجيل الدخول — انتظر رمز OTP" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to start login");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/automation/login-otp  — submit OTP for login
router.post("/automation/login-otp", (req, res) => {
  const { loginId, otp } = req.body;
  if (!loginId || !otp) {
    res.status(400).json({ error: "loginId and otp are required" });
    return;
  }
  const ok = submitLoginOtp(String(loginId), String(otp));
  if (!ok) {
    res.status(400).json({ error: "جلسة تسجيل الدخول غير موجودة أو انتهت" });
    return;
  }
  res.json({ message: "تم إرسال OTP — جارٍ إكمال تسجيل الدخول..." });
});

// POST /api/automation/logout
router.post("/automation/logout", async (_req, res) => {
  await logout();
  res.json({ message: "تم تسجيل الخروج وحذف الجلسة." });
});

// ─────────────────────────────────────────────────────────────────────────────
// REPORT AUTOMATION
// ─────────────────────────────────────────────────────────────────────────────

// POST /api/automation/start/:reportId
router.post("/automation/start/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) {
      res.status(400).json({ error: "Invalid report ID" });
      return;
    }

    const [report] = await db
      .select({ id: reportsTable.id, automationStatus: reportsTable.automationStatus })
      .from(reportsTable)
      .where(eq(reportsTable.id, reportId));

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    if (report.automationStatus === "running" || report.automationStatus === "waiting_otp") {
      res.status(409).json({ error: "التقرير قيد المعالجة بالفعل" });
      return;
    }

    const sessionId = await startAutomation(reportId);
    res.json({ sessionId, message: "بدأت عملية الرفع الآلي" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to start automation");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// GET /api/automation/status/:reportId
router.get("/automation/status/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) {
      res.status(400).json({ error: "Invalid report ID" });
      return;
    }

    const [report] = await db
      .select({
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

    res.download(report.certificatePath);
  } catch (err: any) {
    req.log.error({ err }, "Failed to download certificate");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /api/automation/retry/:reportId
router.post("/automation/retry/:reportId", async (req, res) => {
  try {
    const reportId = parseInt(req.params.reportId);
    if (isNaN(reportId)) {
      res.status(400).json({ error: "Invalid report ID" });
      return;
    }

    await db
      .update(reportsTable)
      .set({ automationStatus: "idle", automationError: null })
      .where(eq(reportsTable.id, reportId));

    const sessionId = await startAutomation(reportId);
    res.json({ sessionId, message: "تمت إعادة المحاولة" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to retry automation");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

export default router;
