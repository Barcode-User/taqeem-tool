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
  sqliteGetDataSystemByReportId,
  type DataSystemRecord,
} from "@workspace/db";
import { openai, getAIModel } from "@workspace/integrations-openai-ai-server";
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
  "intendedUser": "المستخدم المقصود = المستفيد = مستخدم التقرير = الجهة المستفيدة (ابحث عن: لمصلحة / أُعدّ لصالح / المستفيد / مستخدم التقرير)",
  "reportType": "نوع التقرير",
  "valuationPurpose": "الغرض من التقييم",
  "valuationHypothesis": "فرضية القيمة",
  "valuationBasis": "أساس القيمة (قد يكون: القيمة السوقية العادلة / القيمة العادلة / قيمة الاستمرار / القيمة السوقية)",
  "propertyType": "نوع العقار (ابحث تحت: الأصل محل التقييم / وصف العقار / نوع الأصل — مثال: أرض/شقة/فيلا/دور/مبنى)",
  "propertySubType": "النوع الفرعي للعقار",
  "region": "المنطقة الإدارية (مثال: الرياض / مكة المكرمة / المدينة المنورة — بدون كلمة منطقة)",
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

/** يُحلّل استجابة النموذج ويستخرج JSON منها حتى لو جاءت بـ markdown */
function parseAIResponse(content: string): any {
  // إزالة code blocks إن وُجدت: ```json ... ``` أو ``` ... ```
  const cleaned = content
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    // محاولة استخراج أول كتلة JSON من النص
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (match) {
      try { return JSON.parse(match[0]); } catch {}
    }
    return {};
  }
}

// ── قائمة مدن المملكة للبحث النصي ────────────────────────────────────────────
const SAUDI_CITIES = [
  "الرياض","جدة","مكة المكرمة","مكة","المدينة المنورة","المدينة","الدمام","الخبر","الظهران",
  "الأحساء","الهفوف","تبوك","بريدة","القصيم","عنيزة","الطائف","خميس مشيط","أبها","جازان",
  "نجران","حائل","الجبيل","ينبع","الرس","عرعر","سكاكا","القريات","الباحة","بيشة","الخرج",
  "المجمعة","الزلفي","شقراء","وادي الدواسر","الدوادمي","القنفذة","محايل عسير","صبيا",
  "صامطة","أبو عريش","ضباء","تيماء","العقير","الأفلاج","السليل","القوارة","الجفر","حوطة سدير",
];

/**
 * استخراج أولي بالأنماط النصية قبل إرسال للذكاء الاصطناعي.
 * يُعيد القيم التي يمكن التقاطها بموثوقية بالـ regex.
 * الذكاء الاصطناعي يُكمل ما تبقى وهذه القيم تُعطى الأولوية عند الدمج.
 */
// فاصل عام يقبل: مسافات + نقطتين + سطر جديد + مسافات
// يُغطّي الحالتين: القيمة بجانب العنوان  أو  القيمة في السطر التالي
const SEP = String.raw`[:\s]*(?:\n\r?\s*)?`;

// تحويل الأرقام العربية إلى إنجليزية
function arToEn(s: string) {
  return s.replace(/[٠-٩]/g, d => String("٠١٢٣٤٥٦٧٨٩".indexOf(d)));
}

// استخراج أول تطابق رقمي (يقبل أرقاماً في نفس السطر أو السطر التالي)
function matchNum(text: string, labelPattern: string): string | null {
  // محاولة 1: القيمة في نفس السطر  مثال: "رقم الصك: 1234"
  // محاولة 2: القيمة في السطر التالي مثال: "رقم الصك\n1234"
  const re = new RegExp(
    `(?:${labelPattern})${SEP}([0-9٠-٩][0-9٠-٩/\\-]*)`,
    "m"
  );
  const m = text.match(re);
  return m ? arToEn(m[1].trim()) : null;
}

// استخراج أول تطابق نصي (يقبل نصاً في نفس السطر أو السطر التالي)
function matchText(text: string, labelPattern: string, maxLen = 100): string | null {
  // محاولة 1: نفس السطر بعد الفاصل
  const reSameLine = new RegExp(
    `(?:${labelPattern})[:\\s]*([^\\n\\r]{3,${maxLen}})`,
    "m"
  );
  const m1 = text.match(reSameLine);
  if (m1) {
    const val = m1[1].trim();
    if (val.length >= 3) return val.replace(/\s+/g, " ");
  }
  // محاولة 2: السطر التالي مباشرة بعد العنوان
  const reNextLine = new RegExp(
    `(?:${labelPattern})[:\\s]*\\n\\r?\\s*([^\\n\\r]{3,${maxLen}})`,
    "m"
  );
  const m2 = text.match(reNextLine);
  if (m2) {
    const val = m2[1].trim();
    if (val.length >= 3) return val.replace(/\s+/g, " ");
  }
  return null;
}

function preExtractFromText(text: string): Record<string, string | null> {
  const result: Record<string, string | null> = {};
  const t = text;

  // ── رقم الصك ───────────────────────────────────────────────────────────────
  result.deedNumber = matchNum(t,
    "صك\\s*ملكية\\s*رقم|وثيقة\\s*الملكية\\s*رقم|الصك\\s*رقم|رقم\\s*صك\\s*الملكية|صك\\s*رقم|رقم\\s*الصك"
  );

  // ── رقم المخطط ─────────────────────────────────────────────────────────────
  result.planNumber = matchNum(t,
    "مخطط\\s*رقم|رقم\\s*المخطط|المخطط\\s*رقم|المخطط"
  );

  // ── رقم القطعة ─────────────────────────────────────────────────────────────
  result.plotNumber = matchNum(t,
    "قطعة\\s*رقم|رقم\\s*القطعة|القطعة\\s*رقم|رقم\\s*القطعه"
  );

  // ── رقم البلك ──────────────────────────────────────────────────────────────
  result.blockNumber = matchNum(t,
    "بلك\\s*رقم|رقم\\s*البلك|البلك\\s*رقم|البلك"
  );

  // ── رقم التقرير ─────────────────────────────────────────────────────────────
  const repNumMatch = t.match(
    /(?:رقم\s*التقرير|تقرير\s*رقم)[:\s]*(?:\n\r?\s*)?([A-Za-z0-9\-\/]+)/m
  );
  if (repNumMatch) result.reportNumber = repNumMatch[1].trim();

  // ── المدينة — بحث في قائمة المدن السعودية ──────────────────────────────────
  // أولاً: ابحث بجانب عنوان "المدينة" في نفس السطر أو السطر التالي
  const cityLabel = matchText(t, "المدينة", 40);
  if (cityLabel) {
    for (const city of SAUDI_CITIES) {
      if (cityLabel.includes(city)) { result.city = city; break; }
    }
  }
  // ثانياً: إذا لم نجد — ابحث في كامل النص
  if (!result.city) {
    for (const city of SAUDI_CITIES) {
      if (t.includes(city)) { result.city = city; break; }
    }
  }

  // ── المستخدم المقصود / المستفيد ─────────────────────────────────────────────
  const intendedVal = matchText(t,
    "المستفيد|مستخدم\\s*التقرير|الجهة\\s*المستفيدة|لمصلحة|لصالح|أُعدّ\\s*لصالح|أعد\\s*لصالح",
    120
  );
  if (intendedVal) result.intendedUser = intendedVal;

  // ── اسم المالك ──────────────────────────────────────────────────────────────
  const ownerVal = matchText(t,
    "اسم\\s*المالك|المالك|مالك\\s*العقار|صاحب\\s*الصك",
    80
  );
  if (ownerVal) result.ownerName = ownerVal;

  return result;
}

/** يُحدد هل نستخدم response_format للنموذج الحالي */
function supportsJsonMode(): boolean {
  // نماذج Groq/Llama لا تدعم response_format بشكل موثوق مع العربية
  if (process.env.GROQ_API_KEY) return false;
  return true;
}

/**
 * يحوّل سجل النظام إلى نص عربي مُنسَّق للذكاء الاصطناعي
 * يُعيد فقط الحقول غير الفارغة بصيغة:  "key: قيمة"
 */
function datasystemToText(ds: DataSystemRecord): string {
  const FIELD_LABELS: Record<string, string> = {
    reportNumber: "رقم التقرير",
    reportDate: "تاريخ التقرير",
    valuationDate: "تاريخ التقييم",
    inspectionDate: "تاريخ المعاينة",
    commissionDate: "تاريخ التكليف",
    requestNumber: "رقم الطلب",
    valuerName: "اسم المقيّم",
    valuerPercentage: "نسبة المقيّم",
    licenseNumber: "رقم الرخصة",
    licenseDate: "تاريخ الرخصة",
    membershipNumber: "رقم العضوية",
    membershipType: "نوع العضوية",
    secondValuerName: "اسم المقيّم الثاني",
    secondValuerPercentage: "نسبة المقيّم الثاني",
    secondValuerLicenseNumber: "رقم رخصة المقيّم الثاني",
    secondValuerMembershipNumber: "رقم عضوية المقيّم الثاني",
    clientName: "اسم العميل",
    clientPhone: "هاتف العميل",
    intendedUser: "المستخدم المقصود",
    reportType: "نوع التقرير",
    valuationPurpose: "الغرض من التقييم",
    valuationBasis: "أساس القيمة",
    valuationHypothesis: "فرضية القيمة",
    propertyType: "نوع العقار",
    propertySubType: "النوع الفرعي",
    region: "المنطقة",
    city: "المدينة",
    district: "الحي",
    street: "الشارع",
    blockNumber: "رقم البلك",
    plotNumber: "رقم القطعة",
    planNumber: "رقم المخطط",
    propertyUse: "استخدام العقار",
    deedNumber: "رقم الصك",
    deedDate: "تاريخ الصك",
    ownerName: "اسم المالك",
    ownershipType: "نوع الملكية",
    buildingPermitNumber: "رقم رخصة البناء",
    buildingStatus: "حالة البناء",
    buildingAge: "عمر البناء",
    landArea: "مساحة الأرض",
    buildingArea: "مساحة البناء",
    basementArea: "مساحة القبو",
    annexArea: "مساحة الملاحق",
    floorsCount: "عدد الأدوار",
    permittedFloorsCount: "الأدوار المصرح بها",
    permittedBuildingRatio: "نسبة البناء المصرح بها",
    streetWidth: "عرض الشارع",
    streetFacades: "الواجهات",
    utilities: "المرافق",
    coordinates: "الإحداثيات",
    valuationMethod: "أسلوب التقييم",
    marketValue: "القيمة السوقية",
    incomeValue: "قيمة الدخل",
    costValue: "قيمة التكلفة",
    finalValue: "القيمة النهائية",
    pricePerMeter: "سعر المتر",
    companyName: "اسم شركة التقييم",
    commercialRegNumber: "رقم السجل التجاري",
  };

  const lines: string[] = [];
  for (const [key, label] of Object.entries(FIELD_LABELS)) {
    const val = (ds as any)[key];
    if (val != null && val !== "") {
      lines.push(`${key}: ${val}  (${label})`);
    }
  }
  return lines.join("\n");
}

/** يستدعي AI بنمط النص ويدمج نتائج Regex لتعزيز الحقول الصعبة */
async function extractWithText(text: string) {
  // خطوة 1: استخراج بالأنماط النصية (سريع ودقيق لحقول محددة)
  const regexResults = preExtractFromText(text);

  // خطوة 2: استخراج بالذكاء الاصطناعي
  const useJsonMode = supportsJsonMode();
  const response = await openai.chat.completions.create({
    model: getAIModel(),
    max_tokens: 4096,
    ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: `Extract the following fields from this valuation report text.\nSchema (use EXACT English keys):\n${FIELDS_SCHEMA}\n\nReport text:\n${text.slice(0, 16000)}`,
      },
    ],
  });
  const aiResults = parseAIResponse(response.choices[0]?.message?.content ?? "{}");

  // خطوة 3: دمج النتائج — الذكاء الاصطناعي له الأولوية، Regex يملأ الفراغات (null/undefined)
  const merged: Record<string, any> = { ...aiResults };
  for (const [key, val] of Object.entries(regexResults)) {
    if (val != null && (merged[key] == null || merged[key] === "")) {
      merged[key] = val;
      console.log(`[regex-boost] ${key} = "${val}"`);
    }
  }
  return merged;
}

/**
 * استخراج موجَّه ببيانات النظام (الوضع الذكي)
 * ─────────────────────────────────────────────
 * يُرسل للذكاء الاصطناعي:
 *   (أ) بيانات النظام الحكومي كمرجع موثوق
 *   (ب) نص التقرير PDF
 * التعليمات: لكل حقل في بيانات النظام → ابحث عنه في التقرير
 *   - وجدته (أو ما يشابهه) → استخدم قيمة النظام كما هي (أدق)
 *   - لم تجده → استخرج من التقرير
 *   - الحقول غير الموجودة في النظام → استخرج من التقرير مباشرة
 */
async function extractWithDatasystem(text: string, ds: DataSystemRecord): Promise<Record<string, any>> {
  const regexResults = preExtractFromText(text);
  const dsText = datasystemToText(ds);
  const useJsonMode = supportsJsonMode();

  const DATASYSTEM_PROMPT = `${SYSTEM_PROMPT}

═══════════════════════════════════════════════════
مهمة خاصة: لديك بيانات موثوقة من النظام الحكومي
═══════════════════════════════════════════════════
البيانات التالية مصدرها النظام الحكومي (TAQEEM) — وهي أكثر دقة من قراءة التقرير مباشرة.

قاعدة العمل لكل حقل:
1. إذا كان الحقل موجوداً في بيانات النظام أدناه:
   → ابحث عن هذه القيمة (أو ما يشابهها) في نص التقرير
   → إذا وجدتها أو وجدت ما يقاربها: استخدم قيمة النظام كما هي بالضبط (لا تعدّلها)
   → إذا لم تجدها في التقرير: استخدم أيضاً قيمة النظام (ربما القيمة مختصرة أو مختلفة الكتابة)
2. إذا كان الحقل غير موجود في بيانات النظام (null أو غائب):
   → استخرجه من نص التقرير كالمعتاد

بيانات النظام الحكومي:
───────────────────────
${dsText}
───────────────────────`;

  const response = await openai.chat.completions.create({
    model: getAIModel(),
    max_tokens: 4096,
    ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: DATASYSTEM_PROMPT },
      {
        role: "user",
        content: `استخرج الحقول التالية من نص التقرير مع مراعاة بيانات النظام المذكورة أعلاه.
Schema (use EXACT English keys):
${FIELDS_SCHEMA}

نص التقرير:
${text.slice(0, 15000)}`,
      },
    ],
  });

  const aiResults = parseAIResponse(response.choices[0]?.message?.content ?? "{}");

  // دمج النتائج: AI له الأولوية، Regex يملأ الفراغات
  const merged: Record<string, any> = { ...aiResults };
  for (const [key, val] of Object.entries(regexResults)) {
    if (val != null && (merged[key] == null || merged[key] === "")) {
      merged[key] = val;
      console.log(`[regex-boost-ds] ${key} = "${val}"`);
    }
  }

  console.log(`[datasystem-extract] Used datasystem data from record #${ds.id} for guidance`);
  return merged;
}

/** يستدعي AI بنمط الصور (Vision) */
async function extractWithVision(images: string[]) {
  const useJsonMode = supportsJsonMode();
  const imageMessages = images.map((b64) => ({
    type: "image_url" as const,
    image_url: { url: `data:image/png;base64,${b64}` },
  }));

  const response = await openai.chat.completions.create({
    model: getAIModel(),
    max_tokens: 4096,
    ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      {
        role: "user",
        content: [
          {
            type: "text",
            text: `These are pages from a Saudi real estate valuation report. Extract the following fields.\nSchema (use EXACT English keys):\n${FIELDS_SCHEMA}`,
          },
          ...imageMessages,
        ],
      },
    ],
  });
  return parseAIResponse(response.choices[0]?.message?.content ?? "{}");
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
    valuationHypothesis: s(e.valuationHypothesis),
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

// ─── مخزن مؤقت للمعاينة (بدون DB) ──────────────────────────────────────────
const previewStore = new Map<string, any>();

// ─── دالة مشتركة لاستخراج PDF وإرجاع الحقول ────────────────────────────────
async function extractFieldsFromFile(filePath: string): Promise<any> {
  const extraction = await extractPdf(filePath, 8);
  const useGroq = !!process.env.GROQ_API_KEY;
  let raw: any;
  if (extraction.mode === "vision" && !useGroq) {
    raw = await extractWithVision(extraction.images);
  } else {
    let text = extraction.mode === "text" ? extraction.text : null;
    if (!text || text.trim().length < 50) {
      const { default: pdfParse } = await import("pdf-parse") as any;
      try {
        const buf = await import("fs").then(fs => fs.promises.readFile(filePath));
        const parsed = await pdfParse(buf);
        text = parsed.text ?? "";
      } catch {}
    }
    if (!text || text.trim().length < 50) {
      throw Object.assign(new Error("الملف لا يحتوي على نص قابل للقراءة"), { code: 422 });
    }
    raw = await extractWithText(text);
  }
  return parseExtracted(raw);
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

// POST /reports — حفظ تقرير (فارغ أو مكتمل من المعاينة)
router.post("/reports", async (req, res) => {
  try {
    const body = req.body ?? {};
    const fields = parseExtracted(body);
    const report = await insertReport({
      ...fields,
      reportNumber: body.reportNumber ?? fields.reportNumber ?? null,
      status: body.status ?? "extracted",
      pdfFileName: body.pdfFileName ?? null,
      pdfFilePath: body.pdfFilePath ?? null,
    });
    res.status(201).json(report);
  } catch (err: any) {
    req.log.error({ err }, "Failed to create report");
    res.status(500).json({ error: "فشل حفظ التقرير", detail: err?.message ?? String(err) });
  }
});

// ─── دالة مساعدة لتحويل base64 → ملف مؤقت ──────────────────────────────────
function saveBase64ToFile(pdfBase64: string, fileName: string): string {
  const buffer = Buffer.from(pdfBase64, "base64");
  const safeName = fileName.replace(/[^a-zA-Z0-9._\-]/g, "_");
  const unique = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const filePath = path.join(UPLOADS_DIR, `${unique}_${safeName}`);
  fs.writeFileSync(filePath, buffer);
  return filePath;
}

// POST /reports/extract-preview — استخراج فقط بدون حفظ في قاعدة البيانات
router.post("/reports/extract-preview", async (req, res) => {
  const { pdfBase64, fileName } = req.body ?? {};
  if (!pdfBase64 || typeof pdfBase64 !== "string") {
    res.status(400).json({ error: "pdfBase64 مطلوب" });
    return;
  }

  const safeName = fileName ?? "report.pdf";
  const filePath = saveBase64ToFile(pdfBase64, safeName);
  req.log.info({ file: safeName }, "PDF extract-preview started");

  try {
    const fields = await extractFieldsFromFile(filePath);
    const token = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    previewStore.set(token, { ...fields, pdfFileName: safeName, _preview: true });
    // حذف تلقائي بعد ساعة
    setTimeout(() => previewStore.delete(token), 60 * 60 * 1000);
    req.log.info({ token }, "Preview extracted successfully");
    res.status(200).json({ token, fields });
  } catch (err: any) {
    req.log.error({ err }, "PDF extract-preview failed");
    const code = err?.code === 422 ? 422 : 500;
    res.status(code).json({ error: "حدث خطأ أثناء استخراج البيانات", detail: err?.message ?? String(err) });
  }
});

// GET /reports/preview/:token — جلب بيانات المعاينة
router.get("/reports/preview/:token", (req, res) => {
  const data = previewStore.get(req.params.token);
  if (!data) {
    res.status(404).json({ error: "انتهت صلاحية المعاينة أو الرابط غير صحيح" });
    return;
  }
  res.json(data);
});

// POST /reports/upload-base64 — رفع PDF كـ base64 وحفظ في قاعدة البيانات
router.post("/reports/upload-base64", async (req, res) => {
  const { pdfBase64, fileName } = req.body ?? {};
  if (!pdfBase64 || typeof pdfBase64 !== "string") {
    res.status(400).json({ error: "pdfBase64 مطلوب" });
    return;
  }

  const safeName = fileName ?? "report.pdf";
  const filePath = saveBase64ToFile(pdfBase64, safeName);
  req.log.info({ file: safeName, size: Buffer.byteLength(pdfBase64, "base64") }, "PDF upload-base64 started");

  try {
    const fields = await extractFieldsFromFile(filePath);
    const report = await insertReport({
      ...fields,
      status: "extracted",
      pdfFileName: safeName,
      pdfFilePath: filePath,
    });
    req.log.info({ reportId: report.id }, "PDF processed successfully");
    res.status(201).json(report);
  } catch (err: any) {
    req.log.error({ err }, "PDF upload-base64/extract failed");
    const code = err?.code === 422 ? 422 : 500;
    res.status(code).json({ error: "حدث خطأ أثناء معالجة التقرير", detail: err?.message ?? String(err) });
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

// GET /reports/:id/download-pdf — تنزيل ملف PDF الأصلي
router.get("/reports/:id/download-pdf", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const report = await getReportById(id);
    if (!report) { res.status(404).json({ error: "التقرير غير موجود" }); return; }
    if (!report.pdfFilePath) { res.status(404).json({ error: "لا يوجد ملف PDF لهذا التقرير" }); return; }
    if (!fs.existsSync(report.pdfFilePath)) {
      res.status(404).json({ error: "ملف PDF غير موجود على الخادم" });
      return;
    }
    const fileName = report.pdfFileName ?? path.basename(report.pdfFilePath);
    res.download(report.pdfFilePath, fileName);
  } catch (err) {
    req.log.error({ err }, "Failed to download PDF");
    res.status(500).json({ error: "خطأ في تنزيل الملف" });
  }
});

// POST /reports/:id/upload-pdf — رفع أو استبدال ملف PDF لتقرير موجود
router.post("/reports/:id/upload-pdf", upload.single("pdf"), async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }
    const report = await getReportById(id);
    if (!report) { res.status(404).json({ error: "التقرير غير موجود" }); return; }
    if (!req.file) { res.status(400).json({ error: "لم يُرفع أي ملف" }); return; }

    const filePath = req.file.path;
    const fileName = req.file.originalname;

    // احذف الملف القديم إن وجد
    if (report.pdfFilePath && report.pdfFilePath !== filePath) {
      fs.unlink(report.pdfFilePath, () => {});
    }

    await updateReport(id, { pdfFileName: fileName, pdfFilePath: filePath });
    res.json({ ok: true, pdfFileName: fileName, pdfFilePath: filePath });
  } catch (err) {
    req.log.error({ err }, "Failed to upload PDF");
    res.status(500).json({ error: "خطأ في رفع الملف" });
  }
});

// POST /reports/:id/re-extract — إعادة الاستخراج من ملف PDF الموجود
// إذا كان التقرير مرتبطاً بسجل في النظام → يُستخدم كمرجع لتوجيه الذكاء الاصطناعي
router.post("/reports/:id/re-extract", async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    if (isNaN(id)) { res.status(400).json({ error: "Invalid ID" }); return; }

    const report = await getReportById(id);
    if (!report) { res.status(404).json({ error: "التقرير غير موجود" }); return; }

    const pdfPath: string | null = (report as any).pdfFilePath ?? null;
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      res.status(400).json({ error: "لا يوجد ملف PDF مرفق بهذا التقرير" });
      return;
    }

    // جلب سجل النظام المرتبط (إن وُجد)
    const dsRecord = await sqliteGetDataSystemByReportId(id);

    req.log.info({ reportId: id, hasDatasystem: !!dsRecord }, "Re-extract started");

    // استخراج المحتوى من PDF
    const extraction = await extractPdf(pdfPath, 8);
    let raw: any;

    if (extraction.mode === "vision" && !process.env.GROQ_API_KEY) {
      // وضع الصور: لا يدعم datasystem حالياً → استخراج عادي
      raw = await extractWithVision(extraction.images);
    } else {
      let text = extraction.mode === "text" ? extraction.text : null;
      if (!text || text.trim().length < 50) {
        const { default: pdfParse } = await import("pdf-parse") as any;
        try {
          const buf = fs.readFileSync(pdfPath);
          const parsed = await pdfParse(buf);
          text = parsed.text ?? "";
        } catch {}
      }
      if (!text || text.trim().length < 50) {
        res.status(422).json({ error: "الملف لا يحتوي على نص قابل للقراءة" });
        return;
      }
      // اختيار طريقة الاستخراج حسب وجود سجل النظام
      if (dsRecord) {
        raw = await extractWithDatasystem(text, dsRecord);
      } else {
        raw = await extractWithText(text);
      }
    }

    const fields = parseExtracted(raw);
    const updated = await updateReport(id, { ...fields, status: "extracted" });

    req.log.info({ reportId: id, usedDatasystem: !!dsRecord }, "Re-extract completed");
    res.json({ ...updated, _usedDatasystem: !!dsRecord });
  } catch (err: any) {
    req.log.error({ err }, "Re-extract failed");
    const code = err?.code === 422 ? 422 : 500;
    res.status(code).json({ error: "حدث خطأ أثناء إعادة الاستخراج", detail: err?.message ?? String(err) });
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
