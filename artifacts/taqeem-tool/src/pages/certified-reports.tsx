import { useState, useEffect, useRef } from "react";
import { Link } from "wouter";
import { useListReports } from "@workspace/api-client-react";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Search, FileText, Eye,
  PlayCircle, StopCircle, Loader2, AlertCircle, RefreshCw, ExternalLink,
} from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { useToast } from "@/hooks/use-toast";

type CertifyStatus = "idle" | "running" | "ready" | "failed";
type CertifyState = {
  status: CertifyStatus;
  error?: string;
  logs: string[];
  reportNumbers: string[];
  openedReport?: string;
};

export default function CertifiedReports() {
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const [certify, setCertify] = useState<CertifyState>({
    status: "idle", logs: [], reportNumbers: [],
  });
  const [openingReport, setOpeningReport] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const { data: allReports, isLoading } = useListReports({
    query: { staleTime: 30_000, refetchOnWindowFocus: true },
  });

  const reports = allReports?.filter(
    (r) => (r as any).automationStatus === "completed",
  );

  const filtered = reports?.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.reportNumber?.toLowerCase().includes(q) ||
      r.clientName?.toLowerCase().includes(q) ||
      r.propertyType?.toLowerCase().includes(q) ||
      r.region?.toLowerCase().includes(q) ||
      r.city?.toLowerCase().includes(q)
    );
  });

  const fetchCertifyStatus = async () => {
    try {
      const resp = await fetch(`${apiBase}/api/automation/certify/status`);
      if (resp.ok) {
        const data: CertifyState = await resp.json();
        setCertify(data);
        if (data.status === "ready" || data.status === "failed" || data.status === "idle") {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchCertifyStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const handleStartCertify = async () => {
    try {
      const resp = await fetch(`${apiBase}/api/automation/certify/start`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({}),
      });
      const text = await resp.text();
      let data: any = {};
      try { data = JSON.parse(text); } catch {}

      if (resp.status === 404) {
        toast({ variant: "destructive", title: "الخادم قديم", description: "نفّذ start.bat لتحديث الخادم" });
        return;
      }
      if (resp.ok) {
        toast({ title: "جارٍ فتح المتصفح...", description: "ستظهر نافذة Chrome تلقائياً" });
        setCertify({ status: "running", logs: [], reportNumbers: [] });
        pollRef.current = setInterval(fetchCertifyStatus, 2000);
      } else {
        toast({ variant: "destructive", title: "خطأ", description: data.error ?? text });
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ في الاتصال", description: "تأكد أن الخادم يعمل" });
    }
  };

  const handleStopCertify = async () => {
    try {
      await fetch(`${apiBase}/api/automation/certify/stop`, { method: "POST" });
      setCertify({ status: "idle", logs: [], reportNumbers: [] });
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      toast({ title: "تم إغلاق المتصفح" });
    } catch {}
  };

  const handleRefreshNumbers = async () => {
    setRefreshing(true);
    try {
      const resp = await fetch(`${apiBase}/api/automation/certify/refresh`, { method: "POST" });
      if (resp.ok) {
        const data = await resp.json();
        setCertify(prev => ({ ...prev, reportNumbers: data.reportNumbers }));
        toast({ title: `تم التحديث`, description: `${data.count} تقرير في الصفحة` });
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ في التحديث" });
    } finally {
      setRefreshing(false);
    }
  };

  const handleOpenReport = async (reportNumber: string) => {
    setOpeningReport(reportNumber);
    try {
      const resp = await fetch(`${apiBase}/api/automation/certify/open`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reportNumber }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setCertify(prev => ({ ...prev, openedReport: reportNumber }));
        toast({ title: `✅ تم فتح التقرير ${reportNumber}`, description: "انظر نافذة المتصفح" });
      } else {
        toast({ variant: "destructive", title: "خطأ", description: data.error });
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ في الاتصال" });
    } finally {
      setOpeningReport(null);
    }
  };

  const isRunning = certify.status === "running";
  const isReady = certify.status === "ready";

  return (
    <div className="space-y-6">

      {/* ─── بطاقة التعميد ─────────────────────────────────────────────────── */}
      <Card className={`border-2 ${isReady ? "border-emerald-400 shadow-md" : isRunning ? "border-blue-300" : "border-border"}`}>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className={`h-9 w-9 rounded-full flex items-center justify-center ${isReady ? "bg-emerald-100" : "bg-slate-100"}`}>
                <PlayCircle className={`h-5 w-5 ${isReady ? "text-emerald-600" : "text-slate-500"}`} />
              </div>
              <div>
                <CardTitle className="text-base">بداية التعميد</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isReady
                    ? `✅ المتصفح مفتوح — ${certify.reportNumbers.length > 0 ? `${certify.reportNumbers.length} تقرير متاح` : "لا توجد تقارير في الصفحة"}`
                    : isRunning
                    ? "جارٍ فتح المتصفح وقراءة التقارير..."
                    : certify.status === "failed"
                    ? "فشل فتح المتصفح"
                    : "يفتح منصة تقييم بجلسة معمد البيانات ويعرض التقارير"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              {isReady && (
                <Button variant="outline" size="sm" onClick={handleRefreshNumbers} disabled={refreshing} className="gap-2">
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  تحديث الأرقام
                </Button>
              )}
              {(isRunning || isReady) && (
                <Button variant="outline" size="sm" onClick={handleStopCertify} className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
                  <StopCircle className="h-4 w-4" />
                  إغلاق
                </Button>
              )}
              <Button
                onClick={handleStartCertify}
                disabled={isRunning}
                className={`gap-2 ${isReady ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
              >
                {isRunning ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...</>
                ) : isReady ? (
                  <><PlayCircle className="h-4 w-4" /> إعادة الفتح</>
                ) : (
                  <><PlayCircle className="h-4 w-4" /> بداية التعميد</>
                )}
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* أرقام التقارير من منصة تقييم */}
        {isReady && certify.reportNumbers.length > 0 && (
          <CardContent className="pt-0">
            <div className="rounded-lg border bg-muted/30 p-3">
              <p className="text-xs text-muted-foreground mb-2 font-medium">
                أرقام التقارير في منصة تقييم — اضغط على الرقم لفتح التقرير في المتصفح:
              </p>
              <div className="flex flex-wrap gap-2">
                {certify.reportNumbers.map((num) => (
                  <Button
                    key={num}
                    variant={certify.openedReport === num ? "default" : "outline"}
                    size="sm"
                    onClick={() => handleOpenReport(num)}
                    disabled={openingReport === num}
                    className={`gap-1.5 font-mono text-sm h-8 ${
                      certify.openedReport === num
                        ? "bg-emerald-600 hover:bg-emerald-700"
                        : "hover:bg-primary hover:text-primary-foreground"
                    }`}
                  >
                    {openingReport === num ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <ExternalLink className="h-3 w-3" />
                    )}
                    {num}
                  </Button>
                ))}
              </div>
            </div>
          </CardContent>
        )}

        {/* خطأ */}
        {certify.status === "failed" && certify.error && (
          <CardContent className="pt-0">
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{certify.error}</span>
            </div>
          </CardContent>
        )}

        {/* سجل العمليات */}
        {certify.logs.length > 0 && (
          <CardContent className="pt-0">
            <div className="rounded-lg bg-slate-950 text-green-400 font-mono text-xs p-3 space-y-0.5 max-h-28 overflow-y-auto" dir="ltr">
              {certify.logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── قائمة التقارير المعمدة ─────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-lg">التقارير المعمدة</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  التقارير المرفوعة بنجاح على منصة تقييم
                </p>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-sm px-3 py-1">
              {isLoading ? "..." : (filtered?.length ?? 0)} تقرير
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم التقرير أو اسم العميل..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
            </div>
          ) : filtered?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <FileText className="h-12 w-12 opacity-30" />
              <p className="text-base font-medium">لا توجد تقارير معمدة</p>
              <p className="text-sm">التقارير المرفوعة بنجاح على تقييم ستظهر هنا</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-right font-semibold">رقم التقرير</TableHead>
                    <TableHead className="text-right font-semibold">العميل</TableHead>
                    <TableHead className="text-right font-semibold">نوع الأصل</TableHead>
                    <TableHead className="text-right font-semibold">المنطقة / المدينة</TableHead>
                    <TableHead className="text-right font-semibold">قيمة التقييم</TableHead>
                    <TableHead className="text-right font-semibold">تاريخ التقرير</TableHead>
                    <TableHead className="text-right font-semibold">عرض</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered?.map((report) => (
                    <TableRow key={report.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-sm font-medium text-primary">
                        {report.reportNumber || "—"}
                      </TableCell>
                      <TableCell className="font-medium">{report.clientName || "—"}</TableCell>
                      <TableCell>{report.propertyType || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[report.region, report.city].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="font-medium text-emerald-700">
                        {report.finalValue
                          ? Number(report.finalValue).toLocaleString("ar-SA") + " ر.س"
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {report.reportDate
                          ? format(new Date(report.reportDate), "d MMM yyyy", { locale: arSA })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Link href={`/reports/${report.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 px-2">
                            <Eye className="h-4 w-4 ml-1" />
                            عرض
                          </Button>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
