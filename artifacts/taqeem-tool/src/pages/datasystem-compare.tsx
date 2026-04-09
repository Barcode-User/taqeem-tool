import { useState, useRef } from "react";
import { Upload, FileText, Loader2, CheckCircle2, AlertCircle, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

// ─── تعريف الحقول مع تسمياتها العربية ───────────────────────────────────────
const FIELD_GROUPS = [
  {
    title: "بيانات التقرير الأساسية",
    fields: [
      { key: "reportNumber", label: "رقم التقرير" },
      { key: "reportDate", label: "تاريخ التقرير", type: "date" },
      { key: "valuationDate", label: "تاريخ التقييم", type: "date" },
      { key: "inspectionDate", label: "تاريخ المعاينة", type: "date" },
      { key: "commissionDate", label: "تاريخ التكليف", type: "date" },
      { key: "requestNumber", label: "رقم الطلب" },
      { key: "reportType", label: "نوع التقرير" },
      { key: "valuationPurpose", label: "الغرض من التقييم" },
      { key: "valuationHypothesis", label: "فرضية القيمة" },
      { key: "valuationBasis", label: "أساس القيمة" },
    ],
  },
  {
    title: "بيانات المقيم",
    fields: [
      { key: "valuerName", label: "اسم المقيم" },
      { key: "valuerPercentage", label: "نسبة المقيم %", type: "number" },
      { key: "licenseNumber", label: "رقم الترخيص" },
      { key: "licenseDate", label: "تاريخ الترخيص", type: "date" },
      { key: "membershipNumber", label: "رقم العضوية" },
      { key: "membershipType", label: "نوع العضوية" },
      { key: "secondValuerName", label: "المقيم الثاني" },
      { key: "secondValuerPercentage", label: "نسبة المقيم الثاني %", type: "number" },
      { key: "secondValuerLicenseNumber", label: "ترخيص المقيم الثاني" },
      { key: "secondValuerMembershipNumber", label: "عضوية المقيم الثاني" },
      { key: "companyName", label: "اسم شركة التقييم" },
      { key: "commercialRegNumber", label: "رقم السجل التجاري" },
    ],
  },
  {
    title: "بيانات العميل",
    fields: [
      { key: "clientName", label: "اسم العميل" },
      { key: "clientEmail", label: "بريد العميل" },
      { key: "clientPhone", label: "هاتف العميل" },
      { key: "intendedUser", label: "المستخدم المقصود" },
    ],
  },
  {
    title: "بيانات العقار",
    fields: [
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
      { key: "coordinates", label: "الإحداثيات" },
    ],
  },
  {
    title: "الصك والملكية",
    fields: [
      { key: "deedNumber", label: "رقم الصك" },
      { key: "deedDate", label: "تاريخ الصك", type: "date" },
      { key: "ownerName", label: "اسم المالك" },
      { key: "ownershipType", label: "نوع الملكية" },
    ],
  },
  {
    title: "بيانات البناء",
    fields: [
      { key: "buildingPermitNumber", label: "رقم رخصة البناء" },
      { key: "buildingStatus", label: "حالة البناء" },
      { key: "buildingAge", label: "عمر البناء" },
      { key: "landArea", label: "مساحة الأرض م²", type: "number" },
      { key: "buildingArea", label: "مساحة البناء م²", type: "number" },
      { key: "basementArea", label: "مساحة القبو م²", type: "number" },
      { key: "annexArea", label: "مساحة الملاحق م²", type: "number" },
      { key: "floorsCount", label: "عدد الأدوار", type: "number" },
      { key: "permittedFloorsCount", label: "الأدوار المصرح بها", type: "number" },
      { key: "permittedBuildingRatio", label: "نسبة البناء المصرح بها %", type: "number" },
      { key: "streetWidth", label: "عرض الشارع م", type: "number" },
      { key: "streetFacades", label: "الواجهات" },
      { key: "utilities", label: "المرافق" },
    ],
  },
  {
    title: "القيمة",
    fields: [
      { key: "valuationMethod", label: "أسلوب التقييم" },
      { key: "marketValue", label: "القيمة السوقية", type: "number" },
      { key: "incomeValue", label: "قيمة الدخل", type: "number" },
      { key: "costValue", label: "قيمة التكلفة", type: "number" },
      { key: "finalValue", label: "القيمة النهائية", type: "number" },
      { key: "pricePerMeter", label: "سعر المتر", type: "number" },
    ],
  },
];

const ALL_FIELDS = FIELD_GROUPS.flatMap((g) => g.fields);

// ─── مساعدات ─────────────────────────────────────────────────────────────────
function scoreColor(score: number): string {
  if (score >= 90) return "text-green-600";
  if (score >= 60) return "text-yellow-600";
  return "text-red-600";
}
function scoreBg(score: number): string {
  if (score >= 90) return "bg-green-50 border-green-200";
  if (score >= 60) return "bg-yellow-50 border-yellow-200";
  return "bg-red-50 border-red-200";
}
function scoreBarColor(score: number): string {
  if (score >= 90) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  return "bg-red-500";
}

// ─── المكوّن الرئيسي ──────────────────────────────────────────────────────────
export default function DatasystemCompare() {
  const [formData, setFormData] = useState<Record<string, string>>({});
  const [file, setFile] = useState<File | null>(null);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const handleFieldChange = (key: string, value: string) => {
    setFormData((prev) => ({ ...prev, [key]: value }));
  };

  const toggleGroup = (title: string) => {
    setExpandedGroups((prev) => ({ ...prev, [title]: !prev[title] }));
  };

  const handleSubmit = async () => {
    if (!file) {
      toast({ variant: "destructive", title: "خطأ", description: "يجب اختيار ملف PDF" });
      return;
    }
    setLoading(true);
    setResult(null);
    try {
      const fd = new FormData();
      fd.append("file", file);
      for (const [key, value] of Object.entries(formData)) {
        if (value) fd.append(key, value);
      }
      const resp = await fetch("/api/datasystem/upload", { method: "POST", body: fd });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: resp.statusText }));
        throw new Error(err.error ?? "فشل الإرسال");
      }
      const data = await resp.json();
      setResult(data);
      toast({ title: "تم بنجاح", description: `معدل التطابق الإجمالي: ${data.averageScore}%` });
    } catch (err: any) {
      toast({ variant: "destructive", title: "خطأ", description: err.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="max-w-6xl mx-auto p-4 space-y-6" dir="rtl">
      <div className="flex items-center gap-3">
        <FileText className="h-7 w-7 text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">مقارنة بيانات النظام مع استخراج PDF</h1>
          <p className="text-sm text-muted-foreground">أدخل بيانات الشاشة، ارفع الملف، ثم قارن مع ما يستخرجه الذكاء الاصطناعي</p>
        </div>
      </div>

      {/* ── قسم الإدخال ── */}
      {!result && (
        <div className="space-y-4">
          {/* رفع الملف */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">ملف PDF</CardTitle>
            </CardHeader>
            <CardContent>
              <div
                onClick={() => fileInputRef.current?.click()}
                className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50 transition-colors"
              >
                <Upload className="h-8 w-8 mx-auto mb-2 text-gray-400" />
                {file ? (
                  <div className="flex items-center justify-center gap-2 text-blue-600">
                    <FileText className="h-4 w-4" />
                    <span className="font-medium">{file.name}</span>
                  </div>
                ) : (
                  <p className="text-sm text-gray-500">انقر لاختيار ملف PDF</p>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf"
                className="hidden"
                onChange={(e) => setFile(e.target.files?.[0] ?? null)}
              />
            </CardContent>
          </Card>

          {/* حقول البيانات */}
          {FIELD_GROUPS.map((group) => {
            const isOpen = expandedGroups[group.title] !== false;
            return (
              <Card key={group.title}>
                <CardHeader
                  className="cursor-pointer select-none"
                  onClick={() => toggleGroup(group.title)}
                >
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-base">{group.title}</CardTitle>
                    {isOpen ? <ChevronUp className="h-4 w-4 text-gray-500" /> : <ChevronDown className="h-4 w-4 text-gray-500" />}
                  </div>
                </CardHeader>
                {isOpen && (
                  <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      {group.fields.map(({ key, label, type }) => (
                        <div key={key} className="space-y-1">
                          <Label className="text-xs text-gray-600">{label}</Label>
                          <Input
                            type={type ?? "text"}
                            value={formData[key] ?? ""}
                            onChange={(e) => handleFieldChange(key, e.target.value)}
                            placeholder={label}
                            className="h-8 text-sm"
                          />
                        </div>
                      ))}
                    </div>
                  </CardContent>
                )}
              </Card>
            );
          })}

          <Button
            onClick={handleSubmit}
            disabled={loading || !file}
            className="w-full h-12 text-base"
          >
            {loading ? (
              <><Loader2 className="h-5 w-5 mr-2 animate-spin" /> جاري المعالجة...</>
            ) : (
              <><Upload className="h-5 w-5 mr-2" /> رفع وتحليل</>
            )}
          </Button>
        </div>
      )}

      {/* ── نتيجة المقارنة ── */}
      {result && (
        <div className="space-y-4">
          {/* ملخص */}
          <Card className="bg-blue-50 border-blue-200">
            <CardContent className="pt-4">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-6 w-6 text-green-600" />
                  <div>
                    <p className="font-bold text-lg">معدل التطابق الإجمالي</p>
                    <p className="text-sm text-muted-foreground">
                      datasystem #{result.datasystemId} ← تقرير #{result.reportId}
                    </p>
                  </div>
                </div>
                <div className="text-4xl font-bold text-blue-700">{result.averageScore}%</div>
              </div>
              <div className="mt-3 h-3 bg-blue-200 rounded-full overflow-hidden">
                <div
                  className={`h-full rounded-full transition-all ${scoreBarColor(result.averageScore)}`}
                  style={{ width: `${result.averageScore}%` }}
                />
              </div>
            </CardContent>
          </Card>

          <div className="flex gap-2 flex-wrap">
            <Badge variant="outline" className="text-blue-700 border-blue-300 bg-blue-50">بيانات النظام (للعرض فقط)</Badge>
            <Badge variant="outline" className="text-purple-700 border-purple-300 bg-purple-50">استخراج الذكاء الاصطناعي</Badge>
            <Button variant="outline" size="sm" onClick={() => setResult(null)}>
              إدخال جديد
            </Button>
          </div>

          {/* جدول المقارنة */}
          <Card>
            <CardContent className="pt-4 p-0">
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      <th className="text-right p-3 font-semibold text-gray-700 w-36">الحقل</th>
                      <th className="text-right p-3 font-semibold text-blue-700 w-64">بيانات النظام</th>
                      <th className="text-right p-3 font-semibold text-purple-700 w-64">استخراج AI</th>
                      <th className="text-center p-3 font-semibold text-gray-700 w-28">التطابق</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(result.comparison as any[]).map((row: any, i: number) => (
                      <tr
                        key={row.key}
                        className={`border-b ${i % 2 === 0 ? "bg-white" : "bg-gray-50/50"} hover:bg-blue-50/30 transition-colors`}
                      >
                        <td className="p-3 font-medium text-gray-700 text-xs">{row.label}</td>
                        <td className="p-3">
                          <span className="text-blue-800 bg-blue-50 rounded px-2 py-0.5 text-xs block max-w-xs truncate" title={String(row.datasystemValue ?? "")}>
                            {row.datasystemValue != null ? String(row.datasystemValue) : <span className="text-gray-400 italic">—</span>}
                          </span>
                        </td>
                        <td className="p-3">
                          <span className="text-purple-800 bg-purple-50 rounded px-2 py-0.5 text-xs block max-w-xs truncate" title={String(row.reportValue ?? "")}>
                            {row.reportValue != null ? String(row.reportValue) : <span className="text-gray-400 italic">—</span>}
                          </span>
                        </td>
                        <td className="p-3">
                          <div className="flex flex-col items-center gap-1">
                            <span className={`font-bold text-sm ${scoreColor(row.score)}`}>
                              {row.score}%
                            </span>
                            <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                              <div
                                className={`h-full rounded-full ${scoreBarColor(row.score)}`}
                                style={{ width: `${row.score}%` }}
                              />
                            </div>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
