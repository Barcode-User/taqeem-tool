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
  Briefcase
} from "lucide-react";

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
  intendedUser: stringOrNull,
  companyName: stringOrNull,
  commercialRegNumber: stringOrNull,
  
  reportType: stringOrNull,
  valuationPurpose: stringOrNull,
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
  coordinates: stringOrNull,
  
  valuationMethod: stringOrNull,
  marketValue: numberOrNull,
  incomeValue: numberOrNull,
  costValue: numberOrNull,
  finalValue: numberOrNull,
  pricePerMeter: numberOrNull,
  
  notes: stringOrNull,
});

type ReportFormValues = z.infer<typeof reportFormSchema>;

const statusMap: Record<string, { label: string, color: string, next: string | null, action: string }> = {
  pending: { label: "قيد الانتظار", color: "bg-yellow-100 text-yellow-800 border-yellow-200", next: "extracted", action: "استخراج" },
  extracted: { label: "تم الاستخراج", color: "bg-blue-100 text-blue-800 border-blue-200", next: "reviewed", action: "اعتماد المراجعة" },
  reviewed: { label: "تمت المراجعة", color: "bg-purple-100 text-purple-800 border-purple-200", next: "submitted", action: "رفع لتقييم" },
  submitted: { label: "تم الرفع", color: "bg-green-100 text-green-800 border-green-200", next: null, action: "" },
};

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

  const form = useForm<ReportFormValues>({
    resolver: zodResolver(reportFormSchema),
    defaultValues: {},
  });

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
                  <FormItem><FormLabel>عدد الأدوار</FormLabel><FormControl><Input type="number" {...field} value={field.value ?? ""} disabled={!isEditable} /></FormControl></FormItem>
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

            <Card>
              <CardHeader className="bg-muted/30 border-b pb-4">
                <CardTitle className="text-base flex items-center gap-2">
                  <User className="h-5 w-5 text-primary" />
                  معلومات المقيّم
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-6 grid grid-cols-2 gap-4">
                <FormField control={form.control} name="valuerName" render={({ field }) => (
                  <FormItem className="col-span-2"><FormLabel>اسم المقيّم</FormLabel><FormControl><Input {...field} value={field.value || ""} disabled={!isEditable} /></FormControl></FormItem>
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
    </div>
  );
}