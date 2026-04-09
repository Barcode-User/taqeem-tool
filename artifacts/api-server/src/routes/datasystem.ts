/**
 * datasystem.ts
 * Endpoint: POST /api/datasystem/upload
 * يستقبل بيانات الشاشة + ملف PDF، يحفظهما، ويقارن مع استخراج OpenAI
 */

import { Router, type IRouter } from "express";
import multer from "multer";
import * as fs from "fs";
import * as path from "path";
import {
  sqliteInsertDataSystem,
  sqliteGetDataSystemById,
  sqliteListDataSystem,
  sqliteUpdateDataSystemLinkedReport,
  insertReport,
  getReportById,
} from "@workspace/db";
import { openai, getAIModel } from "@workspace/integrations-openai-ai-server";
import { extractPdf } from "../lib/pdf-extractor.js";

const UPLOADS_DIR = path.join(process.cwd(), "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    cb(null, `ds_${unique}_${file.originalname}`);
  },
});
const upload = multer({ storage, limits: { fileSize: 30 * 1024 * 1024 } });

const router: IRouter = Router();

// ─── حقول الاستخراج ──────────────────────────────────────────────────────────
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
  "secondValuerName": "اسم المقيم الثاني أو null",
  "secondValuerPercentage": "نسبة المقيم الثاني أو null",
  "secondValuerLicenseNumber": "رقم ترخيص المقيم الثاني",
  "secondValuerMembershipNumber": "رقم عضوية المقيم الثاني",
  "clientName": "اسم العميل",
  "clientEmail": "بريد العميل",
  "clientPhone": "هاتف العميل",
  "intendedUser": "المستخدم المقصود",
  "reportType": "نوع التقرير",
  "valuationPurpose": "الغرض من التقييم",
  "valuationHypothesis": "فرضية القيمة",
  "valuationBasis": "أساس القيمة",
  "propertyType": "نوع العقار",
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
  "landArea": "مساحة الأرض بالمتر المربع",
  "buildingArea": "مساحة البناء بالمتر المربع",
  "basementArea": "مساحة القبو",
  "annexArea": "مساحة الملاحق",
  "floorsCount": "عدد الأدوار الفعلية",
  "permittedFloorsCount": "عدد الأدوار المصرح به",
  "permittedBuildingRatio": "نسبة البناء المصرح بها",
  "streetWidth": "عرض الشارع",
  "streetFacades": "الواجهات",
  "utilities": "المرافق",
  "coordinates": "الإحداثيات",
  "valuationMethod": "أسلوب التقييم",
  "marketValue": "القيمة السوقية",
  "incomeValue": "قيمة الدخل",
  "costValue": "قيمة التكلفة",
  "finalValue": "القيمة النهائية",
  "pricePerMeter": "سعر المتر",
  "companyName": "اسم شركة التقييم",
  "commercialRegNumber": "رقم السجل التجاري"
}`;

const SYSTEM_PROMPT = `أنت مساعد خبير في قراءة تقارير التقييم العقاري السعودية.
مهمتك: استخراج الحقول المطلوبة وإعادتها كـ JSON صحيح فقط.
القواعد:
- استخدم أسماء المفاتيح الإنجليزية كما هي بالضبط
- القيم يمكن أن تكون بالعربية
- إذا لم يوجد الحقل استخدم null
- الأرقام بدون وحدات
- التواريخ بصيغة YYYY-MM-DD إن أمكن
- أعد JSON فقط بدون markdown أو نص إضافي`;

function parseAIResponse(content: string): any {
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  return JSON.parse(cleaned);
}

// ─── حساب نسبة تطابق الحقول ─────────────────────────────────────────────────
function calcMatchScore(dsVal: any, aiVal: any): number {
  const a = dsVal == null ? "" : String(dsVal).trim();
  const b = aiVal == null ? "" : String(aiVal).trim();
  if (a === "" && b === "") return 100;
  if (a === "" || b === "") return 0;
  if (a === b) return 100;
  // تشابه نصي بسيط
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  let matches = 0;
  for (let i = 0; i < shorter.length; i++) {
    if (longer.includes(shorter[i])) matches++;
  }
  return Math.round((matches / longer.length) * 100);
}

// ─── قائمة الحقول القابلة للمقارنة ──────────────────────────────────────────
const COMPARE_FIELDS: { key: string; label: string }[] = [
  { key: "reportNumber", label: "رقم التقرير" },
  { key: "reportDate", label: "تاريخ التقرير" },
  { key: "valuationDate", label: "تاريخ التقييم" },
  { key: "inspectionDate", label: "تاريخ المعاينة" },
  { key: "commissionDate", label: "تاريخ التكليف" },
  { key: "requestNumber", label: "رقم الطلب" },
  { key: "valuerName", label: "اسم المقيم" },
  { key: "valuerPercentage", label: "نسبة المقيم" },
  { key: "licenseNumber", label: "رقم الترخيص" },
  { key: "licenseDate", label: "تاريخ الترخيص" },
  { key: "membershipNumber", label: "رقم العضوية" },
  { key: "membershipType", label: "نوع العضوية" },
  { key: "secondValuerName", label: "المقيم الثاني" },
  { key: "secondValuerPercentage", label: "نسبة المقيم الثاني" },
  { key: "secondValuerLicenseNumber", label: "ترخيص المقيم الثاني" },
  { key: "secondValuerMembershipNumber", label: "عضوية المقيم الثاني" },
  { key: "clientName", label: "اسم العميل" },
  { key: "clientEmail", label: "بريد العميل" },
  { key: "clientPhone", label: "هاتف العميل" },
  { key: "intendedUser", label: "المستخدم المقصود" },
  { key: "reportType", label: "نوع التقرير" },
  { key: "valuationPurpose", label: "الغرض من التقييم" },
  { key: "valuationHypothesis", label: "فرضية القيمة" },
  { key: "valuationBasis", label: "أساس القيمة" },
  { key: "propertyType", label: "نوع العقار" },
  { key: "propertySubType", label: "النوع الفرعي" },
  { key: "region", label: "المنطقة" },
  { key: "city", label: "المدينة" },
  { key: "district", label: "الحي" },
  { key: "street", label: "الشارع" },
  { key: "blockNumber", label: "رقم البلك" },
  { key: "plotNumber", label: "رقم القطعة" },
  { key: "planNumber", label: "رقم المخطط" },
  { key: "propertyUse", label: "استخدام العقار" },
  { key: "deedNumber", label: "رقم الصك" },
  { key: "deedDate", label: "تاريخ الصك" },
  { key: "ownerName", label: "اسم المالك" },
  { key: "ownershipType", label: "نوع الملكية" },
  { key: "buildingPermitNumber", label: "رقم رخصة البناء" },
  { key: "buildingStatus", label: "حالة البناء" },
  { key: "buildingAge", label: "عمر البناء" },
  { key: "landArea", label: "مساحة الأرض" },
  { key: "buildingArea", label: "مساحة البناء" },
  { key: "basementArea", label: "مساحة القبو" },
  { key: "annexArea", label: "مساحة الملاحق" },
  { key: "floorsCount", label: "عدد الأدوار" },
  { key: "permittedFloorsCount", label: "الأدوار المصرح بها" },
  { key: "permittedBuildingRatio", label: "نسبة البناء المصرح بها" },
  { key: "streetWidth", label: "عرض الشارع" },
  { key: "streetFacades", label: "الواجهات" },
  { key: "utilities", label: "المرافق" },
  { key: "coordinates", label: "الإحداثيات" },
  { key: "valuationMethod", label: "أسلوب التقييم" },
  { key: "marketValue", label: "القيمة السوقية" },
  { key: "incomeValue", label: "قيمة الدخل" },
  { key: "costValue", label: "قيمة التكلفة" },
  { key: "finalValue", label: "القيمة النهائية" },
  { key: "pricePerMeter", label: "سعر المتر" },
  { key: "companyName", label: "اسم الشركة" },
  { key: "commercialRegNumber", label: "رقم السجل التجاري" },
];

// ─── دالة مساعدة: تحوّل الـ body (JSON أو multipart) إلى بيانات موحّدة ────────
function extractFields(body: Record<string, any>, filePath: string) {
  // في حالة JSON: القيم الرقمية تأتي صحيحة بدون تحويل
  // في حالة multipart: كل شيء string فنحوّله
  const n = (v: any) => (v != null && v !== "" ? Number(v) : null);
  const s = (v: any) => (v != null && v !== "" ? String(v) : null);
  const i = (v: any) => (v != null && v !== "" ? parseInt(String(v)) : null);

  return {
    filePath,
    reportNumber:               s(body.reportNumber),
    reportDate:                 s(body.reportDate),
    valuationDate:              s(body.valuationDate),
    inspectionDate:             s(body.inspectionDate),
    commissionDate:             s(body.commissionDate),
    requestNumber:              s(body.requestNumber),
    valuerName:                 s(body.valuerName),
    valuerPercentage:           n(body.valuerPercentage),
    licenseNumber:              s(body.licenseNumber),
    licenseDate:                s(body.licenseDate),
    membershipNumber:           s(body.membershipNumber),
    membershipType:             s(body.membershipType),
    secondValuerName:           s(body.secondValuerName),
    secondValuerPercentage:     n(body.secondValuerPercentage),
    secondValuerLicenseNumber:  s(body.secondValuerLicenseNumber),
    secondValuerMembershipNumber: s(body.secondValuerMembershipNumber),
    taqeemReportNumber:         s(body.taqeemReportNumber),
    clientName:                 s(body.clientName),
    clientEmail:                s(body.clientEmail),
    clientPhone:                s(body.clientPhone),
    intendedUser:               s(body.intendedUser),
    reportType:                 s(body.reportType),
    valuationPurpose:           s(body.valuationPurpose),
    valuationHypothesis:        s(body.valuationHypothesis),
    valuationBasis:             s(body.valuationBasis),
    propertyType:               s(body.propertyType),
    propertySubType:            s(body.propertySubType),
    region:                     s(body.region),
    city:                       s(body.city),
    district:                   s(body.district),
    street:                     s(body.street),
    blockNumber:                s(body.blockNumber),
    plotNumber:                 s(body.plotNumber),
    planNumber:                 s(body.planNumber),
    propertyUse:                s(body.propertyUse),
    deedNumber:                 s(body.deedNumber),
    deedDate:                   s(body.deedDate),
    ownerName:                  s(body.ownerName),
    ownershipType:              s(body.ownershipType),
    buildingPermitNumber:       s(body.buildingPermitNumber),
    buildingStatus:             s(body.buildingStatus),
    buildingAge:                s(body.buildingAge),
    landArea:                   n(body.landArea),
    buildingArea:               n(body.buildingArea),
    basementArea:               n(body.basementArea),
    annexArea:                  n(body.annexArea),
    floorsCount:                i(body.floorsCount),
    permittedFloorsCount:       i(body.permittedFloorsCount),
    permittedBuildingRatio:     n(body.permittedBuildingRatio),
    streetWidth:                n(body.streetWidth),
    streetFacades:              s(body.streetFacades),
    utilities:                  s(body.utilities),
    coordinates:                s(body.coordinates),
    valuationMethod:            s(body.valuationMethod),
    marketValue:                n(body.marketValue),
    incomeValue:                n(body.incomeValue),
    costValue:                  n(body.costValue),
    finalValue:                 n(body.finalValue),
    pricePerMeter:              n(body.pricePerMeter),
    companyName:                s(body.companyName),
    commercialRegNumber:        s(body.commercialRegNumber),
    notes:                      s(body.notes),
    linkedReportId:             null as number | null,
  };
}

// ─── POST /api/datasystem/upload ─────────────────────────────────────────────
// يدعم طريقتين:
//   1) Content-Type: application/json   → fileBytes (base64) + جميع الحقول كـ JSON
//   2) Content-Type: multipart/form-data → file (binary) + جميع الحقول كـ form fields
router.post("/datasystem/upload", (req, res, next) => {
  const ct = req.headers["content-type"] ?? "";
  if (ct.includes("application/json")) return next(); // JSON → تجاوز multer
  return upload.single("file")(req, res, next);        // multipart → multer
}, async (req, res) => {
  try {
    const body = req.body as Record<string, any>;
    const ct = req.headers["content-type"] ?? "";
    let filePath: string;
    let originalName: string;

    if (ct.includes("application/json")) {
      // ── وضع JSON: الملف في body.fileBytes (base64) ─────────────────────
      // يقبل أي من: fileBytes أو File أو file أو pdfBytes
      const rawBytes = body.fileBytes ?? body.File ?? body.file ?? body.pdfBytes;
      if (!rawBytes) {
        res.status(400).json({ error: "مطلوب حقل الملف: fileBytes أو File أو file (base64)" });
        return;
      }
      const fileBytes = rawBytes;
      const fileName = body.fileName ?? body.FileName ?? body.filename ?? null;
      originalName = fileName ?? "report.pdf";
      const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
      filePath = path.join(UPLOADS_DIR, `ds_${unique}_${originalName}`);
      fs.writeFileSync(filePath, Buffer.from(fileBytes, "base64"));
    } else {
      // ── وضع multipart: الملف في req.file ───────────────────────────────
      const file = (req as any).file as Express.Multer.File | undefined;
      if (!file) {
        res.status(400).json({ error: "الملف مطلوب (field: file)" });
        return;
      }
      filePath = file.path;
      originalName = file.originalname;
    }

    // ── 1: حفظ بيانات الشاشة في datasystem ────────────────────────────────
    const dsData = extractFields(body, filePath);

    const dsRecord = await sqliteInsertDataSystem(dsData);

    // ── 2: استخراج نص PDF وإرساله لـ OpenAI ───────────────────────────────
    let extracted: Record<string, any> = {};
    try {
      const pdfResult = await extractPdf(filePath);
      const model = getAIModel();

      let aiResponse: string;
      if (pdfResult.mode === "text") {
        const completion = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: `استخرج هذه الحقول من التقرير التالي:\n${FIELDS_SCHEMA}\n\nنص التقرير:\n${pdfResult.text.slice(0, 12000)}`,
            },
          ],
          max_tokens: 2000,
          temperature: 0,
        });
        aiResponse = completion.choices[0]?.message?.content ?? "{}";
      } else {
        const completion = await openai.chat.completions.create({
          model,
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            {
              role: "user",
              content: [
                { type: "text", text: `استخرج هذه الحقول من الصور:\n${FIELDS_SCHEMA}` },
                ...pdfResult.images.map((img) => ({
                  type: "image_url" as const,
                  image_url: { url: `data:image/jpeg;base64,${img}`, detail: "high" as const },
                })),
              ],
            },
          ],
          max_tokens: 2000,
          temperature: 0,
        });
        aiResponse = completion.choices[0]?.message?.content ?? "{}";
      }

      extracted = parseAIResponse(aiResponse);
    } catch (aiErr: any) {
      console.error("[datasystem] خطأ في OpenAI:", aiErr.message);
      extracted = {};
    }

    // ── 3: حفظ نتيجة OpenAI في جدول reports ───────────────────────────────
    const reportRecord = await insertReport({
      ...extracted,
      pdfFilePath: filePath,
      pdfFileName: originalName,
      status: "extracted",
      automationStatus: "pending",
    });

    // ── 4: ربط datasystem بالتقرير المستخرج ──────────────────────────────
    await sqliteUpdateDataSystemLinkedReport(dsRecord.id, reportRecord.id);

    // ── 5: حساب نسب التطابق ───────────────────────────────────────────────
    const comparison = COMPARE_FIELDS.map(({ key, label }) => {
      const dsVal = (dsRecord as any)[key];
      const aiVal = extracted[key] ?? null;
      const score = calcMatchScore(dsVal, aiVal);
      return { key, label, datasystemValue: dsVal, reportValue: aiVal, score };
    });

    const avgScore = Math.round(
      comparison.reduce((s, c) => s + c.score, 0) / comparison.length
    );

    res.json({
      datasystemId: dsRecord.id,
      reportId: reportRecord.id,
      datasystem: { ...dsRecord, linkedReportId: reportRecord.id },
      report: reportRecord,
      comparison,
      averageScore: avgScore,
    });
  } catch (err: any) {
    console.error("[datasystem] خطأ:", err);
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/datasystem ───────────────────────────────────────────────────────
router.get("/datasystem", async (_req, res) => {
  try {
    const list = await sqliteListDataSystem();
    res.json(list);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ─── GET /api/datasystem/:id ──────────────────────────────────────────────────
router.get("/datasystem/:id", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const ds = await sqliteGetDataSystemById(id);
    if (!ds) { res.status(404).json({ error: "غير موجود" }); return; }

    let report = null;
    let comparison: any[] = [];
    let averageScore = 0;

    if (ds.linkedReportId) {
      report = await getReportById(ds.linkedReportId);
      if (report) {
        comparison = COMPARE_FIELDS.map(({ key, label }) => {
          const dsVal = (ds as any)[key];
          const aiVal = (report as any)[key] ?? null;
          const score = calcMatchScore(dsVal, aiVal);
          return { key, label, datasystemValue: dsVal, reportValue: aiVal, score };
        });
        averageScore = Math.round(
          comparison.reduce((s, c) => s + c.score, 0) / comparison.length
        );
      }
    }

    res.json({ datasystem: ds, report, comparison, averageScore });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
