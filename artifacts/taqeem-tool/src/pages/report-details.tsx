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
  Settings
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
  landArea: numberOrNull,
  buildingArea: numberOrNull,
  basementArea: numberOrNull,
  annexArea: numberOrNull,
  floorsCount: numberOrNull,
  permittedFloorsCount: numberOrNull,
  permittedBuildingRatio: numberOrNull,
  streetWidth: numberOrNull,
  streetFacades: stringOrNull,
  utilities: stringOrNull,
  coordinates: stringOrNull,
  
  valuationMethod: stringOrNull,
  marketValue: numberOrNull,
  incomeValue: numberOrNull,
  costValue: numberOrNull,
  finalValue: numberOrNull,
  pricePerMeter: numberOrNull,

  valuerPercentage: numberOrNull,
  secondValuerName: stringOrNull,
  secondValuerLicenseNumber: stringOrNull,
  secondValuerMembershipNumber: stringOrNull,
  secondValuerPercentage: numberOrNull,

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
      queryKey: getGetReportQueryKey(id)
    }
  });

  const updateReport = useUpdateReport();
  const updateStatus = useUpdateReportStatus();

  // Automation state
  const [automationData, setAutomationData] = useState<any>(null);
  const [automationLoading, setAutomationLoading] = useState(false);
  const [taqeemSession, setTaqeemSession] = useState<{ status: string; username?: string } | null>(null);
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

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
        if (data.automationStatus === "completed" || data.automationStatus === "failed") {
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
              {report.pdfFileName && (
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <FileText className="h-3 w-3" />
                  {report.pdfFileName}
                </span>
              )}
            </div>
          </div>
        </div>
        
        <div className="flex items-center gap-2 w-full sm:w-auto">
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
                <CopyField label="قيمة أسلوب السوق" value={report.marketValue ? report.marketValue.toLocaleString("ar-SA") : null} />
                <CopyField label="قيمة أسلوب الدخل" value={report.incomeValue ? report.incomeValue.toLocaleString("ar-SA") : null} />
                <CopyField label="قيمة أسلوب التكلفة" value={report.costValue ? report.costValue.toLocaleString("ar-SA") : null} />
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

              {/* Automation Status Banner */}
              {automationData && automationData.automationStatus !== "idle" && (
                <div className={`rounded-lg p-4 flex items-center gap-3 ${
                  automationData.automationStatus === "completed" ? "bg-green-50 border border-green-200 text-green-800" :
                  automationData.automationStatus === "failed" ? "bg-red-50 border border-red-200 text-red-800" :
                  automationData.automationStatus === "running" ? "bg-blue-50 border border-blue-200 text-blue-800" :
                  "bg-muted border"
                }`}>
                  {(automationData.automationStatus === "running" || automationLoading) && <Loader2 className="h-5 w-5 animate-spin shrink-0" />}
                  {automationData.automationStatus === "completed" && <Check className="h-5 w-5 shrink-0" />}
                  {automationData.automationStatus === "failed" && <AlertCircle className="h-5 w-5 shrink-0" />}
                  <div>
                    <p className="font-semibold text-sm">
                      {automationData.automationStatus === "running" && "جارٍ الرفع الآلي..."}
                      {automationData.automationStatus === "completed" && "✅ اكتملت العملية بنجاح!"}
                      {automationData.automationStatus === "failed" && "❌ فشلت العملية"}
                    </p>
                    {automationData.automationError && (
                      <p className="text-xs mt-1 opacity-80">{automationData.automationError}</p>
                    )}
                    {automationData.taqeemSubmittedAt && (
                      <p className="text-xs mt-1 opacity-70">
                        وقت الإرسال: {new Date(automationData.taqeemSubmittedAt).toLocaleString("ar-SA")}
                      </p>
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
                    automationData?.automationStatus === "running" ||
                    taqeemSession?.status !== "authenticated"
                  }
                  className="gap-2"
                >
                  {automationLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Bot className="h-4 w-4" />}
                  {automationData?.automationStatus === "completed" ? "إعادة الرفع" : "ابدأ الرفع الآلي"}
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
                  <FormItem><FormLabel>رقم التقرير</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="requestNumber" render={({ field }) => (
                  <FormItem><FormLabel>رقم الطلب</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="reportDate" render={({ field }) => (
                  <FormItem><FormLabel>تاريخ التقرير</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="valuationDate" render={({ field }) => (
                  <FormItem><FormLabel>تاريخ التقييم</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="inspectionDate" render={({ field }) => (
                  <FormItem><FormLabel>تاريخ المعاينة</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="reportType" render={({ field }) => (
                  <FormItem><FormLabel>نوع التقرير</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="valuationPurpose" render={({ field }) => (
                  <FormItem><FormLabel>غرض التقييم</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="valuationHypothesis" render={({ field }) => (
                  <FormItem><FormLabel>فرضية القيمة</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="valuationBasis" render={({ field }) => (
                  <FormItem><FormLabel>أساس القيمة</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
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
                  <FormItem><FormLabel>المنطقة</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="city" render={({ field }) => (
                  <FormItem><FormLabel>المدينة</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="district" render={({ field }) => (
                  <FormItem><FormLabel>الحي</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="street" render={({ field }) => (
                  <FormItem><FormLabel>الشارع</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="blockNumber" render={({ field }) => (
                  <FormItem><FormLabel>رقم البلك</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="plotNumber" render={({ field }) => (
                  <FormItem><FormLabel>رقم القطعة</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="planNumber" render={({ field }) => (
                  <FormItem><FormLabel>رقم المخطط</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="coordinates" render={({ field }) => (
                  <FormItem><FormLabel>الإحداثيات</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} dir="ltr" className="text-left" placeholder="24.7136, 46.6753" /></FormControl></FormItem>
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
                  <FormItem><FormLabel>نوع العقار</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="propertySubType" render={({ field }) => (
                  <FormItem><FormLabel>النوع الفرعي</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="propertyUse" render={({ field }) => (
                  <FormItem><FormLabel>الاستخدام</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="deedNumber" render={({ field }) => (
                  <FormItem><FormLabel>رقم الصك</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="deedDate" render={({ field }) => (
                  <FormItem><FormLabel>تاريخ الصك</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="ownerName" render={({ field }) => (
                  <FormItem className="md:col-span-2"><FormLabel>اسم المالك</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="ownershipType" render={({ field }) => (
                  <FormItem><FormLabel>نوع الملكية</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <div className="col-span-full my-2"><Separator /></div>
                
                <FormField control={form.control} name="buildingPermitNumber" render={({ field }) => (
                  <FormItem><FormLabel>رقم رخصة البناء</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="buildingStatus" render={({ field }) => (
                  <FormItem><FormLabel>حالة البناء</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="buildingAge" render={({ field }) => (
                  <FormItem><FormLabel>عمر البناء</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="floorsCount" render={({ field }) => (
                  <FormItem><FormLabel>عدد الأدوار الفعلية</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="permittedFloorsCount" render={({ field }) => (
                  <FormItem><FormLabel>عدد الأدوار المصرح به</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="permittedBuildingRatio" render={({ field }) => (
                  <FormItem><FormLabel>نسبة البناء المصرح بها %</FormLabel><FormControl><Input type="number" min="0" max="100" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="streetWidth" render={({ field }) => (
                  <FormItem><FormLabel>عرض الشارع (م)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="streetFacades" render={({ field }) => (
                  <FormItem><FormLabel>الواجهات المطلة على الشارع</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="مثال: واجهة واحدة، واجهتان" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="utilities" render={({ field }) => (
                  <FormItem><FormLabel>المرافق المتاحة</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="كهرباء، ماء، صرف صحي" /></FormControl></FormItem>
                )} />
                
                <FormField control={form.control} name="landArea" render={({ field }) => (
                  <FormItem><FormLabel>مساحة الأرض (م²)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="buildingArea" render={({ field }) => (
                  <FormItem><FormLabel>مساحة البناء (م²)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="basementArea" render={({ field }) => (
                  <FormItem><FormLabel>مساحة القبو (م²)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="annexArea" render={({ field }) => (
                  <FormItem><FormLabel>مساحة الملحق (م²)</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
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
                  <FormItem className="sm:col-span-2 md:col-span-3"><FormLabel>أسلوب وطريقة التقييم المتبعة</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} className="font-bold" /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="marketValue" render={({ field }) => (
                  <FormItem><FormLabel>قيمة السوق</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="incomeValue" render={({ field }) => (
                  <FormItem><FormLabel>قيمة الدخل</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="costValue" render={({ field }) => (
                  <FormItem><FormLabel>قيمة التكلفة</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                
                <FormField control={form.control} name="finalValue" render={({ field }) => (
                  <FormItem className="md:col-span-2 bg-primary/5 p-4 rounded-lg border border-primary/20">
                    <FormLabel className="text-primary font-bold text-lg">القيمة النهائية المعتمدة</FormLabel>
                    <FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} className="text-xl font-bold h-12" /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="pricePerMeter" render={({ field }) => (
                  <FormItem className="p-4">
                    <FormLabel>سعر المتر</FormLabel>
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
                  <FormItem className="col-span-2"><FormLabel>اسم العميل</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="clientEmail" render={({ field }) => (
                  <FormItem><FormLabel>البريد الإلكتروني للعميل</FormLabel><FormControl><Input type="email" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="clientPhone" render={({ field }) => (
                  <FormItem><FormLabel>رقم هاتف العميل</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="intendedUser" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>المستخدم المعتمد</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="companyName" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>اسم الشركة (إن وجد)</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                )} />
                <FormField control={form.control} name="commercialRegNumber" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>رقم السجل التجاري</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
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
              <CardContent className="pt-6 grid grid-cols-1 md:grid-cols-2 gap-8">
                {/* First Valuer */}
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-muted-foreground border-b pb-2">المقيّم الأول</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="valuerName" render={({ field }) => (
                      <FormItem className="col-span-2"><FormLabel>اسم المقيّم</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="valuerPercentage" render={({ field }) => (
                      <FormItem><FormLabel>نسبة المشاركة %</FormLabel><FormControl><Input type="number" min="0" max="100" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="licenseNumber" render={({ field }) => (
                      <FormItem><FormLabel>رقم الترخيص</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="licenseDate" render={({ field }) => (
                      <FormItem><FormLabel>تاريخ الترخيص</FormLabel><FormControl><Input type="date" {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="membershipNumber" render={({ field }) => (
                      <FormItem><FormLabel>رقم العضوية</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="membershipType" render={({ field }) => (
                      <FormItem><FormLabel>نوع العضوية</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                  </div>
                </div>

                {/* Second Valuer */}
                <div className="space-y-4">
                  <p className="text-sm font-semibold text-muted-foreground border-b pb-2">المقيّم الثاني (اختياري)</p>
                  <div className="grid grid-cols-2 gap-4">
                    <FormField control={form.control} name="secondValuerName" render={({ field }) => (
                      <FormItem className="col-span-2"><FormLabel>اسم المقيّم الثاني</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} placeholder="إن وجد..." /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="secondValuerPercentage" render={({ field }) => (
                      <FormItem><FormLabel>نسبة المشاركة %</FormLabel><FormControl><Input type="number" min="0" max="100" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="secondValuerLicenseNumber" render={({ field }) => (
                      <FormItem><FormLabel>رقم الترخيص</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                    <FormField control={form.control} name="secondValuerMembershipNumber" render={({ field }) => (
                      <FormItem className="col-span-2"><FormLabel>رقم العضوية</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
                    )} />
                  </div>
                </div>
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
      </Tabs>
    </div>
  );
}