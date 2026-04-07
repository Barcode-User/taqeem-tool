import { Router, type IRouter } from "express";
import multer from "multer";
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
import { extractPdf } from "../lib/pdf-extractor.js";

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
const upload = multer({ storage: diskStorage, limits: { fileSize: 30 * 1024 * 1024 } });

// ─── حقول الاستخراج المطلوبة (تُستخدم في كلا النمطين) ──────────────────────
const FIELDS_SCHEMA = `{
  "reportNumber": "رقم التقرير",
  "reportDate": "تاريخ التقرير (YYYY-MM-DD)",
  "valuationDate": "تاريخ التقييم",
  "inspectionDate": "تاريخ المعاينة",
  "commissionDate": "تاريخ التكليف",
  "requestNumber": "رقم الطلب",
  "valuerName": "اسم المقيم المعتمد",
  "valuerPercentage": "نسبة مشاركة المقيم الأول (0-100)",
  "licenseNumber": "رقم الترخيص",
  "licenseDate": "تاريخ الترخيص",
  "membershipNumber": "رقم العضوية",
  "membershipType": "نوع العضوية",
  "secondValuerName": "اسم المقيم الثاني (أو null)",
  "secondValuerPercentage": "نسبة المقيم الثاني (0-100 أو null)",
  "secondValuerLicenseNumber": "رقم ترخيص المقيم الثاني",
  "secondValuerMembershipNumber": "رقم عضوية المقيم الثاني",
  "clientName": "اسم العميل",
  "clientEmail": "بريد العميل الإلكتروني",
  "clientPhone": "هاتف العميل",
  "intendedUser": "المستخدم المقصود",
  "reportType": "نوع التقرير",
  "valuationPurpose": "الغرض من التقييم",
  "valuationBasis": "أساس القيمة",
  "propertyType": "نوع العقار (أرض/شقة/فيلا/دور/مبنى تجاري)",
  "propertySubType": "النوع الفرعي",
  "region": "المنطقة الإدارية",
  "city": "المدينة",
  "district": "الحي",
  "street": "الشارع",
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
  "landArea": "مساحة الأرض بالمتر المربع (رقم فقط)",
  "buildingArea": "مساحة البناء بالمتر المربع (رقم فقط)",
  "basementArea": "مساحة القبو (رقم فقط)",
  "annexArea": "مساحة الملاحق (رقم فقط)",
  "floorsCount": "عدد الأدوار الفعلية (رقم صحيح)",
  "permittedFloorsCount": "عدد الأدوار المصرح به (رقم صحيح)",
  "permittedBuildingRatio": "نسبة البناء المصرح بها (رقم 0-100)",
  "streetWidth": "عرض الشارع بالأمتار (رقم فقط)",
  "streetFacades": "الواجهات المطلة (مثال: واجهة واحدة)",
  "utilities": "المرافق المتاحة مفصولة بفاصلة",
  "coordinates": "الإحداثيات الجغرافية",
  "valuationMethod": "أسلوب التقييم المستخدم",
  "marketValue": "القيمة بأسلوب السوق (رقم فقط)",
  "incomeValue": "القيمة بأسلوب الدخل (رقم فقط)",
  "costValue": "القيمة بأسلوب التكلفة (رقم فقط)",
  "finalValue": "القيمة النهائية المرجحة (رقم فقط)",
  "pricePerMeter": "سعر المتر المربع (رقم فقط)",
  "companyName": "اسم شركة التقييم",
  "commercialRegNumber": "رقم السجل التجاري"
}`;

const SYSTEM_PROMPT = `أنت مساعد متخصص في قراءة تقارير التقييم العقاري السعودية.
مهمتك: استخراج البيانات من التقرير وإرجاعها كـ JSON فقط بدون أي نص إضافي.
- إذا لم تجد قيمة معينة ضع null
- الأرقام ترجع أرقاماً خالصة بدون وحدات
- التواريخ بصيغة YYYY-MM-DD إذا أمكن`;

const AI_MODEL = process.env.AI_MODEL || "gpt-4.1";

/** يستدعي OpenAI بنمط النص */
async function extractWithText(text: string) {
  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `استخرج الحقول التالية من نص تقرير التقييم:\n${FIELDS_SCHEMA}\n\nنص التقرير:\n${text.slice(0, 16000)}`,
      },
    ],
  });
  return JSON.parse(response.choices[0]?.message?.content ?? "{}");
}

/** يستدعي OpenAI بنمط الصور (Vision) */
async function extractWithVision(images: string[]) {
  const imageMessages = images.map((b64) => ({
    type: "image_url" as const,
    image_url: { url: `data:image/png;base64,${b64}`, detail: "high" as const },
  }));

  const response = await openai.chat.completions.create({
    model: AI_MODEL,
    max_tokens: 4096,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `هذه صفحات من تقرير تقييم عقاري. استخرج الحقول التالية:\n${FIELDS_SCHEMA}`,
          },
          ...imageMessages,
        ],
      },
    ],
  });
  return JSON.parse(response.choices[0]?.message?.content ?? "{}");
}

/** يحوّل القيم المستخرجة لأنواع البيانات الصحيحة */
function parseExtracted(e: any) {
  const n = (v: any) => (v != null && v !== "" ? Number(v) : null);
  const s = (v: any) => (v != null && v !== "" ? String(v) : null);
  const i = (v: any) => (v != null && v !== "" ? parseInt(String(v)) : null);
  return {
    reportNumber: s(e.reportNumber),
    reportDate: s(e.reportDate),
    valuationDate: s(e.valuationDate),
    inspectionDate: s(e.inspectionDate),
    commissionDate: s(e.commissionDate),
    requestNumber: s(e.requestNumber),
    valuerName: s(e.valuerName),
    valuerPercentage: n(e.valuerPercentage),
    licenseNumber: s(e.licenseNumber),
    licenseDate: s(e.licenseDate),
    membershipNumber: s(e.membershipNumber),
    membershipType: s(e.membershipType),
    secondValuerName: s(e.secondValuerName),
    secondValuerPercentage: n(e.secondValuerPercentage),
    secondValuerLicenseNumber: s(e.secondValuerLicenseNumber),
    secondValuerMembershipNumber: s(e.secondValuerMembershipNumber),
    clientName: s(e.clientName),
    clientEmail: s(e.clientEmail),
    clientPhone: s(e.clientPhone),
    intendedUser: s(e.intendedUser),
    reportType: s(e.reportType),
    valuationPurpose: s(e.valuationPurpose),
    valuationBasis: s(e.valuationBasis),
    propertyType: s(e.propertyType),
    propertySubType: s(e.propertySubType),
    region: s(e.region),
    city: s(e.city),
    district: s(e.district),
    street: s(e.street),
    blockNumber: s(e.blockNumber),
    plotNumber: s(e.plotNumber),
    planNumber: s(e.planNumber),
    propertyUse: s(e.propertyUse),
    deedNumber: s(e.deedNumber),
    deedDate: s(e.deedDate),
    ownerName: s(e.ownerName),
    ownershipType: s(e.ownershipType),
    buildingPermitNumber: s(e.buildingPermitNumber),
    buildingStatus: s(e.buildingStatus),
    buildingAge: s(e.buildingAge),
    landArea: n(e.landArea),
    buildingArea: n(e.buildingArea),
    basementArea: n(e.basementArea),
    annexArea: n(e.annexArea),
    floorsCount: i(e.floorsCount),
    permittedFloorsCount: i(e.permittedFloorsCount),
    permittedBuildingRatio: n(e.permittedBuildingRatio),
    streetWidth: n(e.streetWidth),
    streetFacades: s(e.streetFacades),
    utilities: s(e.utilities),
    coordinates: s(e.coordinates),
    valuationMethod: s(e.valuationMethod),
    marketValue: n(e.marketValue),
    incomeValue: n(e.incomeValue),
    costValue: n(e.costValue),
    finalValue: n(e.finalValue),
    pricePerMeter: n(e.pricePerMeter),
    companyName: s(e.companyName),
    commercialRegNumber: s(e.commercialRegNumber),
  };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

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

// POST /reports/upload-base64 — رفع PDF كـ base64 JSON (يتجاوز قيود proxy على multipart)
router.post("/reports/upload-base64", async (req, res) => {
  const { pdfBase64, fileName } = req.body ?? {};
  if (!pdfBase64 || typeof pdfBase64 !== "string") {
    res.status(400).json({ error: "pdfBase64 مطلوب" });
    return;
  }

  // فك تشفير base64 وكتابة الملف على القرص
  const buffer = Buffer.from(pdfBase64, "base64");
  const safeName = (fileName ?? "report.pdf").replace(/[^a-zA-Z0-9._\-]/g, "_");
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const filePath = path.join(UPLOADS_DIR, `${unique}_${safeName}`);
  fs.writeFileSync(filePath, buffer);

  req.log.info({ file: safeName, size: buffer.length }, "PDF upload-base64 started");

  try {
    // الخطوة 1: استخراج المحتوى من PDF
    const extraction = await extractPdf(filePath, 8);
    req.log.info({ mode: extraction.mode }, "PDF extracted");

    // الخطوة 2: إرسال لـ OpenAI لاستخراج الحقول
    let raw: any;
    if (extraction.mode === "vision") {
      raw = await extractWithVision(extraction.images);
    } else {
      if (!extraction.text || extraction.text.trim().length < 50) {
        res.status(422).json({
          error: "تعذّر قراءة محتوى الملف",
          detail: "الملف لا يحتوي على نص قابل للقراءة. تأكد من رفع PDF يحتوي على نص واضح.",
        });
        return;
      }
      raw = await extractWithText(extraction.text);
    }

    // الخطوة 3: حفظ البيانات في قاعدة البيانات
    const fields = parseExtracted(raw);
    const report = await insertReport({
      ...fields,
      status: "extracted",
      pdfFileName: fileName ?? "report.pdf",
      pdfFilePath: filePath,
    });

    req.log.info({ reportId: report.id, mode: extraction.mode }, "PDF processed successfully");
    res.status(201).json({ ...report, _extractionMode: extraction.mode });
  } catch (err: any) {
    req.log.error({ err }, "PDF upload-base64/extract failed");
    res.status(500).json({ error: "حدث خطأ أثناء معالجة التقرير", detail: err?.message ?? String(err) });
  }
});

// POST /reports/upload — رفع PDF multipart (للاستخدام المحلي)
router.post("/reports/upload", upload.single("pdf"), async (req, res) => {
  if (!req.file) {
    res.status(400).json({ error: "لم يتم رفع ملف PDF" });
    return;
  }

  try {
    req.log.info({ file: req.file.originalname, size: req.file.size }, "PDF upload started");

    // ── الخطوة 1: استخراج المحتوى من PDF ──────────────────────────────────
    const extraction = await extractPdf(req.file.path, 8);
    req.log.info({ mode: extraction.mode }, "PDF extracted");

    // ── الخطوة 2: إرسال لـ OpenAI لاستخراج الحقول ─────────────────────────
    let raw: any;
    if (extraction.mode === "vision") {
      raw = await extractWithVision(extraction.images);
    } else {
      if (!extraction.text || extraction.text.trim().length < 50) {
        res.status(422).json({
          error: "تعذّر قراءة محتوى الملف",
          detail: "الملف لا يحتوي على نص قابل للقراءة وأداة تحويل الصور غير متاحة. تأكد من رفع PDF يحتوي على نص.",
        });
        return;
      }
      raw = await extractWithText(extraction.text);
    }

    // ── الخطوة 3: حفظ البيانات في قاعدة البيانات ──────────────────────────
    const fields = parseExtracted(raw);
    const report = await insertReport({
      ...fields,
      status: "extracted",
      pdfFileName: req.file.originalname,
      pdfFilePath: req.file.path,
    });

    req.log.info({ reportId: report.id, mode: extraction.mode }, "PDF processed successfully");
    res.status(201).json({ ...report, _extractionMode: extraction.mode });
  } catch (err: any) {
    req.log.error({ err }, "PDF upload/extract failed");
    const detail = err?.message ?? String(err);
    res.status(500).json({ error: "حدث خطأ أثناء معالجة التقرير", detail });
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
