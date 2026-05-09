import React, { useState, useEffect } from "react";
import { Link } from "wouter";
import { useListReports, useGetReportStats } from "@workspace/api-client-react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Clock, CheckCircle2, Upload, AlertCircle, PlusCircle, Search, Filter, Database, Loader2, CircleDashed, Ban, RotateCcw, ListChecks, XCircle } from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";

const statusMap: Record<string, { label: string, color: string }> = {
  pending:   { label: "قيد الانتظار", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200" },
  extracted: { label: "تم الاستخراج", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200" },
  reviewed:  { label: "تمت المراجعة", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200" },
  submitted: { label: "تم الرفع",     color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200" },
};

const automationStatusMap: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  idle:         { label: "لم يُرفع",       color: "bg-gray-100 text-gray-500 border-gray-200",                           icon: <CircleDashed className="h-3 w-3" /> },
  pending:      { label: "في الانتظار",    color: "bg-yellow-100 text-yellow-700 border-yellow-200",                     icon: <Clock className="h-3 w-3" /> },
  queued:       { label: "في الطابور",     color: "bg-orange-100 text-orange-700 border-orange-200",                     icon: <RotateCcw className="h-3 w-3" /> },
  running:      { label: "جارٍ الرفع",     color: "bg-blue-100 text-blue-700 border-blue-200 animate-pulse",             icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  waiting_otp:  { label: "ينتظر OTP",      color: "bg-purple-100 text-purple-700 border-purple-200 animate-pulse",       icon: <Loader2 className="h-3 w-3 animate-spin" /> },
  completed:    { label: "تم الرفع",       color: "bg-green-100 text-green-700 border-green-200",                        icon: <CheckCircle2 className="h-3 w-3" /> },
  failed:       { label: "فشل الرفع",      color: "bg-red-100 text-red-700 border-red-200",                              icon: <Ban className="h-3 w-3" /> },
};

function FieldScore({ score }: { score: number | undefined }) {
  if (score == null) return null;
  const color =
    score >= 80 ? "text-green-600 bg-green-50 border-green-200" :
    score >= 60 ? "text-yellow-600 bg-yellow-50 border-yellow-200" :
    score >= 40 ? "text-orange-600 bg-orange-50 border-orange-200" :
    "text-red-600 bg-red-50 border-red-200";
  return (
    <span className={`inline-block mt-1 text-[10px] font-bold border rounded px-1 py-0 leading-4 ${color}`}>
      {score}%
    </span>
  );
}

type DsEntry = {
  averageScore: number | null;
  fieldScores: Record<string, number> | null;
};

export default function Dashboard() {
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const { toast } = useToast();

  const { data: reports, isLoading: reportsLoading, refetch: refetchReports } = useListReports({
    query: { staleTime: 5_000, refetchOnWindowFocus: true }
  });
  const { data: stats, isLoading: statsLoading } = useGetReportStats({
    query: { staleTime: 60_000, refetchOnWindowFocus: false }
  });

  const hasActiveAutomation = reports?.some(r =>
    ["running", "waiting_otp", "queued"].includes((r as any).automationStatus ?? "")
  );
  useEffect(() => {
    if (!hasActiveAutomation) return;
    const interval = setInterval(() => refetchReports(), 5000);
    return () => clearInterval(interval);
  }, [hasActiveAutomation, refetchReports]);

  const [searchQuery,  setSearchQuery]  = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [dsMap, setDsMap] = useState<Record<number, DsEntry>>({});

  // ── فلتر البطاقة النشطة (الافتراضي: إجمالي اليوم) ────────────────────────
  type CardFilter = "all_total" | "today_total" | "today_queued" | "today_failed" | "week_total" | "week_queued" | "week_failed";
  const [cardFilter, setCardFilter] = useState<CardFilter>("today_total");

  const cardFilterLabel: Record<CardFilter, string> = {
    all_total:    "إجمالي كامل",
    today_total:  "إجمالي تقارير اليوم",
    today_queued: "في الطابور اليوم",
    today_failed: "فشل الرفع اليوم",
    week_total:   "إجمالي تقارير الأسبوع",
    week_queued:  "في الطابور هذا الأسبوع",
    week_failed:  "فشل الرفع هذا الأسبوع",
  };

  // حدود التاريخ
  const todayStart = new Date(); todayStart.setHours(0,0,0,0);
  const weekStart  = new Date(Date.now() - 6 * 24 * 60 * 60 * 1000); weekStart.setHours(0,0,0,0);

  // ── تحديد متعدد ──────────────────────────────────────────────────────────
  const [selectedIds, setSelectedIds] = useState<Set<number>>(new Set());
  const [retrying, setRetrying] = useState(false);

  useEffect(() => {
    fetch(`${apiBase}/api/datasystem`)
      .then((r) => r.json())
      .then((list: any[]) => {
        const map: Record<number, DsEntry> = {};
        list.forEach((ds) => {
          if (ds.linkedReportId != null) {
            map[ds.linkedReportId] = {
              averageScore: ds.averageScore ?? null,
              fieldScores:  ds.fieldScores  ?? null,
            };
          }
        });
        setDsMap(map);
      })
      .catch(() => {});
  }, [apiBase]);

  const filteredReports = reports?.filter((report) => {
    const matchesSearch =
      !searchQuery ||
      report.reportNumber?.includes(searchQuery) ||
      report.clientName?.includes(searchQuery)   ||
      report.propertyType?.includes(searchQuery);
    const matchesStatus = statusFilter === "all" || report.status === statusFilter;

    // ── فلتر البطاقة ──────────────────────────────────────────────────────
    const created = (report as any).createdAt ? new Date((report as any).createdAt) : null;
    const automSt = (report as any).automationStatus ?? "idle";
    let matchesCard = true;
    if (cardFilter === "today_total")  matchesCard = !!created && created >= todayStart;
    if (cardFilter === "today_queued") matchesCard = !!created && created >= todayStart && automSt === "queued";
    if (cardFilter === "today_failed") matchesCard = !!created && created >= todayStart && automSt === "failed";
    if (cardFilter === "week_total")   matchesCard = !!created && created >= weekStart;
    if (cardFilter === "week_queued")  matchesCard = !!created && created >= weekStart  && automSt === "queued";
    if (cardFilter === "week_failed")  matchesCard = !!created && created >= weekStart  && automSt === "failed";
    // all_total → matchesCard = true (الكل)

    return matchesSearch && matchesStatus && matchesCard;
  });

  // التقارير الظاهرة التي يمكن تحديدها (الفاشلة فقط)
  const selectableIds = (filteredReports ?? [])
    .filter(r => (r as any).automationStatus === "failed")
    .map(r => r.id!);

  const allSelectableSelected =
    selectableIds.length > 0 && selectableIds.every(id => selectedIds.has(id));

  const toggleSelectAll = () => {
    if (allSelectableSelected) {
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => next.delete(id));
        return next;
      });
    } else {
      setSelectedIds(prev => {
        const next = new Set(prev);
        selectableIds.forEach(id => next.add(id));
        return next;
      });
    }
  };

  const toggleOne = (id: number) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const retrySelected = async () => {
    if (selectedIds.size === 0) return;
    setRetrying(true);
    try {
      const resp = await fetch(`${apiBase}/api/automation/retry-bulk`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: Array.from(selectedIds) }),
      });
      const data = await resp.json();
      if (resp.ok) {
        toast({ title: "تمت إعادة المحاولة", description: data.message });
        setSelectedIds(new Set());
        refetchReports();
      } else {
        toast({ variant: "destructive", title: "خطأ", description: data.error });
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ", description: "فشل الاتصال بالسيرفر" });
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ملخص التقارير</h1>
          <p className="text-muted-foreground mt-1">تتبع حالة تقارير التقييم الخاصة بك</p>
        </div>
        <Link href="/upload">
          <Button className="gap-2">
            <PlusCircle className="h-4 w-4" />
            رفع تقرير جديد
          </Button>
        </Link>
      </div>

      {/* ── بطاقة الإجمالي الكامل ── */}
      {(() => {
        const active = cardFilter === "all_total";
        return (
          <button
            onClick={() => setCardFilter("all_total")}
            className={`w-full text-right rounded-xl border-2 shadow-sm transition-all duration-150 bg-card hover:shadow-md
              ${active ? "border-slate-600 ring-2 ring-slate-400/40 shadow-md" : "border-border hover:border-slate-400"}`}
          >
            <div className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-sm font-medium text-muted-foreground">إجمالي كامل</p>
                {statsLoading ? <Skeleton className="h-9 w-16 mt-1" /> : <p className="text-4xl font-bold mt-0.5">{(stats as any)?.total ?? 0}</p>}
              </div>
              <div className={`h-10 w-10 rounded-full flex items-center justify-center transition-colors ${active ? "bg-slate-600 text-white" : "bg-slate-100 text-slate-600"}`}>
                <FileText className="h-5 w-5" />
              </div>
            </div>
            {active && <div className="h-1 bg-slate-600 rounded-b-xl" />}
          </button>
        );
      })()}

      {/* ── إحصائيات اليوم ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <Clock className="h-4 w-4" /> إحصائيات اليوم
        </h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {([
            { key: "today_total",  label: "إجمالي تقارير اليوم",  value: (stats as any)?.todayTotal,  icon: FileText,    top: "border-t-slate-500",  iconBg: "bg-slate-100",   iconTxt: "text-slate-600",  activeBg: "bg-slate-600" },
            { key: "today_queued", label: "في الطابور اليوم",      value: (stats as any)?.todayQueued, icon: ListChecks,  top: "border-t-orange-500", iconBg: "bg-orange-100",  iconTxt: "text-orange-600", activeBg: "bg-orange-500" },
            { key: "today_failed", label: "فشل الرفع اليوم",       value: (stats as any)?.todayFailed, icon: XCircle,     top: "border-t-red-500",    iconBg: "bg-red-100",     iconTxt: "text-red-600",    activeBg: "bg-red-600" },
          ] as const).map(({ key, label, value, icon: Icon, top, iconBg, iconTxt, activeBg }) => {
            const active = cardFilter === key;
            return (
              <button key={key} onClick={() => setCardFilter(key as CardFilter)}
                className={`text-right rounded-xl border-t-4 ${top} shadow-sm transition-all duration-150 bg-card hover:shadow-md
                  ${active ? "ring-2 ring-offset-1 ring-slate-400/50 shadow-md scale-[1.02]" : "hover:scale-[1.01]"}`}>
                <div className="flex flex-row items-center justify-between px-4 pt-4 pb-1">
                  <p className="text-sm font-medium">{label}</p>
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${active ? `${activeBg} text-white` : `${iconBg} ${iconTxt}`}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="px-4 pb-4">
                  {statsLoading ? <Skeleton className="h-8 w-16 mt-1" /> : <p className="text-3xl font-bold">{value ?? 0}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── إحصائيات الأسبوع ── */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground mb-3 flex items-center gap-2">
          <CheckCircle2 className="h-4 w-4" /> على مدار الأسبوع
        </h2>
        <div className="grid gap-4 grid-cols-1 sm:grid-cols-3">
          {([
            { key: "week_total",   label: "إجمالي تقارير الأسبوع",      value: (stats as any)?.weekTotal,   icon: FileText,   top: "border-t-blue-500",   iconBg: "bg-blue-100",   iconTxt: "text-blue-600",   activeBg: "bg-blue-600" },
            { key: "week_queued",  label: "في الطابور هذا الأسبوع",     value: (stats as any)?.weekQueued,  icon: ListChecks, top: "border-t-yellow-500", iconBg: "bg-yellow-100", iconTxt: "text-yellow-600", activeBg: "bg-yellow-500" },
            { key: "week_failed",  label: "فشل الرفع هذا الأسبوع",      value: (stats as any)?.weekFailed,  icon: XCircle,    top: "border-t-rose-500",   iconBg: "bg-rose-100",   iconTxt: "text-rose-600",   activeBg: "bg-rose-600" },
          ] as const).map(({ key, label, value, icon: Icon, top, iconBg, iconTxt, activeBg }) => {
            const active = cardFilter === key;
            return (
              <button key={key} onClick={() => setCardFilter(key as CardFilter)}
                className={`text-right rounded-xl border-t-4 ${top} shadow-sm transition-all duration-150 bg-card hover:shadow-md
                  ${active ? "ring-2 ring-offset-1 ring-slate-400/50 shadow-md scale-[1.02]" : "hover:scale-[1.01]"}`}>
                <div className="flex flex-row items-center justify-between px-4 pt-4 pb-1">
                  <p className="text-sm font-medium">{label}</p>
                  <div className={`h-8 w-8 rounded-full flex items-center justify-center transition-colors ${active ? `${activeBg} text-white` : `${iconBg} ${iconTxt}`}`}>
                    <Icon className="h-4 w-4" />
                  </div>
                </div>
                <div className="px-4 pb-4">
                  {statsLoading ? <Skeleton className="h-8 w-16 mt-1" /> : <p className="text-3xl font-bold">{value ?? 0}</p>}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── جدول التقارير ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{cardFilterLabel[cardFilter]}</CardTitle>
              <CardDescription>
                {filteredReports?.length ?? 0} تقرير
              </CardDescription>
            </div>
            <Button variant="ghost" size="sm" onClick={() => setCardFilter("today_total")}
              className="text-xs text-muted-foreground gap-1">
              إعادة الضبط
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {/* شريط البحث والفلاتر */}
          <div className="flex flex-col sm:flex-row gap-4 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم التقرير، اسم العميل..."
                className="pl-3 pr-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 ml-2 text-muted-foreground" />
                  <SelectValue placeholder="تصفية حسب الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الحالات</SelectItem>
                  <SelectItem value="pending">قيد الانتظار</SelectItem>
                  <SelectItem value="extracted">تم الاستخراج</SelectItem>
                  <SelectItem value="reviewed">تمت المراجعة</SelectItem>
                  <SelectItem value="submitted">تم الرفع</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* ── شريط الإجراءات الجماعية (يظهر عند اختيار تقارير) ── */}
          {selectedIds.size > 0 && (
            <div className="flex items-center gap-3 mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
              <span className="text-sm font-medium text-red-800">
                تم تحديد {selectedIds.size} تقرير فاشل
              </span>
              <Button
                size="sm"
                onClick={retrySelected}
                disabled={retrying}
                className="gap-2 bg-red-600 hover:bg-red-700 text-white"
              >
                {retrying ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
                إعادة المحاولة للمحددة
              </Button>
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setSelectedIds(new Set())}
                className="text-red-700 hover:text-red-900"
              >
                إلغاء التحديد
              </Button>
            </div>
          )}

          {reportsLoading ? (
            <div className="space-y-4">
              {[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredReports && filteredReports.length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    {/* عمود التحديد — يظهر فقط إذا وجدت تقارير فاشلة */}
                    {selectableIds.length > 0 && (
                      <TableHead className="w-10 text-right">
                        <Checkbox
                          checked={allSelectableSelected}
                          onCheckedChange={toggleSelectAll}
                          aria-label="تحديد الكل"
                          title="تحديد جميع الفاشلة"
                        />
                      </TableHead>
                    )}
                    <TableHead className="text-right">رقم التقرير</TableHead>
                    <TableHead className="text-right">اسم العميل</TableHead>
                    <TableHead className="text-right">نوع العقار</TableHead>
                    <TableHead className="text-right">تاريخ التقرير</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                    <TableHead className="text-right">حالة الرفع في تقييم</TableHead>
                    <TableHead className="text-right">مصدر البيانات</TableHead>
                    <TableHead className="text-right">التطابق الكلي</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((report) => {
                    const ds          = dsMap[report.id!];
                    const hasDs       = ds !== undefined;
                    const fs          = ds?.fieldScores ?? null;
                    const avgScore    = ds?.averageScore ?? null;
                    const isFailed    = (report as any).automationStatus === "failed";
                    const isSelected  = selectedIds.has(report.id!);

                    return (
                      <TableRow
                        key={report.id}
                        className={`cursor-pointer hover:bg-muted/50 transition-colors align-top ${isSelected ? "bg-red-50" : ""}`}
                      >
                        {/* خانة التحديد — للتقارير الفاشلة فقط */}
                        {selectableIds.length > 0 && (
                          <TableCell className="w-10" onClick={e => e.stopPropagation()}>
                            {isFailed && (
                              <Checkbox
                                checked={isSelected}
                                onCheckedChange={() => toggleOne(report.id!)}
                                aria-label={`تحديد تقرير ${report.reportNumber}`}
                              />
                            )}
                          </TableCell>
                        )}

                        {/* رقم التقرير */}
                        <TableCell className="font-medium">
                          <Link href={`/reports/${report.id}`}>
                            <div className="py-1 text-primary hover:underline">{report.reportNumber || "—"}</div>
                          </Link>
                          <FieldScore score={fs?.reportNumber} />
                        </TableCell>

                        {/* اسم العميل */}
                        <TableCell>
                          <Link href={`/reports/${report.id}`}>
                            <div className="py-1">{report.clientName || "—"}</div>
                          </Link>
                          <FieldScore score={fs?.clientName} />
                        </TableCell>

                        {/* نوع العقار */}
                        <TableCell>
                          <Link href={`/reports/${report.id}`}>
                            <div className="py-1">{report.propertyType || "—"}</div>
                          </Link>
                          <FieldScore score={fs?.propertyType} />
                        </TableCell>

                        {/* تاريخ التقرير */}
                        <TableCell>
                          <Link href={`/reports/${report.id}`}>
                            <div className="py-1 text-muted-foreground">
                              {report.reportDate
                                ? format(new Date(report.reportDate), "dd MMMM yyyy", { locale: arSA })
                                : "—"}
                            </div>
                          </Link>
                          <FieldScore score={fs?.reportDate} />
                        </TableCell>

                        {/* الحالة */}
                        <TableCell>
                          <Link href={`/reports/${report.id}`}>
                            <div className="py-1">
                              <Badge variant="outline" className={`${statusMap[report.status]?.color} px-2 py-0.5 rounded-full font-normal`}>
                                {statusMap[report.status]?.label || report.status}
                              </Badge>
                            </div>
                          </Link>
                        </TableCell>

                        {/* حالة الرفع في تقييم */}
                        <TableCell>
                          {(() => {
                            const taqeemNum = (report as any).taqeemReportNumber as string | null | undefined;
                            const as = (report as any).automationStatus ?? "idle";
                            const info = taqeemNum
                              ? { label: "تم الرفع", color: "bg-green-100 text-green-700 border-green-200", icon: <CheckCircle2 className="h-3 w-3" /> }
                              : (automationStatusMap[as] ?? automationStatusMap["idle"]);
                            return (
                              <div className="flex flex-col gap-1">
                                <Badge variant="outline" className={`${info.color} px-2 py-0.5 rounded-full font-normal flex items-center gap-1 w-fit`}>
                                  {info.icon}
                                  {info.label}
                                </Badge>
                                {taqeemNum && (
                                  <span className="text-[11px] font-mono text-green-700 bg-green-50 border border-green-200 rounded px-1.5 py-0.5 w-fit select-all">
                                    {taqeemNum}
                                  </span>
                                )}
                              </div>
                            );
                          })()}
                        </TableCell>

                        {/* مصدر البيانات */}
                        <TableCell>
                          {hasDs ? (
                            <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200 gap-1 px-2 py-0.5 rounded-full font-normal flex items-center w-fit">
                              <Database className="h-3 w-3" />
                              مرتبط
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>

                        {/* التطابق الكلي */}
                        <TableCell>
                          {hasDs && avgScore != null ? (
                            <div className="flex items-center gap-2 min-w-[90px]">
                              <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                  className={`h-2 rounded-full transition-all ${
                                    avgScore >= 80 ? "bg-green-500" :
                                    avgScore >= 60 ? "bg-yellow-500" :
                                    avgScore >= 40 ? "bg-orange-500" : "bg-red-500"
                                  }`}
                                  style={{ width: `${avgScore}%` }}
                                />
                              </div>
                              <span className={`text-xs font-bold w-8 text-right ${
                                avgScore >= 80 ? "text-green-700" :
                                avgScore >= 60 ? "text-yellow-700" :
                                avgScore >= 40 ? "text-orange-700" : "text-red-700"
                              }`}>
                                {avgScore}%
                              </span>
                            </div>
                          ) : hasDs ? (
                            <span className="text-muted-foreground text-xs">لم يُحسب</span>
                          ) : (
                            <span className="text-muted-foreground text-sm">—</span>
                          )}
                        </TableCell>

                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-lg bg-muted/20">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-xl font-bold text-foreground">لا توجد تقارير مطابقة</h3>
              <p className="text-muted-foreground mt-2 max-w-sm">
                لم يتم العثور على تقارير تطابق معايير البحث الحالية. جرب تغيير كلمات البحث أو المرشحات.
              </p>
              {reports && reports.length === 0 && (
                <Link href="/upload" className="mt-6">
                  <Button>رفع أول تقرير</Button>
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
