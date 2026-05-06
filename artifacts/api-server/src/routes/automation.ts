import { Router } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import {
  insertReport,
  getReportById,
  getReportsByAutomationStatus,
  updateReport,
} from "@workspace/db";
import { startAutomation } from "../automation/taqeem-bot";
import { getSessionByReportId, submitOtp, isAnySessionRunning, canStartNewSession } from "../automation/session-manager";
import {
  startLogin,
  submitLoginOtp,
  getLoginStatus,
  logout,
  getAuthenticatedContext,
} from "../automation/taqeem-session-store";
import { hasPendingQueue, MAX_CONCURRENT, processQueue } from "../automation/queue-processor";

const router = Router();

// ─── إعداد رفع الملفات ────────────────────────────────────────────────────────
const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}_${file.originalname}`);
  },
});
const upload = multer({ storage: diskStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// ─────────────────────────────────────────────────────────────────────────────
// SESSION MANAGEMENT
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/automation/session-status
router.get("/automation/session-status", async (_req, res) => {
  const status = getLoginStatus();
  const pendingCount = await hasPendingQueue().catch(() => 0);
  res.json({ ...status, pendingQueueCount: pendingCount });
});

// POST /api/automation/login
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

// POST /api/automation/login-otp
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
  res.json({ message: "تم إرسال OTP — جارٍ إكمال تسجيل الدخول وسيبدأ معالجة الطابور تلقائياً..." });
});

// POST /api/automation/logout
router.post("/automation/logout", async (_req, res) => {
  await logout();
  res.json({ message: "تم تسجيل الخروج وحذف الجلسة." });
});

// ─────────────────────────────────────────────────────────────────────────────
// EXTERNAL SUBMIT — يُستدعى من النظام الخارجي
// POST /api/automation/submit-external
//
// الطلب: multipart/form-data
//   • data  → JSON string لبيانات التقرير
//   • pdf   → ملف PDF (stream)
//
// الاستجابة عند الجلسة نشطة:   { status: "processing", reportId, sessionId }
// الاستجابة عند الجلسة منتهية: { status: "queued",     reportId }
// ─────────────────────────────────────────────────────────────────────────────
router.post("/automation/submit-external", upload.single("pdf"), async (req, res) => {
  try {
    // ─── التحقق من وجود الملف ───────────────────────────────────────────────
    if (!req.file) {
      res.status(400).json({ error: "يجب إرسال ملف PDF في الحقل 'pdf'" });
      return;
    }

    // ─── تحليل بيانات JSON ──────────────────────────────────────────────────
    let reportData: Record<string, any> = {};
    if (req.body.data) {
      try {
        reportData = JSON.parse(req.body.data);
      } catch {
        res.status(400).json({ error: "حقل 'data' يجب أن يكون JSON صالحاً" });
        return;
      }
    }

    // ─── حفظ التقرير في قاعدة البيانات ────────────────────────────────────
    const report = await insertReport({
      reportNumber:                reportData.reportNumber             ?? null,
      reportDate:                  reportData.reportDate               ?? null,
      valuationDate:               reportData.valuationDate            ?? null,
      inspectionDate:              reportData.inspectionDate           ?? null,
      commissionDate:              reportData.commissionDate           ?? null,
      requestNumber:               reportData.requestNumber            ?? null,
      valuerName:                  reportData.valuerName               ?? null,
      licenseNumber:               reportData.licenseNumber            ?? null,
      licenseDate:                 reportData.licenseDate              ?? null,
      membershipNumber:            reportData.membershipNumber         ?? null,
      membershipType:              reportData.membershipType           ?? null,
      valuerPercentage:            reportData.valuerPercentage         ?? null,
      secondValuerName:            reportData.secondValuerName         ?? null,
      secondValuerPercentage:      reportData.secondValuerPercentage   ?? null,
      secondValuerLicenseNumber:   reportData.secondValuerLicenseNumber  ?? null,
      secondValuerMembershipNumber:reportData.secondValuerMembershipNumber ?? null,
      clientName:                  reportData.clientName               ?? null,
      clientEmail:                 reportData.clientEmail              ?? null,
      clientPhone:                 reportData.clientPhone              ?? null,
      intendedUser:                reportData.intendedUser             ?? null,
      reportType:                  reportData.reportType               ?? null,
      valuationPurpose:            reportData.valuationPurpose         ?? null,
      valuationHypothesis:         reportData.valuationHypothesis      ?? null,
      valuationBasis:              reportData.valuationBasis           ?? null,
      propertyType:                reportData.propertyType             ?? null,
      propertySubType:             reportData.propertySubType          ?? null,
      region:                      reportData.region                   ?? null,
      city:                        reportData.city                     ?? null,
      district:                    reportData.district                 ?? null,
      street:                      reportData.street                   ?? null,
      blockNumber:                 reportData.blockNumber              ?? null,
      plotNumber:                  reportData.plotNumber               ?? null,
      planNumber:                  reportData.planNumber               ?? null,
      propertyUse:                 reportData.propertyUse              ?? null,
      deedNumber:                  reportData.deedNumber               ?? null,
      deedDate:                    reportData.deedDate                 ?? null,
      ownerName:                   reportData.ownerName                ?? null,
      ownershipType:               reportData.ownershipType            ?? null,
      buildingPermitNumber:        reportData.buildingPermitNumber     ?? null,
      buildingStatus:              reportData.buildingStatus           ?? null,
      buildingAge:                 reportData.buildingAge              ?? null,
      landArea:                    reportData.landArea                 ?? null,
      buildingArea:                reportData.buildingArea             ?? null,
      basementArea:                reportData.basementArea             ?? null,
      annexArea:                   reportData.annexArea                ?? null,
      floorsCount:                 reportData.floorsCount              ?? null,
      permittedFloorsCount:        reportData.permittedFloorsCount     ?? null,
      permittedBuildingRatio:      reportData.permittedBuildingRatio   ?? null,
      streetWidth:                 reportData.streetWidth              ?? null,
      streetFacades:               reportData.streetFacades            ?? null,
      utilities:                   reportData.utilities                ?? null,
      coordinates:                 reportData.coordinates              ?? null,
      valuationMethod:             reportData.valuationMethod          ?? null,
      marketValue:                 reportData.marketValue              ?? null,
      incomeValue:                 reportData.incomeValue              ?? null,
      costValue:                   reportData.costValue                ?? null,
      finalValue:                  reportData.finalValue               ?? null,
      pricePerMeter:               reportData.pricePerMeter            ?? null,
      companyName:                 reportData.companyName              ?? null,
      commercialRegNumber:         reportData.commercialRegNumber      ?? null,
      notes:                       reportData.notes                    ?? null,
      pdfFileName:  req.file.originalname,
      pdfFilePath:  req.file.path,
      status:           "reviewed",
      automationStatus: "queued",
    });

    // ─── هل الجلسة نشطة؟ ────────────────────────────────────────────────────
    const sessionContext = await getAuthenticatedContext();

    if (sessionContext) {
      if (!canStartNewSession(MAX_CONCURRENT)) {
        // الحد الأقصى (متصفح واحد) مشغول — أضف للطابور
        console.log(`[ExternalSubmit] 🕐 تقرير #${report.id} — أُضيف للطابور (المتصفح مشغول)`);
        res.status(202).json({
          status:     "queued",
          reportId:   report.id,
          draftSaved: true,
          message:    "تم حفظ الطلب وسيُرفع تلقائياً بعد انتهاء الطلب الحالي",
        });
        return;
      }

      // ✅ يوجد فراغ — ابدأ فوراً
      console.log(`[ExternalSubmit] ✅ تقرير #${report.id} — رفع فوري (جلسة نشطة)`);
      const sessionId = await startAutomation(report.id);

      res.status(202).json({
        status:    "processing",
        reportId:  report.id,
        sessionId,
        draftSaved: true,
        message:   "تم حفظ الطلب وجارٍ رفعه فوراً على منصة تقييم",
      });
    } else {
      // 🕐 جلسة منتهية — يبقى مسودة حتى تسجيل الدخول
      console.log(`[ExternalSubmit] 🕐 تقرير #${report.id} — محفوظ كمسودة (لا توجد جلسة)`);

      res.status(202).json({
        status:    "queued",
        reportId:  report.id,
        draftSaved: true,
        message:   "تم حفظ الطلب كمسودة وسيُرفع تلقائياً عند تسجيل الدخول التالي",
      });
    }

  } catch (err: any) {
    req.log.error({ err }, "Failed to process external submission");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
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

    const report = await getReportById(reportId);

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    // إذا كان "running" أو "waiting_otp" — تحقق هل يوجد جلسة فعلية في الذاكرة
    if (report.automationStatus === "running" || report.automationStatus === "waiting_otp") {
      const existingSession = getSessionByReportId(reportId);
      if (existingSession) {
        // جلسة حقيقية تعمل فعلاً
        res.status(409).json({ error: "التقرير قيد المعالجة بالفعل" });
        return;
      }
      // لا توجد جلسة — الحالة عالقة من جلسة سابقة (مثلاً إعادة تشغيل الخادم)
      // أعد الضبط وابدأ من جديد
      await updateReport(reportId, { automationStatus: "idle", automationError: "تم إعادة الضبط تلقائياً — كانت الحالة عالقة" });
    }

    if (!canStartNewSession(MAX_CONCURRENT)) {
      // المتصفح الواحد مشغول — اترك في الطابور
      await updateReport(reportId, { automationStatus: "queued" });
      res.json({ status: "queued", message: "تمت إضافة الطلب للطابور (المتصفح مشغول بطلب آخر)" });
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

    const report = await getReportById(reportId);

    if (!report) {
      res.status(404).json({ error: "Report not found" });
      return;
    }

    const session = getSessionByReportId(reportId);
    const logs = session?.logs ?? [];

    // كشف الحالة العالقة: status=running لكن لا توجد جلسة فعلية في الذاكرة
    const dbStatus = report.automationStatus ?? "idle";
    const isStale = (dbStatus === "running" || dbStatus === "waiting_otp") && !session;

    res.json({
      reportId,
      automationStatus: dbStatus,
      isStale,
      automationError:  report.automationError,
      sessionId:        report.automationSessionId,
      qrCodeBase64:     report.qrCodeBase64,
      hasCertificate:   !!report.certificatePath,
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
    const report = await getReportById(reportId);

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

    if (!canStartNewSession(MAX_CONCURRENT)) {
      // المتصفح مشغول — أضف للطابور
      await updateReport(reportId, { automationStatus: "queued", automationError: null });
      res.json({ status: "queued", message: "تمت إضافة الطلب للطابور (المتصفح مشغول بطلب آخر)" });
      return;
    }

    await updateReport(reportId, { automationStatus: "idle", automationError: null });
    const sessionId = await startAutomation(reportId);
    res.json({ sessionId, message: "تمت إعادة المحاولة" });
  } catch (err: any) {
    req.log.error({ err }, "Failed to retry automation");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// POST /api/automation/retry-bulk — إعادة المحاولة لمجموعة تقارير دفعة واحدة
// Body: { ids: number[] }
router.post("/automation/retry-bulk", async (req, res) => {
  try {
    const { ids } = req.body;
    if (!Array.isArray(ids) || ids.length === 0) {
      res.status(400).json({ error: "ids مطلوب ويجب أن يكون مصفوفة غير فارغة" });
      return;
    }

    const results: { id: number; status: string; message: string }[] = [];

    for (const rawId of ids) {
      const reportId = parseInt(String(rawId), 10);
      if (isNaN(reportId)) {
        results.push({ id: rawId, status: "error", message: "ID غير صالح" });
        continue;
      }

      try {
        const report = await getReportById(reportId);
        if (!report) {
          results.push({ id: reportId, status: "error", message: "التقرير غير موجود" });
          continue;
        }

        // كل التقارير تذهب للطابور — processQueue ستشغّل الأول فوراً والباقي بالترتيب
        await updateReport(reportId, { automationStatus: "queued", automationError: null });
        results.push({ id: reportId, status: "queued", message: "أُضيف للطابور" });
      } catch (err: any) {
        results.push({ id: reportId, status: "error", message: err.message });
      }
    }

    const queued  = results.filter(r => r.status === "queued").length;
    const errors  = results.filter(r => r.status === "error").length;

    res.json({
      message: `تم إضافة ${queued} تقرير للطابور — سيُعالَج واحداً بعد الآخر تلقائياً`,
      results,
    });

    // ابدأ معالجة الطابور في الخلفية (بدون await — لا نعيق الـ response)
    processQueue().catch(err =>
      req.log.error({ err }, "processQueue error after retry-bulk")
    );
  } catch (err: any) {
    req.log.error({ err }, "Failed to retry bulk");
    res.status(500).json({ error: err.message || "Internal server error" });
  }
});

// GET /api/automation/queue — عرض الطلبات المعلقة في الطابور
router.get("/automation/queue", async (_req, res) => {
  try {
    const queued = await getReportsByAutomationStatus("queued");
    res.json({ count: queued.length, queue: queued });
  } catch (err: any) {
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
