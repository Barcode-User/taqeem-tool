import { useEffect, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { ArrowRight, CheckCircle, AlertCircle, Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";

interface FieldRow { label: string; value: any }

function Section({ title, fields }: { title: string; fields: FieldRow[] }) {
  const hasData = fields.some(f => f.value != null && f.value !== "");
  return (
    <Card className="shadow-sm">
      <CardHeader className="pb-3 pt-4 px-5">
        <CardTitle className="text-base font-semibold text-primary flex items-center gap-2">
          {title}
          {hasData
            ? <Badge variant="outline" className="text-green-600 border-green-200 text-xs">✓ تم الاستخراج</Badge>
            : <Badge variant="outline" className="text-amber-500 border-amber-200 text-xs">لم يُستخرج</Badge>
          }
        </CardTitle>
      </CardHeader>
      <CardContent className="px-5 pb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3">
          {fields.map(({ label, value }) => (
            <div key={label} className="flex flex-col gap-0.5">
              <span className="text-xs text-muted-foreground">{label}</span>
              <span className={`text-sm font-medium ${value == null || value === "" ? "text-muted-foreground italic" : ""}`}>
                {value != null && value !== "" ? String(value) : "—"}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function PreviewReport() {
  const [, params] = useRoute("/preview/:token");
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const token = params?.token;

  useEffect(() => {
    if (!token) return;
    fetch(`/api/reports/preview/${token}`)
      .then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(e.error)))
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(String(e)); setLoading(false); });
  }, [token]);

  const handleSave = async () => {
    setSaving(true);
    try {
      const r = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, status: "extracted" }),
      });
      if (!r.ok) throw new Error((await r.json()).error);
      const report = await r.json();
      toast({ title: "تم الحفظ بنجاح", description: `رقم التقرير: ${report.id}` });
      setLocation(`/reports/${report.id}`);
    } catch (e: any) {
      toast({ variant: "destructive", title: "فشل الحفظ", description: e?.message });
      setSaving(false);
    }
  };

  if (loading) return (
    <div className="flex items-center justify-center min-h-[60vh] gap-3 text-muted-foreground">
      <Loader2 className="animate-spin h-6 w-6" />
      <span>جاري تحميل نتائج الاستخراج...</span>
    </div>
  );

  if (error) return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-4">
      <AlertCircle className="h-12 w-12 text-destructive" />
      <p className="text-destructive font-medium">{error}</p>
      <Button variant="outline" onClick={() => setLocation("/upload")}>
        <ArrowRight className="h-4 w-4 ml-2" /> ارجع للرفع
      </Button>
    </div>
  );

  if (!data) return null;

  const d = data;
  const fmt = (v: any) => v != null ? String(v) : null;
  const sections = [
    {
      title: "بيانات التقرير",
      fields: [
        { label: "رقم التقرير",    value: fmt(d.reportNumber) },
        { label: "تاريخ التقرير",  value: fmt(d.reportDate) },
        { label: "تاريخ التقييم",  value: fmt(d.valuationDate) },
        { label: "تاريخ المعاينة", value: fmt(d.inspectionDate) },
        { label: "تاريخ التكليف",  value: fmt(d.commissionDate) },
        { label: "رقم الطلب",      value: fmt(d.requestNumber) },
      ],
    },
    {
      title: "بيانات المقيم",
      fields: [
        { label: "اسم المقيم",         value: fmt(d.valuerName) },
        { label: "نسبة المقيم %",      value: d.valuerPercentage },
        { label: "رقم الترخيص",        value: fmt(d.licenseNumber) },
        { label: "تاريخ الترخيص",      value: fmt(d.licenseDate) },
        { label: "رقم العضوية",         value: fmt(d.membershipNumber) },
        { label: "نوع العضوية",         value: fmt(d.membershipType) },
        { label: "المقيم الثاني",       value: fmt(d.secondValuerName) },
        { label: "نسبة المقيم الثاني %",value: d.secondValuerPercentage },
        { label: "ترخيص المقيم الثاني",value: fmt(d.secondValuerLicenseNumber) },
        { label: "عضوية المقيم الثاني",value: fmt(d.secondValuerMembershipNumber) },
      ],
    },
    {
      title: "بيانات العميل",
      fields: [
        { label: "اسم العميل",          value: fmt(d.clientName) },
        { label: "البريد الإلكتروني",   value: fmt(d.clientEmail) },
        { label: "رقم الهاتف",          value: fmt(d.clientPhone) },
        { label: "المستخدم المقصود",    value: fmt(d.intendedUser) },
        { label: "نوع التقرير",         value: fmt(d.reportType) },
        { label: "الغرض من التقييم",   value: fmt(d.valuationPurpose) },
        { label: "أساس القيمة",         value: fmt(d.valuationBasis) },
      ],
    },
    {
      title: "بيانات العقار",
      fields: [
        { label: "نوع العقار",         value: fmt(d.propertyType) },
        { label: "النوع الفرعي",       value: fmt(d.propertySubType) },
        { label: "المنطقة الإدارية",   value: fmt(d.region) },
        { label: "المدينة",            value: fmt(d.city) },
        { label: "الحي",               value: fmt(d.district) },
        { label: "الشارع",             value: fmt(d.street) },
        { label: "رقم البلك",          value: fmt(d.blockNumber) },
        { label: "رقم القطعة",         value: fmt(d.plotNumber) },
        { label: "رقم المخطط",         value: fmt(d.planNumber) },
        { label: "استخدام العقار",     value: fmt(d.propertyUse) },
        { label: "الإحداثيات",         value: fmt(d.coordinates) },
      ],
    },
    {
      title: "بيانات الصك والملكية",
      fields: [
        { label: "رقم الصك",         value: fmt(d.deedNumber) },
        { label: "تاريخ الصك",       value: fmt(d.deedDate) },
        { label: "اسم المالك",        value: fmt(d.ownerName) },
        { label: "نوع الملكية",       value: fmt(d.ownershipType) },
        { label: "رقم رخصة البناء",  value: fmt(d.buildingPermitNumber) },
      ],
    },
    {
      title: "بيانات المبنى والمساحات",
      fields: [
        { label: "حالة البناء",           value: fmt(d.buildingStatus) },
        { label: "عمر البناء",            value: fmt(d.buildingAge) },
        { label: "مساحة الأرض (م²)",     value: d.landArea },
        { label: "مساحة البناء (م²)",    value: d.buildingArea },
        { label: "مساحة القبو (م²)",     value: d.basementArea },
        { label: "مساحة الملاحق (م²)",  value: d.annexArea },
        { label: "عدد الأدوار الفعلية",  value: d.floorsCount },
        { label: "الأدوار المصرح بها",   value: d.permittedFloorsCount },
        { label: "نسبة البناء المصرح",   value: d.permittedBuildingRatio },
        { label: "عرض الشارع (م)",       value: d.streetWidth },
        { label: "الواجهات",             value: fmt(d.streetFacades) },
        { label: "المرافق",              value: fmt(d.utilities) },
      ],
    },
    {
      title: "القيمة والتقييم",
      fields: [
        { label: "أسلوب التقييم",         value: fmt(d.valuationMethod) },
        { label: "قيمة السوق",                  value: d.marketValue?.toLocaleString("ar-SA") },
        { label: "قيمة الدخل",                  value: d.incomeValue?.toLocaleString("ar-SA") },
        { label: "قيمة التكلفة",                value: d.costValue?.toLocaleString("ar-SA") },
        { label: "نسبة أسلوب السوق (%)",        value: d.marketApproachPercentage != null ? String(d.marketApproachPercentage) : undefined },
        { label: "نسبة أسلوب الدخل (%)",        value: d.incomeApproachPercentage != null ? String(d.incomeApproachPercentage) : undefined },
        { label: "نسبة أسلوب التكلفة (%)",      value: d.costApproachPercentage   != null ? String(d.costApproachPercentage)   : undefined },
        { label: "القيمة النهائية",              value: d.finalValue?.toLocaleString("ar-SA") },
        { label: "سعر المتر (ر.س)",      value: d.pricePerMeter?.toLocaleString("ar-SA") },
      ],
    },
    {
      title: "شركة التقييم",
      fields: [
        { label: "اسم الشركة",        value: fmt(d.companyName) },
        { label: "رقم السجل التجاري", value: fmt(d.commercialRegNumber) },
      ],
    },
  ];

  const extractedCount = sections.flatMap(s => s.fields).filter(f => f.value != null && f.value !== "").length;
  const totalFields = sections.flatMap(s => s.fields).length;

  return (
    <div className="max-w-4xl mx-auto mt-6 pb-12 animate-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">معاينة نتائج الاستخراج</h1>
          <p className="text-muted-foreground mt-1 text-sm">
            ملف: <span className="font-medium">{d.pdfFileName}</span>
            {" · "}استُخرج <span className="text-green-600 font-semibold">{extractedCount}</span> من {totalFields} حقلاً
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setLocation("/upload")}>
            <ArrowRight className="h-4 w-4 ml-1" /> رفع ملف آخر
          </Button>
          <Button onClick={handleSave} disabled={saving} className="bg-primary">
            {saving ? <Loader2 className="h-4 w-4 animate-spin ml-1" /> : <Save className="h-4 w-4 ml-1" />}
            حفظ في قاعدة البيانات
          </Button>
        </div>
      </div>

      {/* Progress bar */}
      <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-xl flex items-center gap-3">
        <CheckCircle className="h-5 w-5 text-green-600 flex-shrink-0" />
        <div className="flex-1">
          <div className="flex justify-between text-sm mb-1">
            <span className="font-medium text-green-800">تم الاستخراج بنجاح</span>
            <span className="text-green-700">{Math.round(extractedCount / totalFields * 100)}%</span>
          </div>
          <div className="h-2 bg-green-200 rounded-full">
            <div
              className="h-2 bg-green-500 rounded-full transition-all"
              style={{ width: `${extractedCount / totalFields * 100}%` }}
            />
          </div>
        </div>
      </div>

      {/* Sections */}
      <div className="flex flex-col gap-4">
        {sections.map(s => <Section key={s.title} title={s.title} fields={s.fields} />)}
      </div>
    </div>
  );
}
