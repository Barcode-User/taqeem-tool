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
  sqliteGetDataSystemByReportId,
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
  "intendedUser": "المستخدم المقصود = المستفيد = مستخدم التقرير = الجهة المستفيدة (ابحث عن: لمصلحة / أُعدّ لصالح / المستفيد / مستخدم التقرير)",
  "reportType": "نوع التقرير",
  "valuationPurpose": "الغرض من التقييم",
  "valuationHypothesis": "فرضية القيمة",
  "valuationBasis": "أساس القيمة (قد يكون: القيمة السوقية العادلة / القيمة العادلة / قيمة الاستمرار / القيمة السوقية)",
  "propertyType": "نوع العقار (ابحث تحت: الأصل محل التقييم / وصف العقار / نوع الأصل — مثال: أرض/شقة/فيلا/دور/مبنى)",
  "propertySubType": "النوع الفرعي للعقار",
  "region": "المنطقة الإدارية (مثال: الرياض / مكة المكرمة — بدون كلمة منطقة)",
  "city": "المدينة (استخرج اسم المدينة فقط حتى لو كانت مدمجة في العنوان — مثال: الرياض / جدة / مكة)",
  "district": "الحي",
  "street": "الشارع",
  "blockNumber": "رقم البلك",
  "plotNumber": "رقم القطعة",
  "planNumber": "رقم المخطط (ابحث عن: مخطط رقم / المخطط: / رقم المخطط في جدول وصف العقار)",
  "propertyUse": "استخدام العقار",
  "deedNumber": "رقم الصك (ابحث عن: صك ملكية رقم / وثيقة الملكية رقم / الصك رقم / رقم صك الملكية)",
  "deedDate": "تاريخ الصك",
  "ownerName": "اسم المالك",
  "ownershipType": "نوع الملكية",
  "buildingPermitNumber": "رقم رخصة البناء",
  "buildingCompletionPercentage": "نسبة اكتمال البناء % (رقم فقط)",
  "buildingType": "نوع المبنى (مثال: سكني / تجاري / صناعي / مختلط)",
  "buildingStatus": "حالة البناء",
  "buildingAge": "عمر البناء",
  "finishingStatus": "حالة التشطيب (مثال: مشطب كامل / نصف تشطيب / هيكل)",
  "furnitureStatus": "حالة الأثاث (مثال: مفروش / غير مفروش)",
  "airConditioningType": "نوع التكييف (مثال: مركزي / شباك / سبليت / بدون)",
  "isLandRented": "هل الأرض مستأجرة؟ (نعم / لا)",
  "additionalFeatures": "المزايا والإضافات الأخرى",
  "isBestUse": "هل يمثل أعلى وأفضل استخدام؟ (نعم / لا)",
  "landArea": "مساحة الأرض بالمتر المربع",
  "buildingArea": "مساحة البناء بالمتر المربع",
  "basementArea": "مساحة القبو",
  "annexArea": "مساحة الملاحق",
  "floorsCount": "عدد الأدوار الفعلية",
  "permittedFloorsCount": "عدد الأدوار المصرح به",
  "permittedBuildingRatio": "نسبة البناء المصرح بها",
  "streetWidth": "عرض الشارع",
  "streetFacades": "الواجهات",
  "facadesCount": "عدد الواجهات",
  "utilities": "المرافق",
  "coordinates": "الإحداثيات",
  "valuationMethod": "أسلوب التقييم",
  "marketValue": "القيمة السوقية (رقم فقط بدون عملة)",
  "incomeValue": "قيمة الدخل (رقم فقط)",
  "costValue": "قيمة التكلفة (رقم فقط)",
  "marketApproachPercentage": "وزن/نسبة أسلوب المقارنة % (رقم فقط)",
  "incomeApproachPercentage": "وزن/نسبة أسلوب الدخل % (رقم فقط)",
  "costApproachPercentage": "وزن/نسبة أسلوب التكلفة % (رقم فقط)",
  "finalValue": "القيمة النهائية (رقم فقط بدون عملة)",
  "pricePerMeter": "سعر المتر (رقم فقط)",
  "companyName": "اسم شركة التقييم",
  "commercialRegNumber": "رقم السجل التجاري",
  "taqeemReportNumber": "رقم تقرير تقييم الحكومي (إن وجد)",
  "notes": "ملاحظات عامة على التقرير"
}`;

const SYSTEM_PROMPT = `أنت خبير متخصص في قراءة تقارير التقييم العقاري السعودية الصادرة وفق معايير TAQEEM.
مهمتك: استخرج الحقول المطلوبة وأعدها كـ JSON صحيح فقط.

قواعد الاستخراج:
- استخدم أسماء المفاتيح الإنجليزية كما هي بالضبط
- القيم تُكتب بالعربية كما وردت في التقرير
- إذا لم يوجد الحقل استخدم null
- الأرقام بدون وحدات (مساحة، قيمة، نسبة)
- التواريخ بصيغة YYYY-MM-DD إن أمكن
- أعد JSON فقط بدون markdown أو نص إضافي

تنبيه مهم جداً عن بنية التقارير العربية:
في تقارير التقييم السعودية قد تكون قيمة الحقل:
  (أ) بجانب عنوانه في نفس السطر:  "رقم الصك: 123456"
  (ب) في السطر التالي مباشرة أسفل عنوانه:
       "رقم الصك"
       "123456"
ابحث في الحالتين دائماً.

تنبيهات مهمة للحقول الصعبة:
• intendedUser (المستخدم المقصود): يُكتب في التقارير بأسماء مختلفة مثل "المستفيد" أو "مستخدم التقرير" أو "الجهة المستفيدة" أو "لمصلحة" أو "أُعدّ لصالح" — ابحث عن أي منها — وقد تكون القيمة في السطر التالي
• city (المدينة): قد تكون مدمجة في العنوان مثل "حي الملز - الرياض" أو "مدينة جدة" — استخرج اسم المدينة فقط
• valuationBasis (أساس القيمة): يُكتب كـ "القيمة السوقية العادلة" أو "قيمة الاستمرار" أو "القيمة العادلة" أو "القيمة السوقية"
• propertyType (نوع العقار): قد يكون تحت "الأصل محل التقييم" أو "وصف العقار" أو "نوع الأصل" — استخرج النوع (أرض، شقة، فيلا، دور، مبنى تجاري...)
• planNumber (رقم المخطط): يظهر بصيغ مثل "مخطط رقم" أو "المخطط:" أو "رقم المخطط:" في جداول وصف العقار
• deedNumber (رقم الصك): يظهر كـ "صك ملكية رقم" أو "وثيقة الملكية رقم" أو "الصك رقم" أو "رقم صك الملكية"
• region (المنطقة الإدارية): مثل "منطقة الرياض" أو "المنطقة الغربية" — استخرج اسم المنطقة فقط بدون كلمة "منطقة"
• ownerName (اسم المالك): قد يكون تحت "المالك" أو "مالك العقار" أو "صاحب الصك"
• valuerName (اسم المقيم): ابحث عن الاسم بعد "المقيم المعتمد" أو "أعده" أو توقيع التقرير`;

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
  { key: "buildingCompletionPercentage", label: "نسبة اكتمال البناء %" },
  { key: "buildingType", label: "نوع المبنى" },
  { key: "finishingStatus", label: "حالة التشطيب" },
  { key: "furnitureStatus", label: "حالة الأثاث" },
  { key: "airConditioningType", label: "نوع التكييف" },
  { key: "isLandRented", label: "الأرض مستأجرة؟" },
  { key: "additionalFeatures", label: "مزايا إضافية" },
  { key: "isBestUse", label: "أعلى وأفضل استخدام؟" },
  { key: "landArea", label: "مساحة الأرض" },
  { key: "buildingArea", label: "مساحة البناء" },
  { key: "basementArea", label: "مساحة القبو" },
  { key: "annexArea", label: "مساحة الملاحق" },
  { key: "floorsCount", label: "عدد الأدوار" },
  { key: "permittedFloorsCount", label: "الأدوار المصرح بها" },
  { key: "permittedBuildingRatio", label: "نسبة البناء المصرح بها" },
  { key: "streetWidth", label: "عرض الشارع" },
  { key: "streetFacades", label: "الواجهات" },
  { key: "facadesCount", label: "عدد الواجهات" },
  { key: "utilities", label: "المرافق" },
  { key: "coordinates", label: "الإحداثيات" },
  { key: "valuationMethod", label: "أسلوب التقييم" },
  { key: "marketValue", label: "القيمة السوقية" },
  { key: "incomeValue", label: "قيمة الدخل" },
  { key: "costValue", label: "قيمة التكلفة" },
  { key: "marketApproachPercentage", label: "وزن أسلوب المقارنة %" },
  { key: "incomeApproachPercentage", label: "وزن أسلوب الدخل %" },
  { key: "costApproachPercentage", label: "وزن أسلوب التكلفة %" },
  { key: "finalValue", label: "القيمة النهائية" },
  { key: "pricePerMeter", label: "سعر المتر" },
  { key: "companyName", label: "اسم الشركة" },
  { key: "commercialRegNumber", label: "رقم السجل التجاري" },
  { key: "taqeemReportNumber", label: "رقم تقييم الحكومي" },
  { key: "notes", label: "ملاحظات" },
  { key: "valuersInput", label: "إدخال المقيمين السريع" },
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
    reportCode:                 s(body.reportCode),
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
    valuersInput:               s(body.valuersInput),
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
    buildingPermitNumber:             s(body.buildingPermitNumber),
    buildingStatus:                   s(body.buildingStatus),
    buildingAge:                      s(body.buildingAge),
    buildingCompletionPercentage:     s(body.buildingCompletionPercentage),
    buildingType:               s(body.buildingType),
    finishingStatus:            s(body.finishingStatus),
    furnitureStatus:            s(body.furnitureStatus),
    airConditioningType:        s(body.airConditioningType),
    isLandRented:               s(body.isLandRented),
    additionalFeatures:         s(body.additionalFeatures),
    isBestUse:                  s(body.isBestUse),
    landArea:                   n(body.landArea),
    buildingArea:               n(body.buildingArea),
    basementArea:               n(body.basementArea),
    annexArea:                  n(body.annexArea),
    floorsCount:                i(body.floorsCount),
    permittedFloorsCount:       i(body.permittedFloorsCount),
    permittedBuildingRatio:     n(body.permittedBuildingRatio),
    streetWidth:                n(body.streetWidth),
    streetFacades:              s(body.streetFacades),
    facadesCount:               i(body.facadesCount),
    utilities:                  s(body.utilities),
    coordinates:                s(body.coordinates),
    valuationMethod:            s(body.valuationMethod),
    marketValue:                n(body.marketValue),
    incomeValue:                n(body.incomeValue),
    costValue:                  n(body.costValue),
    marketApproachPercentage:   n(body.marketApproachPercentage),
    incomeApproachPercentage:   n(body.incomeApproachPercentage),
    costApproachPercentage:     n(body.costApproachPercentage),
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
// يُرجع قائمة datasystem مع نسبة التطابق لكل سجل
// دالة مساعدة: حساب نتائج المقارنة لسجل datasystem مع تقرير
function calcDsScores(ds: any, report: any) {
  const fieldScores: Record<string, number> = {};
  const scoreValues: number[] = [];
  COMPARE_FIELDS.forEach(({ key }) => {
    const s = calcMatchScore((ds as any)[key], (report as any)[key]);
    fieldScores[key] = s;
    scoreValues.push(s);
  });
  const averageScore = Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length);
  return { ...ds, averageScore, fieldScores };
}

router.get("/datasystem", async (req, res) => {
  try {
    // ── فلتر سريع: ?linkedReportId=X — يُعيد سجل واحد فقط ──────────────
    const linkedReportIdParam = req.query.linkedReportId;
    if (linkedReportIdParam) {
      const reportId = parseInt(linkedReportIdParam as string, 10);
      if (!isNaN(reportId)) {
        const ds = await sqliteGetDataSystemByReportId(reportId);
        if (!ds) { res.json([]); return; }
        const report = await getReportById(reportId);
        if (!report) { res.json([{ ...ds, averageScore: null, fieldScores: null }]); return; }
        res.json([calcDsScores(ds, report)]);
        return;
      }
    }

    // ── القائمة الكاملة: تحميل كل التقارير دفعة واحدة (حل N+1) ──────────
    const list = await sqliteListDataSystem();
    // جلب التقارير المحتاج إليها فقط دفعة واحدة من قاعدة البيانات
    const linkedIds = [...new Set(list.map(d => d.linkedReportId).filter(Boolean) as number[])];
    const reportsArr = await Promise.all(linkedIds.map(id => getReportById(id)));
    const reportsMap: Record<number, any> = {};
    reportsArr.forEach(r => { if (r?.id) reportsMap[r.id] = r; });

    const withScores = list.map((ds) => {
      if (!ds.linkedReportId) return { ...ds, averageScore: null, fieldScores: null };
      const report = reportsMap[ds.linkedReportId];
      if (!report) return { ...ds, averageScore: null, fieldScores: null };
      return calcDsScores(ds, report);
    });

    res.json(withScores);
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
