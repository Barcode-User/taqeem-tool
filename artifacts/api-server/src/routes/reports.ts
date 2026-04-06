import { Router, type IRouter } from "express";
import multer from "multer";
import pdfParse from "pdf-parse";
import * as fs from "fs";
import * as path from "path";
import {
  listReports,
  getReportById,
  insertReport,
  updateReport,
  deleteReport,
  getReportStats,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const diskStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    cb(null, `${unique}_${file.originalname}`);
  },
});

const router: IRouter = Router();
const upload = multer({ storage: diskStorage, limits: { fileSize: 20 * 1024 * 1024 } });

// GET /reports/stats
router.get("/reports/stats", async (req, res) => {
  try {
    const stats = await getReportStats();
    res.json(stats);
  } catch (err) {
    req.log.error({ err }, "Failed to get stats");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /reports
router.get("/reports", async (req, res) => {
  try {
    const reports = await listReports();
    res.json(reports);
  } catch (err) {
    req.log.error({ err }, "Failed to list reports");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /reports (إنشاء تقرير فارغ)
router.post("/reports", async (req, res) => {
  try {
    const body = req.body ?? {};
    const report = await insertReport({
      reportNumber: body.reportNumber ?? null,
      status: body.status ?? "pending",
    });
    res.status(201).json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to create report");
    res.status(500).json({ error: "Internal server error" });
  }
});

// POST /reports/upload — رفع PDF واستخراج البيانات بـ OpenAI
router.post("/reports/upload", upload.single("pdf"), async (req, res) => {
  try {
    if (!req.file) {
      res.status(400).json({ error: "No PDF file uploaded" });
      return;
    }

    const pdfBuffer = fs.readFileSync(req.file.path);
    const parsed = await pdfParse(pdfBuffer);
    const pdfText = parsed.text;

    const prompt = `أنت مساعد متخصص في استخراج بيانات تقارير التقييم العقاري السعودية.
استخرج البيانات التالية من نص التقرير وأرجعها بصيغة JSON فقط بدون أي نص إضافي.

إذا لم تجد قيمة لحقل معين، ضع null.

الحقول المطلوبة:
{
  "reportNumber": "رقم التقرير",
  "reportDate": "تاريخ التقرير (بصيغة YYYY-MM-DD إذا أمكن)",
  "valuationDate": "تاريخ التقييم",
  "inspectionDate": "تاريخ المعاينة",
  "commissionDate": "تاريخ التكليف",
  "requestNumber": "رقم الطلب",
  "valuerName": "اسم المقيم المعتمد",
  "licenseNumber": "رقم الترخيص",
  "licenseDate": "تاريخ الترخيص",
  "membershipNumber": "رقم العضوية",
  "membershipType": "نوع العضوية",
  "clientName": "اسم العميل",
  "clientEmail": "البريد الإلكتروني للعميل",
  "clientPhone": "رقم هاتف العميل",
  "intendedUser": "المستخدم المقصود",
  "reportType": "نوع التقرير",
  "valuationPurpose": "الغرض من التقييم / الاستخدام المقصود",
  "valuationBasis": "أساس القيمة",
  "propertyType": "نوع العقار (أرض/شقة/فيلا/دور/مبنى تجاري)",
  "propertySubType": "النوع الفرعي للعقار",
  "region": "اسم المنطقة الإدارية",
  "city": "اسم المدينة",
  "district": "اسم الحي",
  "street": "اسم الشارع",
  "blockNumber": "رقم البلك",
  "plotNumber": "رقم القطعة",
  "planNumber": "رقم المخطط",
  "propertyUse": "استخدام العقار",
  "deedNumber": "رقم الصك",
  "deedDate": "تاريخ الصك",
  "ownerName": "اسم المالك",
  "ownershipType": "نوع الملكية",
  "buildingPermitNumber": "رقم رخصة البناء",
  "buildingStatus": "حالة البناء",
  "buildingAge": "عمر البناء",
  "landArea": "مساحة الأرض (رقم فقط بالمتر المربع)",
  "buildingArea": "مساحة المباني (رقم فقط بالمتر المربع)",
  "basementArea": "مساحة القبو (رقم فقط)",
  "annexArea": "مساحة الملاحق (رقم فقط)",
  "floorsCount": "عدد الأدوار الفعلية (رقم صحيح فقط)",
  "permittedFloorsCount": "عدد الأدوار المصرح به (رقم صحيح فقط)",
  "permittedBuildingRatio": "نسبة مساحة البناء المصرح بها (رقم من 0 إلى 100، مثل 80)",
  "streetWidth": "عرض الشارع بالأمتار (رقم فقط)",
  "streetFacades": "الواجهات المطلة على الشارع (مثل: واجهة واحدة، واجهتان)",
  "utilities": "المرافق المتاحة (كهرباء، ماء، صرف صحي، ...) مفصولة بفاصلة",
  "coordinates": "الإحداثيات الجغرافية",
  "valuationMethod": "أسلوب التقييم المستخدم",
  "marketValue": "القيمة بأسلوب السوق (رقم فقط)",
  "incomeValue": "القيمة بأسلوب الدخل (رقم فقط)",
  "costValue": "القيمة بأسلوب التكلفة (رقم فقط)",
  "finalValue": "القيمة المرجحة النهائية (رقم فقط)",
  "pricePerMeter": "سعر المتر المربع (رقم فقط)",
  "valuerPercentage": "نسبة مشاركة المقيم الأول في التقرير (رقم من 0 إلى 100، مثل: 85 أو 15)",
  "secondValuerName": "اسم المقيم الثاني المشارك في التقرير (إن وجد، وإلا null)",
  "secondValuerLicenseNumber": "رقم ترخيص المقيم الثاني",
  "secondValuerMembershipNumber": "رقم عضوية المقيم الثاني",
  "secondValuerPercentage": "نسبة مشاركة المقيم الثاني (رقم من 0 إلى 100)",
  "companyName": "اسم شركة التقييم",
  "commercialRegNumber": "رقم السجل التجاري"
}

نص التقرير:
${pdfText.slice(0, 15000)}`;

    const response = await openai.chat.completions.create({
      model: "gpt-4.1",
      max_completion_tokens: 4096,
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
    });

    const extracted = JSON.parse(response.choices[0]?.message?.content ?? "{}");

    const report = await insertReport({
      reportNumber: extracted.reportNumber ?? null,
      reportDate: extracted.reportDate ?? null,
      valuationDate: extracted.valuationDate ?? null,
      inspectionDate: extracted.inspectionDate ?? null,
      commissionDate: extracted.commissionDate ?? null,
      requestNumber: extracted.requestNumber ?? null,
      status: "extracted",
      valuerName: extracted.valuerName ?? null,
      licenseNumber: extracted.licenseNumber ?? null,
      licenseDate: extracted.licenseDate ?? null,
      membershipNumber: extracted.membershipNumber ?? null,
      membershipType: extracted.membershipType ?? null,
      clientName: extracted.clientName ?? null,
      clientEmail: extracted.clientEmail ?? null,
      clientPhone: extracted.clientPhone ?? null,
      intendedUser: extracted.intendedUser ?? null,
      reportType: extracted.reportType ?? null,
      valuationPurpose: extracted.valuationPurpose ?? null,
      valuationBasis: extracted.valuationBasis ?? null,
      propertyType: extracted.propertyType ?? null,
      propertySubType: extracted.propertySubType ?? null,
      region: extracted.region ?? null,
      city: extracted.city ?? null,
      district: extracted.district ?? null,
      street: extracted.street ?? null,
      blockNumber: extracted.blockNumber ?? null,
      plotNumber: extracted.plotNumber ?? null,
      planNumber: extracted.planNumber ?? null,
      propertyUse: extracted.propertyUse ?? null,
      deedNumber: extracted.deedNumber ?? null,
      deedDate: extracted.deedDate ?? null,
      ownerName: extracted.ownerName ?? null,
      ownershipType: extracted.ownershipType ?? null,
      buildingPermitNumber: extracted.buildingPermitNumber ?? null,
      buildingStatus: extracted.buildingStatus ?? null,
      buildingAge: extracted.buildingAge ?? null,
      landArea: extracted.landArea ? Number(extracted.landArea) : null,
      buildingArea: extracted.buildingArea ? Number(extracted.buildingArea) : null,
      basementArea: extracted.basementArea ? Number(extracted.basementArea) : null,
      annexArea: extracted.annexArea ? Number(extracted.annexArea) : null,
      floorsCount: extracted.floorsCount ? parseInt(extracted.floorsCount) : null,
      permittedFloorsCount: extracted.permittedFloorsCount ? parseInt(extracted.permittedFloorsCount) : null,
      permittedBuildingRatio: extracted.permittedBuildingRatio ? Number(extracted.permittedBuildingRatio) : null,
      streetWidth: extracted.streetWidth ? Number(extracted.streetWidth) : null,
      streetFacades: extracted.streetFacades ?? null,
      utilities: extracted.utilities ?? null,
      coordinates: extracted.coordinates ?? null,
      valuationMethod: extracted.valuationMethod ?? null,
      marketValue: extracted.marketValue ? Number(extracted.marketValue) : null,
      incomeValue: extracted.incomeValue ? Number(extracted.incomeValue) : null,
      costValue: extracted.costValue ? Number(extracted.costValue) : null,
      finalValue: extracted.finalValue ? Number(extracted.finalValue) : null,
      pricePerMeter: extracted.pricePerMeter ? Number(extracted.pricePerMeter) : null,
      valuerPercentage: extracted.valuerPercentage ? Number(extracted.valuerPercentage) : null,
      secondValuerName: extracted.secondValuerName ?? null,
      secondValuerLicenseNumber: extracted.secondValuerLicenseNumber ?? null,
      secondValuerMembershipNumber: extracted.secondValuerMembershipNumber ?? null,
      secondValuerPercentage: extracted.secondValuerPercentage ? Number(extracted.secondValuerPercentage) : null,
      companyName: extracted.companyName ?? null,
      commercialRegNumber: extracted.commercialRegNumber ?? null,
      pdfFileName: req.file.originalname,
      pdfFilePath: req.file.path,
    });

    res.status(201).json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to upload and extract PDF");
    res.status(500).json({ error: "Internal server error" });
  }
});

// GET /reports/:id
router.get("/reports/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const report = await getReportById(id);
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to get report");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /reports/:id
router.patch("/reports/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const body = req.body ?? {};
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(body)) {
      if (value !== undefined) updateData[key] = value;
    }
    const report = await updateReport(id, updateData);
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to update report");
    res.status(500).json({ error: "Internal server error" });
  }
});

// DELETE /reports/:id
router.delete("/reports/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    await deleteReport(id);
    res.status(204).send();
  } catch (err) {
    req.log.error({ err }, "Failed to delete report");
    res.status(500).json({ error: "Internal server error" });
  }
});

// PATCH /reports/:id/status
router.patch("/reports/:id/status", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const { status } = req.body ?? {};
    if (!status) { res.status(400).json({ error: "status is required" }); return; }
    const report = await updateReport(id, { status });
    if (!report) { res.status(404).json({ error: "Report not found" }); return; }
    res.json(report);
  } catch (err) {
    req.log.error({ err }, "Failed to update report status");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
