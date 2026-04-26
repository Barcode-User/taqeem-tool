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
import { FileText, Clock, CheckCircle2, Upload, AlertCircle, PlusCircle, Search, Filter, Database, Loader2, CircleDashed, Ban, RotateCcw } from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

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

  const { data: reports, isLoading: reportsLoading, refetch: refetchReports } = useListReports({
    query: { staleTime: 5_000, refetchOnWindowFocus: true }
  });
  const { data: stats, isLoading: statsLoading } = useGetReportStats({
    query: { staleTime: 60_000, refetchOnWindowFocus: false }
  });

  // تحديث تلقائي كل 5 ثوانٍ عند وجود طلبات جارية أو في الطابور
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
    return matchesSearch && matchesStatus;
  });

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

      {/* ── بطاقات الإحصائيات ── */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-t-4 border-t-slate-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">إجمالي التقارير</CardTitle>
            <div className="h-8 w-8 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center">
              <FileText className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-bold">{stats?.total || 0}</div>}
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-yellow-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">قيد الانتظار / مستخرج</CardTitle>
            <div className="h-8 w-8 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-bold">{(stats?.pending || 0) + (stats?.extracted || 0)}</div>}
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-purple-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تمت المراجعة</CardTitle>
            <div className="h-8 w-8 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-bold">{stats?.reviewed || 0}</div>}
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-green-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تم الرفع لتقييم</CardTitle>
            <div className="h-8 w-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
              <Upload className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? <Skeleton className="h-8 w-16" /> : <div className="text-3xl font-bold">{stats?.submitted || 0}</div>}
          </CardContent>
        </Card>
      </div>

      {/* ── جدول التقارير ── */}
      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle>أحدث التقارير</CardTitle>
          <CardDescription>التقارير التي تم معالجتها مؤخراً</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
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

          {reportsLoading ? (
            <div className="space-y-4">
              {[1,2,3,4,5].map((i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filteredReports && filteredReports.length > 0 ? (
            <div className="rounded-md border overflow-x-auto">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
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

                    return (
                      <TableRow key={report.id} className="cursor-pointer hover:bg-muted/50 transition-colors align-top">

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
                            const as = (report as any).automationStatus ?? "idle";
                            const info = automationStatusMap[as] ?? automationStatusMap["idle"];
                            return (
                              <Badge variant="outline" className={`${info.color} px-2 py-0.5 rounded-full font-normal flex items-center gap-1 w-fit`}>
                                {info.icon}
                                {info.label}
                              </Badge>
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
