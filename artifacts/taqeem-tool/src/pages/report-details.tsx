import { useEffect, useRef, useState } from "react";
import { useRoute, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";
import { useQueryClient } from "@tanstack/react-query";
import { 
  useGetReport, 
  useUpdateReport, 
  useUpdateReportStatus,
  getGetReportQueryKey,
  getListReportsQueryKey
} from "@workspace/api-client-react";
import type { Report } from "@workspace/api-client-react";

import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Textarea } from "@/components/ui/textarea";

import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

import { 
  Save, 
  ArrowRight, 
  FileCheck, 
  CheckSquare, 
  Upload, 
  FileText,
  User,
  Building,
  MapPin,
  Calculator,
  Briefcase,
  Copy,
  ExternalLink,
  Check,
  Bot,
  Loader2,
  AlertCircle,
  Download,
  KeyRound,
  RefreshCw,
  Terminal,
  ShieldCheck,
  ShieldOff,
  Settings,
  GitCompare,
  BarChart3
} from "lucide-react";
import { Link } from "wouter";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";

// Helper to handle dates and numbers properly
const stringOrNull = z.string().nullable().optional();
const numberOrNull = z.preprocess((val) => (val === "" || val === null ? null : Number(val)), z.number().nullable().optional());

const reportFormSchema = z.object({
  reportNumber: stringOrNull,
  reportDate: stringOrNull,
  valuationDate: stringOrNull,
  inspectionDate: stringOrNull,
  commissionDate: stringOrNull,
  requestNumber: stringOrNull,
  
  valuerName: stringOrNull,
  licenseNumber: stringOrNull,
  licenseDate: stringOrNull,
  membershipNumber: stringOrNull,
  membershipType: stringOrNull,
  
  clientName: stringOrNull,
  clientEmail: stringOrNull,
  clientPhone: stringOrNull,
  intendedUser: stringOrNull,
  companyName: stringOrNull,
  commercialRegNumber: stringOrNull,
  
  reportType: stringOrNull,
  valuationPurpose: stringOrNull,
  valuationHypothesis: stringOrNull,
  valuationBasis: stringOrNull,
  
  propertyType: stringOrNull,
  propertySubType: stringOrNull,
  region: stringOrNull,
  city: stringOrNull,
  district: stringOrNull,
  street: stringOrNull,
  blockNumber: stringOrNull,
  plotNumber: stringOrNull,
  planNumber: stringOrNull,
  propertyUse: stringOrNull,
  
  deedNumber: stringOrNull,
  deedDate: stringOrNull,
  ownerName: stringOrNull,
  ownershipType: stringOrNull,
  
  buildingPermitNumber: stringOrNull,
  buildingStatus: stringOrNull,
  buildingAge: stringOrNull,
  buildingType: stringOrNull,
  finishingStatus: stringOrNull,
  furnitureStatus: stringOrNull,
  airConditioningType: stringOrNull,
  isLandRented: stringOrNull,
  additionalFeatures: stringOrNull,
  isBestUse: stringOrNull,
  landArea: numberOrNull,
  buildingArea: numberOrNull,
  basementArea: numberOrNull,
  annexArea: numberOrNull,
  floorsCount: numberOrNull,
  permittedFloorsCount: numberOrNull,
  permittedBuildingRatio: numberOrNull,
  streetWidth: numberOrNull,
  streetFacades: stringOrNull,
  facadesCount: numberOrNull,
  utilities: stringOrNull,
  coordinates: stringOrNull,
  latitude:    numberOrNull,
  longitude:   numberOrNull,
  
  valuationMethod: stringOrNull,
  marketWay: stringOrNull,
  incomeWay: stringOrNull,
  costWay: stringOrNull,
  marketValue: numberOrNull,
  incomeValue: numberOrNull,
  costValue: numberOrNull,
  marketApproachPercentage: numberOrNull,
  incomeApproachPercentage: numberOrNull,
  costApproachPercentage: numberOrNull,
  finalValue: numberOrNull,
  pricePerMeter: numberOrNull,

  valuerPercentage: numberOrNull,
  secondValuerName: stringOrNull,
  secondValuerLicenseNumber: stringOrNull,
  secondValuerMembershipNumber: stringOrNull,
  secondValuerPercentage: numberOrNull,
  valuersInput: stringOrNull,

  taqeemReportNumber: stringOrNull,
  notes: stringOrNull,
});

type ReportFormValues = z.infer<typeof reportFormSchema>;

const statusMap: Record<string, { label: string, color: string, next: string | null, action: string }> = {
  pending: { label: "قيد الانتظار", color: "bg-yellow-100 text-yellow-800 border-yellow-200", next: "extracted", action: "استخراج" },
  extracted: { label: "تم الاستخراج", color: "bg-blue-100 text-blue-800 border-blue-200", next: "reviewed", action: "اعتماد المراجعة" },
  reviewed: { label: "تمت المراجعة", color: "bg-purple-100 text-purple-800 border-purple-200", next: "submitted", action: "رفع لتقييم" },
  submitted: { label: "تم الرفع", color: "bg-green-100 text-green-800 border-green-200", next: null, action: "" },
};

// ─── تعريف مجموعات الحقول للمقارنة ──────────────────────────────────────────
const COMPARE_GROUPS = [
  {
    title: "بيانات التقرير الأساسية",
    fields: [
      { key: "reportNumber",       label: "رقم التقرير" },
      { key: "reportDate",         label: "تاريخ التقرير" },
      { key: "valuationDate",      label: "تاريخ التقييم" },
      { key: "inspectionDate",     label: "تاريخ المعاينة" },
      { key: "commissionDate",     label: "تاريخ التكليف" },
      { key: "requestNumber",      label: "رقم الطلب" },
      { key: "reportType",         label: "نوع التقرير" },
      { key: "valuationPurpose",   label: "الغرض من التقييم" },
      { key: "valuationHypothesis",label: "فرضية القيمة" },
      { key: "valuationBasis",     label: "أساس القيمة" },
    ],
  },
  {
    title: "بيانات المقيم",
    fields: [
      { key: "valuerName",                  label: "اسم المقيم" },
      { key: "valuerPercentage",            label: "نسبة المقيم %" },
      { key: "licenseNumber",               label: "رقم الترخيص" },
      { key: "licenseDate",                 label: "تاريخ الترخيص" },
      { key: "membershipNumber",            label: "رقم العضوية" },
      { key: "membershipType",              label: "نوع العضوية" },
      { key: "secondValuerName",            label: "المقيم الثاني" },
      { key: "secondValuerPercentage",      label: "نسبة المقيم الثاني %" },
      { key: "secondValuerLicenseNumber",   label: "ترخيص المقيم الثاني" },
      { key: "secondValuerMembershipNumber",label: "عضوية المقيم الثاني" },
      { key: "companyName",                 label: "اسم شركة التقييم" },
      { key: "commercialRegNumber",         label: "رقم السجل التجاري" },
      { key: "valuersInput",                label: "إدخال المقيمين السريع" },
    ],
  },
  {
    title: "بيانات العميل",
    fields: [
      { key: "clientName",   label: "اسم العميل" },
      { key: "clientEmail",  label: "البريد الإلكتروني" },
      { key: "clientPhone",  label: "الهاتف" },
      { key: "intendedUser", label: "المستخدم المقصود" },
    ],
  },
  {
    title: "بيانات العقار",
    fields: [
      { key: "propertyType",    label: "نوع العقار" },
      { key: "propertySubType", label: "النوع الفرعي" },
      { key: "region",          label: "المنطقة" },
      { key: "city",            label: "المدينة" },
      { key: "district",        label: "الحي" },
      { key: "street",          label: "الشارع" },
      { key: "blockNumber",     label: "رقم البلك" },
      { key: "plotNumber",      label: "رقم القطعة" },
      { key: "planNumber",      label: "رقم المخطط" },
      { key: "propertyUse",     label: "استخدام العقار" },
      { key: "coordinates",     label: "الإحداثيات (خط العرض، خط الطول)" },
      { key: "latitude",        label: "خط العرض (Latitude)" },
      { key: "longitude",       label: "خط الطول (Longitude)" },
    ],
  },
  {
    title: "الصك والملكية",
    fields: [
      { key: "deedNumber",    label: "رقم الصك" },
      { key: "deedDate",      label: "تاريخ الصك" },
      { key: "ownerName",     label: "اسم المالك" },
      { key: "ownershipType", label: "نوع الملكية" },
    ],
  },
  {
    title: "بيانات البناء",
    fields: [
      { key: "buildingPermitNumber",    label: "رقم رخصة البناء" },
      { key: "buildingStatus",          label: "حالة البناء" },
      { key: "buildingAge",             label: "عمر البناء" },
      { key: "buildingType",            label: "نوع المبنى" },
      { key: "finishingStatus",         label: "حالة التشطيب" },
      { key: "furnitureStatus",         label: "حالة التأثيث" },
      { key: "airConditioningType",     label: "التكييف" },
      { key: "isLandRented",            label: "الأرض مستأجرة" },
      { key: "additionalFeatures",      label: "ميزات إضافية" },
      { key: "isBestUse",               label: "أفضل استخدام" },
      { key: "landArea",                label: "مساحة الأرض م²" },
      { key: "buildingArea",            label: "مساحة البناء م²" },
      { key: "basementArea",            label: "مساحة القبو م²" },
      { key: "annexArea",               label: "مساحة الملاحق م²" },
      { key: "floorsCount",             label: "عدد الأدوار" },
      { key: "permittedFloorsCount",    label: "الأدوار المصرح بها" },
      { key: "permittedBuildingRatio",  label: "نسبة البناء المصرح بها %" },
      { key: "streetWidth",             label: "عرض الشارع م" },
      { key: "streetFacades",           label: "الواجهات" },
      { key: "facadesCount",            label: "عدد الواجهات" },
      { key: "utilities",               label: "المرافق" },
    ],
  },
  {
    title: "القيمة",
    fields: [
      { key: "valuationMethod", label: "أسلوب التقييم" },
      { key: "marketWay",   label: "طريقة أسلوب السوق" },
      { key: "incomeWay",   label: "طريقة أسلوب الدخل" },
      { key: "costWay",     label: "طريقة أسلوب التكلفة" },
      { key: "marketValue",              label: "القيمة السوقية" },
      { key: "incomeValue",              label: "قيمة الدخل" },
      { key: "costValue",                label: "قيمة التكلفة" },
      { key: "marketApproachPercentage", label: "نسبة أسلوب السوق" },
      { key: "incomeApproachPercentage", label: "نسبة أسلوب الدخل" },
      { key: "costApproachPercentage",   label: "نسبة أسلوب التكلفة" },
      { key: "finalValue",               label: "القيمة النهائية" },
      { key: "pricePerMeter",            label: "سعر المتر" },
    ],
  },
];

function scoreBg(score: number) {
  if (score >= 80) return "bg-green-50 border-green-300 text-green-800";
  if (score >= 60) return "bg-yellow-50 border-yellow-300 text-yellow-800";
  if (score >= 40) return "bg-orange-50 border-orange-300 text-orange-800";
  return "bg-red-50 border-red-300 text-red-800";
}
function scoreBar(score: number) {
  if (score >= 80) return "bg-green-500";
  if (score >= 60) return "bg-yellow-500";
  if (score >= 40) return "bg-orange-500";
  return "bg-red-500";
}

function ScoreBadge({ score }: { score?: number }) {
  if (score == null) return null;
  const cls =
    score >= 80 ? "text-green-700 bg-green-50 border-green-200" :
    score >= 60 ? "text-yellow-700 bg-yellow-50 border-yellow-200" :
    score >= 40 ? "text-orange-700 bg-orange-50 border-orange-200" :
    "text-red-700 bg-red-50 border-red-200";
  return (
    <span className={`text-[10px] font-bold border rounded px-1 leading-4 ${cls}`}>
      {score}%
    </span>
  );
}

function CopyField({ label, value }: { label: string; value: string | number | null | undefined }) {
  const [copied, setCopied] = useState(false);
  const text = value != null ? String(value) : "";

  const handleCopy = () => {
    if (!text) return;
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs text-muted-foreground font-medium">{label}</span>
      <div className="flex items-center gap-2 min-h-[36px]">
        <span className={`flex-1 text-sm font-semibold px-3 py-1.5 rounded-md border ${text ? "bg-background border-border" : "bg-muted/40 border-dashed text-muted-foreground italic"}`}>
          {text || "غير محدد"}
        </span>
        {text && (
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 p-1.5 rounded-md border border-border hover:bg-muted transition-colors"
            title="نسخ"
            data-testid={`copy-${label}`}
          >
            {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5 text-muted-foreground" />}
          </button>
        )}
      </div>
    </div>
  );
}

export default function ReportDetails() {
  const [, params] = useRoute("/reports/:id");
  const [, setLocation] = useLocation();
  const id = params?.id ? parseInt(params.id, 10) : 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const { data: report, isLoading } = useGetReport(id, {
    query: {
      enabled: !!id,
      queryKey: getGetReportQueryKey(id),
      staleTime: 60_000,          // لا إعادة تحميل لمدة 60 ثانية
      refetchOnWindowFocus: false, // لا إعادة تحميل عند تبديل النوافذ
    }
  });

  const updateReport = useUpdateReport();
  const updateStatus = useUpdateReportStatus();

  // Automation state
  const [automationData, setAutomationData] = useState<any>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [taqeemSession, setTaqeemSession] = useState<{ status: string; username?: string } | null>(null);
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  // datasystem field scores + full record
  const [dsFieldScores, setDsFieldScores] = useState<Record<string, number> | null>(null);
  const [dsRecord, setDsRecord] = useState<any>(null);

  // PDF upload state
  const [pdfUploading, setPdfUploading] = useState(false);

  // Re-extract state
  const [reExtracting, setReExtracting] = useState(false);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !id) return;
    if (file.type !== "application/pdf") {
      toast({ title: "خطأ", description: "يجب اختيار ملف PDF فقط", variant: "destructive" });
      return;
    }
    setPdfUploading(true);
    try {
      const formData = new FormData();
      formData.append("pdf", file);
      const resp = await fetch(`${apiBase}/api/reports/${id}/upload-pdf`, {
        method: "POST",
        body: formData,
      });
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error(err.error ?? "فشل رفع الملف");
      }
      toast({ title: "✅ تم رفع ملف PDF بنجاح" });
      queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(id) });
    } catch (err: any) {
      toast({ title: "خطأ في الرفع", description: err.message, variant: "destructive" });
    } finally {
      setPdfUploading(false);
      e.target.value = "";
    }
  };

  const handleReExtract = async () => {
    if (!id || reExtracting) return;
    setReExtracting(true);
    try {
      const resp = await fetch(`${apiBase}/api/reports/${id}/re-extract`, { method: "POST" });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(data.error ?? "فشلت إعادة الاستخراج");
      const label = data._usedDatasystem
        ? "✅ تم إعادة الاستخراج بمساعدة بيانات النظام"
        : "✅ تم إعادة الاستخراج من التقرير";
      toast({ title: label });
      queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(id) });
    } catch (err: any) {
      toast({ title: "خطأ", description: err.message, variant: "destructive" });
    } finally {
      setReExtracting(false);
    }
  };

  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportFormSchema),
    defaultValues: {},
  });

  const automationPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchAutomationStatus = async () => {
    if (!id) return;
    try {
      const resp = await fetch(`${apiBase}/api/automation/status/${id}`);
      if (resp.ok) {
        const data = await resp.json();
        setAutomationData(data);
        if (data.automationStatus === "completed" || data.automationStatus === "submitted_taqeem" || data.automationStatus === "failed") {
          if (automationPollRef.current) clearInterval(automationPollRef.current);
          setAutomationLoading(false);
        }
      }
    } catch {}
  };

  const fetchTaqeemSession = async () => {
    try {
      const resp = await fetch(`${apiBase}/api/automation/session-status`);
      if (resp.ok) setTaqeemSession(await resp.json());
    } catch {}
  };

  useEffect(() => {
    if (id) fetchAutomationStatus();
    fetchTaqeemSession();
  }, [id]);

  // جلب سجل datasystem الكامل لهذا التقرير
  useEffect(() => {
    if (!id) return;
    fetch(`${apiBase}/api/datasystem?linkedReportId=${id}`)
      .then(r => r.json())
      .then((list: any[]) => {
        const match = list[0];
        if (!match) return;
        if (match.fieldScores) setDsFieldScores(match.fieldScores);
        setDsRecord(match);
      })
      .catch(() => {});
  }, [id]);

  const startAutomation = async () => {
    if (!id) return;
    setAutomationLoading(true);
    try {
      const resp = await fetch(`${apiBase}/api/automation/start/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (resp.ok) {
        automationPollRef.current = setInterval(fetchAutomationStatus, 2000);
        toast({ title: "بدأت عملية الرفع الآلي", description: "جارٍ تعبئة النموذج تلقائياً..." });
      } else {
        toast({ variant: "destructive", title: "خطأ", description: data.error || "فشل بدء الأتمتة" });
        setAutomationLoading(false);
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ في الاتصال", description: "تعذر الاتصال بالخادم" });
      setAutomationLoading(false);
    }
  };

  const retryAutomation = async () => {
    if (!id) return;
    setAutomationLoading(true);
    try {
      const resp = await fetch(`${apiBase}/api/automation/retry/${id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await resp.json();
      if (resp.ok) {
        automationPollRef.current = setInterval(fetchAutomationStatus, 2000);
        toast({ title: "إعادة المحاولة", description: "جارٍ الرفع مجدداً..." });
      } else {
        toast({ variant: "destructive", title: "خطأ", description: data.error });
        setAutomationLoading(false);
      }
    } catch {
      setAutomationLoading(false);
    }
  };

  const initializedForId = useRef<number | null>(null);

  useEffect(() => {
    if (report && initializedForId.current !== report.id) {
      initializedForId.current = report.id;
      // Initialize form with report data
      form.reset({
        ...report,
        // Ensure nulls are handled
      });
    }
  }, [report, form]);

  const onSubmit = (data: ReportFormValues) => {
    if (!id) return;
    
    updateReport.mutate({ id, data }, {
      onSuccess: () => {
        toast({
          title: "تم الحفظ بنجاح",
          description: "تم تحديث بيانات التقرير.",
        });
        queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
        queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(id) });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "خطأ",
          description: "لم يتم حفظ التغييرات. الرجاء المحاولة مرة أخرى.",
        });
      }
    });
  };

  const handleAdvanceStatus = () => {
    if (!report || !id) return;
    const nextStatus = statusMap[report.status]?.next;
    if (!nextStatus) return;

    // Save form data first before advancing status
    const currentData = form.getValues();
    updateReport.mutate({ id, data: currentData }, {
      onSuccess: () => {
        // Then advance status
        updateStatus.mutate({ id, data: { status: nextStatus as any } }, {
          onSuccess: () => {
            toast({
              title: "تم تحديث الحالة",
              description: `تم تغيير حالة التقرير إلى "${statusMap[nextStatus].label}"`,
            });
            queryClient.invalidateQueries({ queryKey: getListReportsQueryKey() });
            queryClient.invalidateQueries({ queryKey: getGetReportQueryKey(id) });
          }
        });
      }
    });
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center gap-4">
          <Skeleton className="h-10 w-10" />
          <Skeleton className="h-8 w-64" />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </div>
    );
  }

  if (!report) {
    return <div className="text-center py-12">لم يتم العثور على التقرير</div>;
  }

  const isEditable = report.status !== "submitted";
  const currentStatusInfo = statusMap[report.status];

  return (
    <div className="space-y-6 pb-20 animate-in fade-in duration-500">
      {/* Header Actions */}
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 sticky top-0 z-20 bg-background/95 backdrop-blur-sm py-4 border-b border-border -mx-8 px-8">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={() => setLocation("/")}>
            <ArrowRight className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-xl font-bold tracking-tight">
              {report.reportNumber ? `تقرير رقم ${report.reportNumber}` : "تقرير جديد"}
            </h1>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant="outline" className={`${currentStatusInfo?.color} font-normal`}>
                {currentStatusInfo?.label}
              </Badge>
              {report.pdfFileName ? (
                <a
                  href={`${apiBase}/api/reports/${id}/download-pdf`}
                  download={report.pdfFileName}
                  className="text-xs text-primary flex items-center gap-1 hover:underline"
                  title="تنزيل ملف التقرير الأصلي"
                >
                  <Download className="h-3 w-3" />
                  {report.pdfFileName}
                </a>
              ) : (
                <label className="text-xs text-amber-600 flex items-center gap-1 cursor-pointer hover:text-amber-700 border border-amber-300 bg-amber-50 rounded px-2 py-0.5" title="رفع ملف PDF للتقرير">
                  {pdfUploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <Upload className="h-3 w-3" />}
                  {pdfUploading ? "جارٍ الرفع..." : "رفع PDF"}
                  <input type="file" accept="application/pdf" className="hidden" onChange={handlePdfUpload} disabled={pdfUploading} />
                </label>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
          {/* زر إعادة الاستخراج — يظهر فقط عند وجود PDF */}
          {report.pdfFileName && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleReExtract}
              disabled={reExtracting}
              title={dsRecord
                ? "إعادة الاستخراج باستخدام بيانات النظام كمرجع للذكاء الاصطناعي"
                : "إعادة استخراج البيانات من ملف PDF"}
              className={`flex-1 sm:flex-none text-xs ${dsRecord ? "border-emerald-400 text-emerald-700 hover:bg-emerald-50" : "border-blue-300 text-blue-700 hover:bg-blue-50"}`}
            >
              {reExtracting
                ? <Loader2 className="h-3.5 w-3.5 animate-spin ml-1.5" />
                : <RefreshCw className="h-3.5 w-3.5 ml-1.5" />}
              {reExtracting ? "جارٍ الاستخراج..." : dsRecord ? "إعادة استخراج (بمساعدة النظام)" : "إعادة استخراج"}
            </Button>
          )}

          {isEditable && (
            <Button 
              variant="outline" 
              onClick={form.handleSubmit(onSubmit)}
              disabled={updateReport.isPending}
              className="flex-1 sm:flex-none"
            >
              {updateReport.isPending ? <Skeleton className="h-4 w-16" /> : (
                <>
                  <Save className="h-4 w-4 ml-2" />
                  حفظ التغييرات
                </>
              )}
            </Button>
          )}
          
          {currentStatusInfo?.next && (
            <Button 
              onClick={handleAdvanceStatus}
              disabled={updateStatus.isPending || updateReport.isPending}
              className="flex-1 sm:flex-none"
            >
              {currentStatusInfo.next === "reviewed" && <CheckSquare className="h-4 w-4 ml-2" />}
              {currentStatusInfo.next === "submitted" && <Upload className="h-4 w-4 ml-2" />}
              {currentStatusInfo.action}
            </Button>
          )}
        </div>
      </div>

      <Tabs defaultValue="edit" className="space-y-6">
        <TabsList className="bg-muted">
          <TabsTrigger value="edit" className="gap-2">
            <FileText className="h-4 w-4" />
            بيانات التقرير
          </TabsTrigger>
          <TabsTrigger value="taqeem" className="gap-2">
            <ExternalLink className="h-4 w-4" />
            جاهز للرفع على تقييم
          </TabsTrigger>
          <TabsTrigger value="automation" className="gap-2">
            <Bot className="h-4 w-4" />
            رفع آلي
          </TabsTrigger>
          {dsRecord && (
            <TabsTrigger value="compare" className="gap-2">
              <GitCompare className="h-4 w-4" />
              مقارنة النظام
              <span className="ml-1 inline-flex items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold w-5 h-5">
                {dsRecord.averageScore ?? ""}%
              </span>
            </TabsTrigger>
          )}
        </TabsList>

        {/* TAQEEM Submission Tab */}
        <TabsContent value="taqeem" className="space-y-6">
          <div className="rounded-xl border border-green-200 bg-green-50 dark:bg-green-950/30 dark:border-green-900 p-4 flex flex-col sm:flex-row items-start sm:items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold text-green-800 dark:text-green-300">انسخ هذه البيانات وادخلها في منصة تقييم للحصول على QR Code</p>
              <p className="text-xs text-green-700 dark:text-green-400 mt-0.5">بعد اعتماد التقرير على المنصة، احفظ رقم التقرير في الحقل أدناه</p>
            </div>
            <a
              href="https://qima.taqeem.gov.sa"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-green-700 text-white text-sm font-medium hover:bg-green-800 transition-colors shrink-0"
              data-testid="link-taqeem-platform"
            >
              <ExternalLink className="h-4 w-4" />
              فتح منصة تقييم
            </a>
          </div>

          {/* Taqeem report number save field */}
          <Card className="border-primary/30">
            <CardHeader className="bg-primary/5 border-b pb-3">
              <CardTitle className="text-sm flex items-center gap-2 text-primary">
                <CheckSquare className="h-4 w-4" />
                بعد الرفع — حفظ رقم التقرير من منصة تقييم
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-4">
              <Form {...form}>
                <form onSubmit={form.handleSubmit(onSubmit)}>
                  <div className="flex gap-3 items-end">
                    <FormField control={form.control} name="taqeemReportNumber" render={({ field }) => (
                      <FormItem className="flex-1">
                        <FormLabel>رقم التقرير على منصة تقييم</FormLabel>
                        <FormControl>
                          <Input
                            {...field}
                            value={field.value || ""}
                            placeholder="مثال: 1684622"
                            dir="ltr"
                            className="text-left"
                            data-testid="input-taqeem-report-number"
                          />
                        </FormControl>
                      </FormItem>
                    )} />
                    <Button
                      type="submit"
                      size="default"
                      disabled={updateReport.isPending}
                      data-testid="button-save-taqeem-number"
                    >
                      <Save className="h-4 w-4 ml-2" />
                      حفظ
                    </Button>
                  </div>
                </form>
              </Form>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {/* Page 1: Report Info */}
            <Card>
              <CardHeader className="bg-muted/40 border-b pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <FileCheck className="h-4 w-4 text-primary" />
                  معلومات التقرير (الصفحة الأولى في المنصة)
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <CopyField label="رقم التقرير" value={report.reportNumber} />
                <CopyField label="تاريخ إصدار التقرير" value={report.reportDate} />
                <CopyField label="تاريخ التقييم" value={report.valuationDate} />
                <CopyField label="تاريخ المعاينة" value={report.inspectionDate} />
                <CopyField label="نوع التقرير" value={report.reportType} />
                <CopyField label="غرض التقييم" value={report.valuationPurpose} />
                <CopyField label="فرضية القيمة" value={report.valuationHypothesis} />
                <CopyField label="أساس القيمة" value={report.valuationBasis} />
                <CopyField label="أسلوب التقييم" value={report.valuationMethod} />
              </CardContent>
            </Card>

            {/* Valuers */}
            <Card>
              <CardHeader className="bg-muted/40 border-b pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <User className="h-4 w-4 text-primary" />
                  بيانات المقيّمين
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 space-y-4">
                <div>
                  <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wide">المقيّم الأول</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <CopyField label="الاسم" value={report.valuerName} />
                    <CopyField label="نسبة المشاركة %" value={(report as any).valuerPercentage} />
                    <CopyField label="رقم الترخيص" value={report.licenseNumber} />
                    <CopyField label="رقم العضوية" value={report.membershipNumber} />
                  </div>
                </div>
                {(report as any).secondValuerName && (
                  <div className="border-t pt-4">
                    <p className="text-xs font-bold text-muted-foreground mb-2 uppercase tracking-wide">المقيّم الثاني</p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <CopyField label="الاسم" value={(report as any).secondValuerName} />
                      <CopyField label="نسبة المشاركة %" value={(report as any).secondValuerPercentage} />
                      <CopyField label="رقم الترخيص" value={(report as any).secondValuerLicenseNumber} />
                      <CopyField label="رقم العضوية" value={(report as any).secondValuerMembershipNumber} />
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Valuation Result */}
            <Card className="md:col-span-2 border-primary/20">
              <CardHeader className="bg-primary/5 border-b pb-3">
                <CardTitle className="text-sm flex items-center gap-2 text-primary">
                  <Calculator className="h-4 w-4" />
                  الرأي النهائي في التقييم
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <CopyField
                    label={`الرأي النهائي في ${report.propertyType || "العقار"} (ريال سعودي)`}
                    value={report.finalValue ? report.finalValue.toLocaleString("ar-SA") : null}
                  />
                </div>
                <CopyField label="سعر المتر (ريال)" value={report.pricePerMeter ? report.pricePerMeter.toLocaleString("ar-SA") : null} />
                <CopyField label="طريقة أسلوب السوق" value={report.marketWay} />
                <CopyField label="قيمة أسلوب السوق" value={report.marketValue ? report.marketValue.toLocaleString("ar-SA") : null} />
                <CopyField label="نسبة أسلوب السوق (%)" value={report.marketApproachPercentage != null ? String(report.marketApproachPercentage) : null} />
                <CopyField label="طريقة أسلوب الدخل" value={report.incomeWay} />
                <CopyField label="قيمة أسلوب الدخل" value={report.incomeValue ? report.incomeValue.toLocaleString("ar-SA") : null} />
                <CopyField label="نسبة أسلوب الدخل (%)" value={report.incomeApproachPercentage != null ? String(report.incomeApproachPercentage) : null} />
                <CopyField label="طريقة أسلوب التكلفة" value={report.costWay} />
                <CopyField label="قيمة أسلوب التكلفة" value={report.costValue ? report.costValue.toLocaleString("ar-SA") : null} />
                <CopyField label="نسبة أسلوب التكلفة (%)" value={report.costApproachPercentage != null ? String(report.costApproachPercentage) : null} />
              </CardContent>
            </Card>

            {/* Property & Location */}
            <Card>
              <CardHeader className="bg-muted/40 border-b pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <MapPin className="h-4 w-4 text-primary" />
                  موقع العقار وتفاصيله
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
                <CopyField label="نوع العقار" value={report.propertyType} />
                <CopyField label="النوع الفرعي" value={report.propertySubType} />
                <CopyField label="المنطقة" value={report.region} />
                <CopyField label="المدينة" value={report.city} />
                <CopyField label="الحي" value={report.district} />
                <CopyField label="الشارع" value={report.street} />
                <CopyField label="رقم الصك" value={report.deedNumber} />
                <CopyField label="مساحة الأرض (م²)" value={report.landArea} />
                <CopyField label="الواجهات على الشارع" value={(report as any).streetFacades} />
                <CopyField label="عدد الواجهات" value={(report as any).facadesCount} />
                <CopyField label="عرض الشارع (م)" value={(report as any).streetWidth} />
                <CopyField label="المرافق" value={(report as any).utilities} />
                <CopyField label="عدد الأدوار المصرح به" value={(report as any).permittedFloorsCount} />
                <CopyField label="نسبة البناء المصرح بها %" value={(report as any).permittedBuildingRatio} />
              </CardContent>
            </Card>

            {/* Client */}
            <Card>
              <CardHeader className="bg-muted/40 border-b pb-3">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Briefcase className="h-4 w-4 text-primary" />
                  بيانات العميل
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-4 grid grid-cols-1 gap-3">
                <CopyField label="اسم العميل" value={report.clientName} />
                <CopyField label="البريد الإلكتروني" value={(report as any).clientEmail} />
                <CopyField label="رقم الهاتف" value={(report as any).clientPhone} />
                <CopyField label="المستخدم المعتمد" value={report.intendedUser} />
                <CopyField label="اسم الشركة" value={report.companyName} />
                <CopyField label="رقم السجل التجاري" value={report.commercialRegNumber} />
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* Automation Tab */}
        <TabsContent value="automation" className="space-y-6">

          {/* Session Status Banner */}
          {taqeemSession && taqeemSession.status !== "authenticated" ? (
            <div className="rounded-lg bg-amber-50 border border-amber-200 text-amber-800 p-4 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ShieldOff className="h-5 w-5 shrink-0" />
                <div>
                  <p className="font-semibold text-sm">لم تسجّل الدخول لمنصة تقييم بعد</p>
                  <p className="text-xs mt-0.5 opacity-80">يجب تسجيل الدخول مرة واحدة قبل رفع أي تقرير</p>
                </div>
              </div>
              <Link href="/taqeem-session">
                <button className="shrink-0 flex items-center gap-1.5 text-xs font-medium bg-amber-600 text-white rounded px-3 py-1.5 hover:bg-amber-700 transition-colors">
                  <Settings className="h-3.5 w-3.5" />
                  تسجيل الدخول
                </button>
              </Link>
            </div>
          ) : taqeemSession?.status === "authenticated" ? (
            <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 p-3 flex items-center gap-3">
              <ShieldCheck className="h-4 w-4 shrink-0" />
              <p className="text-sm">
                الجلسة نشطة{taqeemSession.username ? ` — ${taqeemSession.username}` : ""} — جاهز للرفع الفوري
              </p>
            </div>
          ) : null}

          <Card>
            <CardHeader className="bg-muted/40 border-b pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Bot className="h-5 w-5 text-primary" />
                الرفع الآلي على منصة تقييم
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-6 space-y-6">

              {/* رقم تقييم الحكومي — يظهر دائماً عند وجوده */}
              {automationData?.taqeemReportNumber && (
                <div className="rounded-xl p-5 bg-emerald-50 border-2 border-emerald-400 flex items-center gap-4">
                  <div className="h-12 w-12 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                    <Check className="h-6 w-6" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-emerald-900 font-bold text-base">🏆 تم الرفع على منصة تقييم</p>
                    <p className="text-emerald-700 text-xs mt-0.5">رقم الطلب في نظام قيمة</p>
                    <p className="font-mono text-2xl font-extrabold text-emerald-800 mt-1 tracking-wider select-all">
                      {automationData.taqeemReportNumber}
                    </p>
                    {automationData.taqeemSubmittedAt && (
                      <p className="text-xs text-emerald-600 mt-1">
                        وقت الإرسال: {new Date(automationData.taqeemSubmittedAt).toLocaleString("ar-SA")}
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* Automation Status Banner */}
              {automationData && automationData.automationStatus !== "idle" && (
                <div className={`rounded-lg p-4 flex items-center gap-3 ${
                  automationData.automationStatus === "submitted_taqeem" ? "bg-emerald-50 border border-emerald-300 text-emerald-900" :
                  automationData.automationStatus === "completed" ? "bg-green-50 border border-green-200 text-green-800" :
                  automationData.automationStatus === "failed" ? "bg-red-50 border border-red-200 text-red-800" :
                  automationData.isStale ? "bg-yellow-50 border border-yellow-300 text-yellow-800" :
                  automationData.automationStatus === "running" ? "bg-blue-50 border border-blue-200 text-blue-800" :
                  "bg-muted border"
                }`}>
                  {automationData.isStale && <AlertCircle className="h-5 w-5 shrink-0" />}
                  {!automationData.isStale && (automationData.automationStatus === "running" || automationLoading) && <Loader2 className="h-5 w-5 animate-spin shrink-0" />}
                  {(automationData.automationStatus === "completed" || automationData.automationStatus === "submitted_taqeem") && <Check className="h-5 w-5 shrink-0" />}
                  {automationData.automationStatus === "failed" && !automationData.isStale && <AlertCircle className="h-5 w-5 shrink-0" />}
                  <div>
                    <p className="font-semibold text-sm">
                      {automationData.isStale && "⚠️ توقفت عملية الرفع (أُعيد تشغيل الخادم) — اضغط «ابدأ الرفع» مجدداً"}
                      {!automationData.isStale && automationData.automationStatus === "running" && "جارٍ الرفع الآلي..."}
                      {automationData.automationStatus === "submitted_taqeem" && "🏆 تم الرفع لتقييم بنجاح"}
                      {automationData.automationStatus === "completed" && "✅ اكتملت العملية بنجاح!"}
                      {!automationData.isStale && automationData.automationStatus === "failed" && "❌ فشلت العملية"}
                    </p>
                    {automationData.automationError && !automationData.isStale && (
                      <p className="text-xs mt-1 opacity-80">{automationData.automationError}</p>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex flex-wrap gap-3">
                <Button
                  onClick={startAutomation}
                  disabled={
                    automationLoading ||
                    (automationData?.automationStatus === "running" && !automationData?.isStale) ||
                    taqeemSession?.status !== "authenticated"
                  }
                  className="gap-2"
                >
                  {automationLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Bot className="h-4 w-4" />}
                  {(automationData?.automationStatus === "completed" || automationData?.automationStatus === "submitted_taqeem") ? "إعادة الرفع" : "ابدأ الرفع الآلي"}
                </Button>

                {automationData?.automationStatus === "failed" && (
                  <Button
                    variant="outline"
                    onClick={retryAutomation}
                    disabled={automationLoading || taqeemSession?.status !== "authenticated"}
                    className="gap-2"
                  >
                    <RefreshCw className="h-4 w-4" />
                    إعادة المحاولة
                  </Button>
                )}

                <Button variant="ghost" size="sm" onClick={() => { fetchAutomationStatus(); fetchTaqeemSession(); }} className="gap-2">
                  <RefreshCw className="h-4 w-4" />
                  تحديث
                </Button>
              </div>

              {/* QR Code */}
              {automationData?.qrCodeBase64 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Check className="h-4 w-4 text-green-600" />
                    QR Code المستخرج من المنصة
                  </p>
                  <div className="inline-block border-2 border-green-200 rounded-xl p-3 bg-white">
                    <img src={automationData.qrCodeBase64} alt="QR Code" className="w-48 h-48 object-contain" />
                  </div>
                </div>
              )}

              {/* Certificate Download */}
              {automationData?.hasCertificate && (
                <div>
                  <a
                    href={`${apiBase}/api/automation/certificate/${id}`}
                    download
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-md bg-primary text-primary-foreground text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Download className="h-4 w-4" />
                    تحميل الشهادة (PDF)
                  </a>
                </div>
              )}

              {/* Logs */}
              {automationData?.logs?.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm font-semibold flex items-center gap-2">
                    <Terminal className="h-4 w-4" />
                    سجل العمليات
                  </p>
                  <div className="bg-slate-950 text-green-400 rounded-lg p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto" dir="ltr">
                    {automationData.logs.map((log: string, i: number) => (
                      <div key={i}>{log}</div>
                    ))}
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* Edit Tab */}
        <TabsContent value="edit">
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-8">
          
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
            
            {/* Section 1: Report Info */}
            <Card>
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <FileCheck className="h-5 w-5 text-primary" />
                  معلومات التقرير
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-2 gap-4">
                <FormField control={form.control} name="reportNumber" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">رقم التقرير<ScoreBadge score={dsFieldScores?.reportNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="requestNumber" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">رقم الطلب<ScoreBadge score={dsFieldScores?.requestNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="reportDate" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">تاريخ التقرير<ScoreBadge score={dsFieldScores?.reportDate} /></FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="valuationDate" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">تاريخ التقييم<ScoreBadge score={dsFieldScores?.valuationDate} /></FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="inspectionDate" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">تاريخ المعاينة<ScoreBadge score={dsFieldScores?.inspectionDate} /></FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="reportType" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">نوع التقرير<ScoreBadge score={dsFieldScores?.reportType} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="valuationPurpose" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">غرض التقييم<ScoreBadge score={dsFieldScores?.valuationPurpose} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="valuationHypothesis" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">فرضية القيمة<ScoreBadge score={dsFieldScores?.valuationHypothesis} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="valuationBasis" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">أساس القيمة<ScoreBadge score={dsFieldScores?.valuationBasis} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
              </CardContent>
            </Card>

            {/* Section 2: Property Location */}
            <Card>
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <MapPin className="h-5 w-5 text-primary" />
                  موقع العقار
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-2 gap-4">
                <FormField control={form.control} name="region" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">المنطقة<ScoreBadge score={dsFieldScores?.region} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">المدينة<ScoreBadge score={dsFieldScores?.city} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="district" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">الحي<ScoreBadge score={dsFieldScores?.district} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="street" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">الشارع<ScoreBadge score={dsFieldScores?.street} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="blockNumber" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">رقم البلك<ScoreBadge score={dsFieldScores?.blockNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="plotNumber" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">رقم القطعة<ScoreBadge score={dsFieldScores?.plotNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="planNumber" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">رقم المخطط<ScoreBadge score={dsFieldScores?.planNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="coordinates" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">الإحداثيات<ScoreBadge score={dsFieldScores?.coordinates} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} dir="ltr" className="text-left" placeholder="24.7136, 46.6753" /></FormControl></FormItem>
                )} />
              </CardContent>
            </Card>

            {/* Section 3: Property Details */}
            <Card className="xl:col-span-2">
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Building className="h-5 w-5 text-primary" />
                  تفاصيل العقار والصك
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-3 lg:grid-cols-4 gap-4">
                <FormField control={form.control} name="propertyType" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">نوع العقار<ScoreBadge score={dsFieldScores?.propertyType} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="propertySubType" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">النوع الفرعي<ScoreBadge score={dsFieldScores?.propertySubType} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="propertyUse" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">الاستخدام<ScoreBadge score={dsFieldScores?.propertyUse} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="deedNumber" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">رقم الصك<ScoreBadge score={dsFieldScores?.deedNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="deedDate" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">تاريخ الصك<ScoreBadge score={dsFieldScores?.deedDate} /></FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="ownerName" render={({ field }) => (
                  <FormItem className="md:col-span-2"><FormLabel className="flex items-center gap-1.5">اسم المالك<ScoreBadge score={dsFieldScores?.ownerName} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="ownershipType" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">نوع الملكية<ScoreBadge score={dsFieldScores?.ownershipType} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <div className="col-span-full my-2"><Separator /></div>
                
                <FormField control={form.control} name="buildingPermitNumber" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">رقم رخصة البناء<ScoreBadge score={dsFieldScores?.buildingPermitNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="buildingStatus" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">حالة البناء<ScoreBadge score={dsFieldScores?.buildingStatus} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="buildingAge" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">عمر البناء<ScoreBadge score={dsFieldScores?.buildingAge} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="buildingType" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">نوع المبنى<ScoreBadge score={dsFieldScores?.buildingType} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="مثال: فيلا، شقة، تجاري" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="finishingStatus" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">حالة التشطيب<ScoreBadge score={dsFieldScores?.finishingStatus} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="مثال: كامل، جزئي، بدون تشطيب" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="furnitureStatus" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">حالة التأثيث<ScoreBadge score={dsFieldScores?.furnitureStatus} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="مثال: مؤثث، غير مؤثث" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="airConditioningType" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">التكييف<ScoreBadge score={dsFieldScores?.airConditioningType} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="مثال: مركزي، سبليت، بدون" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="isLandRented" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">الأرض تحت المبنى مستأجرة<ScoreBadge score={dsFieldScores?.isLandRented} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="نعم / لا" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="isBestUse" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">يعتبر الاستخدام الحالي أفضل استخدام<ScoreBadge score={dsFieldScores?.isBestUse} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="نعم / لا" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="additionalFeatures" render={({ field }) => (
                  <FormItem className="col-span-full"><FormLabel className="flex items-center gap-1.5">ميزات إضافية<ScoreBadge score={dsFieldScores?.additionalFeatures} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="مثال: مسابح، مواقف سيارات، نادي رياضي" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="floorsCount" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">عدد الأدوار الفعلية<ScoreBadge score={dsFieldScores?.floorsCount} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="permittedFloorsCount" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">عدد الأدوار المصرح به<ScoreBadge score={dsFieldScores?.permittedFloorsCount} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="permittedBuildingRatio" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">نسبة البناء المصرح بها %<ScoreBadge score={dsFieldScores?.permittedBuildingRatio} /></FormLabel><FormControl><Input type="number" min="0" max="100" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="streetWidth" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">عرض الشارع (م)<ScoreBadge score={dsFieldScores?.streetWidth} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="streetFacades" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">الواجهات المطلة على الشارع<ScoreBadge score={dsFieldScores?.streetFacades} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="مثال: واجهة واحدة، واجهتان" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="facadesCount" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">عدد الواجهات على الشارع<ScoreBadge score={dsFieldScores?.facadesCount} /></FormLabel><FormControl><Input type="number" min="1" max="4" {...field} value={field.value ?? ""} disabled={!isEditable} placeholder="1" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="utilities" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">المرافق المتاحة<ScoreBadge score={dsFieldScores?.utilities} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="كهرباء، ماء، صرف صحي" /></FormControl></FormItem>
                )} />
                
                <FormField control={form.control} name="landArea" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">مساحة الأرض (م²)<ScoreBadge score={dsFieldScores?.landArea} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="buildingArea" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">مساحة البناء (م²)<ScoreBadge score={dsFieldScores?.buildingArea} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="basementArea" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">مساحة القبو (م²)<ScoreBadge score={dsFieldScores?.basementArea} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="annexArea" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">مساحة الملحق (م²)<ScoreBadge score={dsFieldScores?.annexArea} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
              </CardContent>
            </Card>

            {/* Section 4: Valuation Results */}
            <Card className="xl:col-span-2 border-primary/20 shadow-md">
              <CardHeader className="bg-primary/5 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2 text-primary">
                  <Calculator className="h-5 w-5" />
                  نتائج التقييم
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-6">
                <FormField control={form.control} name="valuationMethod" render={({ field }) => (
                  <FormItem className="sm:col-span-2 md:col-span-3"><FormLabel className="flex items-center gap-1.5">أسلوب وطريقة التقييم المتبعة<ScoreBadge score={dsFieldScores?.valuationMethod} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} className="font-bold" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="marketWay" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">طريقة أسلوب السوق<ScoreBadge score={dsFieldScores?.marketWay} /></FormLabel><FormControl><Input {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="marketValue" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">قيمة السوق<ScoreBadge score={dsFieldScores?.marketValue} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="incomeWay" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">طريقة أسلوب الدخل<ScoreBadge score={dsFieldScores?.incomeWay} /></FormLabel><FormControl><Input {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="incomeValue" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">قيمة الدخل<ScoreBadge score={dsFieldScores?.incomeValue} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="costWay" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">طريقة أسلوب التكلفة<ScoreBadge score={dsFieldScores?.costWay} /></FormLabel><FormControl><Input {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="costValue" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">قيمة التكلفة<ScoreBadge score={dsFieldScores?.costValue} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="marketApproachPercentage" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">نسبة أسلوب السوق (%)<ScoreBadge score={dsFieldScores?.marketApproachPercentage} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="incomeApproachPercentage" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">نسبة أسلوب الدخل (%)<ScoreBadge score={dsFieldScores?.incomeApproachPercentage} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="costApproachPercentage" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">نسبة أسلوب التكلفة (%)<ScoreBadge score={dsFieldScores?.costApproachPercentage} /></FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />

                <FormField control={form.control} name="finalValue" render={({ field }) => (
                  <FormItem className="md:col-span-2 bg-primary/5 p-4 rounded-lg border border-primary/20">
                    <FormLabel className="flex items-center gap-1.5 text-primary font-bold text-lg">القيمة النهائية المعتمدة<ScoreBadge score={dsFieldScores?.finalValue} /></FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} className="text-xl font-bold h-12" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="pricePerMeter" render={({ field }) => (
                  <FormItem className="p-4">
                    <FormLabel className="flex items-center gap-1.5">سعر المتر<ScoreBadge score={dsFieldScores?.pricePerMeter} /></FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl>
                  </FormItem>
                )} />
              </CardContent>
            </Card>

            {/* Section 5: Client & Valuer Info */}
            <Card>
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <Briefcase className="h-5 w-5 text-primary" />
                  معلومات العميل
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-2 gap-4">
                <FormField control={form.control} name="clientName" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel className="flex items-center gap-1.5">اسم العميل<ScoreBadge score={dsFieldScores?.clientName} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="clientEmail" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">البريد الإلكتروني للعميل<ScoreBadge score={dsFieldScores?.clientEmail} /></FormLabel><FormControl><Input type="email" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="clientPhone" render={({ field }) => (
                  <FormItem><FormLabel className="flex items-center gap-1.5">رقم هاتف العميل<ScoreBadge score={dsFieldScores?.clientPhone} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="intendedUser" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel className="flex items-center gap-1.5">المستخدم المعتمد<ScoreBadge score={dsFieldScores?.intendedUser} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="companyName" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel className="flex items-center gap-1.5">اسم الشركة (إن وجد)<ScoreBadge score={dsFieldScores?.companyName} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="commercialRegNumber" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel className="flex items-center gap-1.5">رقم السجل التجاري<ScoreBadge score={dsFieldScores?.commercialRegNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  معلومات المقيّمين
                </CardTitle>
                <CardDescription>يمكن أن يشارك أكثر من مقيم في إعداد التقرير</CardDescription>
              </CardHeader>
              <CardContent className="pt-6 space-y-6">
                {/* ── إدخال سريع ── */}
                <div className="flex gap-2 items-end p-4 bg-muted/40 rounded-lg border border-dashed">
                  <FormField control={form.control} name="valuersInput" render={({ field }) => (
                    <FormItem className="flex-1">
                      <FormLabel className="text-sm font-semibold">إدخال سريع للمقيمين</FormLabel>
                      <FormControl>
                        <Input
                          {...field}
                          value={field.value || ""}
                          disabled={!isEditable}
                          placeholder="مثال: 112000210-50,122221101-50"
                          className="font-mono text-sm"
                          dir="ltr"
                        />
                      </FormControl>
                      <p className="text-xs text-muted-foreground mt-1">الصيغة: رقم_العضوية-النسبة% (افصل بين مقيمين بفاصلة)</p>
                    </FormItem>
                  )} />
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={!isEditable}
                    onClick={() => {
                      const input = (form.getValues("valuersInput") || "").trim();
                      if (!input) return;
                      const parts = input.split(",").map((p: string) => p.trim()).filter(Boolean);
                      let filled = 0;
                      let extra = 0;
                      parts.forEach((part: string, idx: number) => {
                        const lastDash = part.lastIndexOf("-");
                        if (lastDash === -1) return;
                        const membership = part.substring(0, lastDash).trim();
                        const pct = parseFloat(part.substring(lastDash + 1).trim());
                        if (idx === 0) {
                          form.setValue("membershipNumber", membership, { shouldDirty: true });
                          form.setValue("valuerPercentage", isNaN(pct) ? null : pct, { shouldDirty: true });
                          filled++;
                        } else if (idx === 1) {
                          form.setValue("secondValuerMembershipNumber", membership, { shouldDirty: true });
                          form.setValue("secondValuerPercentage", isNaN(pct) ? null : pct, { shouldDirty: true });
                          filled++;
                        } else {
                          extra++;
                        }
                      });
                      if (extra > 0) {
                        toast({
                          title: `تم ملء ${filled} مقيم في الفورم`,
                          description: `${extra} مقيم إضافي سيُملأ تلقائياً من حقل الإدخال السريع أثناء الأتمتة (لا حاجة لأي إجراء إضافي)`,
                          duration: 6000,
                        });
                      }
                    }}
                  >
                    تحليل وملء
                  </Button>
                </div>
                {/* ── شبكة المقيمين ── */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* First Valuer */}
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-muted-foreground border-b pb-2">المقيّم الأول</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="valuerName" render={({ field }) => (
                      <FormItem className="col-span-2"><FormLabel className="flex items-center gap-1.5">اسم المقيّم<ScoreBadge score={dsFieldScores?.valuerName} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="valuerPercentage" render={({ field }) => (
                      <FormItem><FormLabel className="flex items-center gap-1.5">نسبة المشاركة %<ScoreBadge score={dsFieldScores?.valuerPercentage} /></FormLabel><FormControl><Input type="number" min="0" max="100" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="licenseNumber" render={({ field }) => (
                      <FormItem><FormLabel className="flex items-center gap-1.5">رقم الترخيص<ScoreBadge score={dsFieldScores?.licenseNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="licenseDate" render={({ field }) => (
                      <FormItem><FormLabel className="flex items-center gap-1.5">تاريخ الترخيص<ScoreBadge score={dsFieldScores?.licenseDate} /></FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="membershipNumber" render={({ field }) => (
                      <FormItem><FormLabel className="flex items-center gap-1.5">رقم العضوية<ScoreBadge score={dsFieldScores?.membershipNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="membershipType" render={({ field }) => (
                      <FormItem><FormLabel className="flex items-center gap-1.5">نوع العضوية<ScoreBadge score={dsFieldScores?.membershipType} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                  </div>
                </div>

                {/* Second Valuer */}
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-muted-foreground border-b pb-2">المقيّم الثاني (اختياري)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="secondValuerName" render={({ field }) => (
                      <FormItem className="col-span-2"><FormLabel className="flex items-center gap-1.5">اسم المقيّم الثاني<ScoreBadge score={dsFieldScores?.secondValuerName} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="إن وجد..." /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="secondValuerPercentage" render={({ field }) => (
                      <FormItem><FormLabel className="flex items-center gap-1.5">نسبة المشاركة %<ScoreBadge score={dsFieldScores?.secondValuerPercentage} /></FormLabel><FormControl><Input type="number" min="0" max="100" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="secondValuerLicenseNumber" render={({ field }) => (
                      <FormItem><FormLabel className="flex items-center gap-1.5">رقم الترخيص<ScoreBadge score={dsFieldScores?.secondValuerLicenseNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="secondValuerMembershipNumber" render={({ field }) => (
                      <FormItem className="col-span-2"><FormLabel className="flex items-center gap-1.5">رقم العضوية<ScoreBadge score={dsFieldScores?.secondValuerMembershipNumber} /></FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                  </div>
                </div>
                </div>{/* end grid md:grid-cols-2 */}
              </CardContent>
            </Card>

            {/* Notes Section */}
            <Card className="xl:col-span-2">
              <CardContent className="pt-6">
                <FormField control={form.control} name="notes" render={({ field }) => (
                  <FormItem>
                    <FormLabel>ملاحظات إضافية</FormLabel>
                    <FormControl>
                      <Textarea 
                        {...field} 
                        value={field.value || ""} 
                        disabled={!isEditable} 
                        className="min-h-[100px] resize-y" 
                        placeholder="أي ملاحظات أو اشتراطات إضافية..."
                      />
                    </FormControl>
                  </FormItem>
                )} />
              </CardContent>
            </Card>

          </div>
        </form>
      </Form>
        </TabsContent>

        {/* ── تبويب مقارنة النظام ── */}
        <TabsContent value="compare" className="space-y-4">
          {dsRecord ? (
            <>
              {/* ملخص نسبة التطابق */}
              <Card className="border-blue-200 bg-blue-50/60">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-center justify-between flex-wrap gap-4">
                    <div className="flex items-center gap-3">
                      <BarChart3 className="h-6 w-6 text-blue-600" />
                      <div>
                        <p className="font-bold text-base text-blue-900">معدل التطابق الإجمالي</p>
                        <p className="text-xs text-blue-700 mt-0.5">بيانات النظام مقابل بيانات التقرير المستخرج</p>
                      </div>
                    </div>
                    <div className="text-4xl font-black text-blue-700">{dsRecord.averageScore ?? "—"}%</div>
                  </div>
                  <div className="mt-3 h-2.5 bg-blue-200 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${scoreBar(dsRecord.averageScore ?? 0)}`}
                      style={{ width: `${dsRecord.averageScore ?? 0}%` }}
                    />
                  </div>
                  <div className="mt-3 flex gap-3 flex-wrap text-xs">
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-green-500" />≥80% تطابق ممتاز</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-yellow-500" />60-79% تطابق جيد</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-orange-500" />40-59% تطابق متوسط</span>
                    <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded bg-red-500" />&lt;40% تطابق ضعيف</span>
                  </div>
                </CardContent>
              </Card>

              {/* رأس الأعمدة */}
              <div className="grid grid-cols-[180px_1fr_1fr_90px] gap-0 rounded-t-lg border overflow-hidden text-sm font-semibold bg-gray-100">
                <div className="p-3 border-l text-gray-700">الحقل</div>
                <div className="p-3 border-l text-blue-700 flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-blue-500" />
                  بيانات النظام
                </div>
                <div className="p-3 border-l text-purple-700 flex items-center gap-1.5">
                  <span className="inline-block w-2.5 h-2.5 rounded-full bg-purple-500" />
                  بيانات التقرير
                  <span className="text-[10px] text-gray-400 font-normal">(للقراءة)</span>
                </div>
                <div className="p-3 text-center text-gray-700">التطابق</div>
              </div>

              {/* صفوف المقارنة مجمّعة */}
              <div className="border border-t-0 rounded-b-lg overflow-hidden divide-y">
                {COMPARE_GROUPS.map((group) => {
                  // تحقق إذا كان للمجموعة أي بيانات
                  const hasData = group.fields.some(
                    ({ key }) => dsRecord[key] != null || (report as any)?.[key] != null
                  );
                  if (!hasData) return null;
                  return (
                    <div key={group.title}>
                      {/* عنوان المجموعة */}
                      <div className="bg-gray-50 px-3 py-2 text-xs font-bold text-gray-500 uppercase tracking-wider border-b">
                        {group.title}
                      </div>
                      {/* صفوف الحقول */}
                      {group.fields.map(({ key, label }, i) => {
                        const sysVal  = dsRecord[key];
                        const repVal  = (report as any)?.[key];
                        const score   = dsRecord.fieldScores?.[key] as number | undefined;
                        const isEmpty = sysVal == null && repVal == null;
                        if (isEmpty) return null;
                        return (
                          <div
                            key={key}
                            className={`grid grid-cols-[180px_1fr_1fr_90px] gap-0 text-sm border-b last:border-b-0 ${i % 2 === 0 ? "bg-white" : "bg-gray-50/40"} hover:bg-blue-50/20 transition-colors`}
                          >
                            {/* اسم الحقل */}
                            <div className="p-2.5 border-l text-xs text-gray-600 font-medium flex items-center">
                              {label}
                            </div>
                            {/* قيمة النظام */}
                            <div className="p-2.5 border-l flex items-center">
                              {sysVal != null ? (
                                <span className="text-blue-800 bg-blue-50 border border-blue-200 rounded px-2 py-0.5 text-xs max-w-xs break-words">
                                  {String(sysVal)}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs italic">—</span>
                              )}
                            </div>
                            {/* قيمة التقرير (للقراءة فقط) */}
                            <div className="p-2.5 border-l flex items-center">
                              {repVal != null ? (
                                <span className="text-purple-800 bg-purple-50 border border-purple-200 rounded px-2 py-0.5 text-xs max-w-xs break-words">
                                  {String(repVal)}
                                </span>
                              ) : (
                                <span className="text-gray-300 text-xs italic">—</span>
                              )}
                            </div>
                            {/* نسبة التطابق */}
                            <div className="p-2.5 flex flex-col items-center justify-center gap-1">
                              {score != null ? (
                                <>
                                  <span className={`text-xs font-bold border rounded px-1.5 py-0.5 leading-4 ${scoreBg(score)}`}>
                                    {score}%
                                  </span>
                                  <div className="w-14 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                    <div
                                      className={`h-full rounded-full ${scoreBar(score)}`}
                                      style={{ width: `${score}%` }}
                                    />
                                  </div>
                                </>
                              ) : (
                                <span className="text-gray-300 text-xs">—</span>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </>
          ) : (
            <Card>
              <CardContent className="pt-12 pb-12 text-center">
                <GitCompare className="h-12 w-12 mx-auto mb-3 text-gray-300" />
                <p className="text-muted-foreground">لا يوجد سجل نظام مرتبط بهذا التقرير</p>
                <p className="text-xs text-gray-400 mt-1">ارفع بيانات النظام من صفحة «مقارنة النظام» لتفعيل هذه الميزة</p>
              </CardContent>
            </Card>
          )}
        </TabsContent>

      </Tabs>
    </div>
  );
}