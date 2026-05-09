import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2, Search, FileText,
  PlayCircle, StopCircle, Loader2, AlertCircle, RefreshCw, ChevronLeft, Stamp,
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
  currentIndex: number;
  openedReport?: string;
};

type CertifiedRecord = {
  id: number;
  reportCode: string;
  taqeemReportNumber: string;
  certifiedAt: string;
};

export default function CertifiedReports() {
  const [searchQuery, setSearchQuery] = useState("");
  const { toast } = useToast();
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  // ── حالة البوت ───────────────────────────────────────────────────────────
  const [certify, setCertify] = useState<CertifyState>({
    status: "idle", logs: [], reportNumbers: [], currentIndex: 0,
  });
  const [loadingNext, setLoadingNext] = useState(false);
  const [loadingApprove, setLoadingApprove] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── سجل التقارير المعمدة ─────────────────────────────────────────────────
  const [records, setRecords] = useState<CertifiedRecord[]>([]);
  const [recordsLoading, setRecordsLoading] = useState(true);

  const fetchRecords = async () => {
    try {
      const resp = await fetch(`${apiBase}/api/certified-reports`);
      if (resp.ok) setRecords(await resp.json());
    } catch {}
    finally { setRecordsLoading(false); }
  };

  useEffect(() => { fetchRecords(); }, []);

  const filtered = records.filter(r => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return r.reportCode.toLowerCase().includes(q) || r.taqeemReportNumber.toLowerCase().includes(q);
  });

  // ── البوت ─────────────────────────────────────────────────────────────────
  const fetchCertifyStatus = async () => {
    try {
      const resp = await fetch(`${apiBase}/api/automation/certify/status`);
      if (resp.ok) {
        const data: CertifyState = await resp.json();
        setCertify(data);
        if (data.status === "ready" || data.status === "failed" || data.status === "idle") {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          // حدّث قائمة السجلات بعد اكتمال دفعة
          if (data.status !== "running") fetchRecords();
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
        toast({ title: "جارٍ فتح المتصفح...", description: "الروبوت يقرأ التقارير ويفتح الأول تلقائياً" });
        setCertify({ status: "running", logs: [], reportNumbers: [], currentIndex: 0 });
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
      setCertify({ status: "idle", logs: [], reportNumbers: [], currentIndex: 0 });
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      toast({ title: "تم إغلاق المتصفح" });
    } catch {}
  };

  const handleApproveReport = async () => {
    setLoadingApprove(true);
    try {
      const resp = await fetch(`${apiBase}/api/automation/certify/approve`, { method: "POST" });
      const data = await resp.json();
      if (resp.ok && data.success) {
        toast({ title: "✅ تم اعتماد التقرير وإرسال البيانات", description: `DC: ${data.dcNumber}` });
        await fetchCertifyStatus();
        await fetchRecords();
      } else {
        toast({ variant: "destructive", title: "خطأ في الاعتماد", description: data.error });
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ في الاتصال" });
    } finally {
      setLoadingApprove(false);
    }
  };

  const handleNextReport = async () => {
    setLoadingNext(true);
    try {
      const resp = await fetch(`${apiBase}/api/automation/certify/next`, { method: "POST" });
      const data = await resp.json();
      if (resp.ok) {
        if (data.done) {
          toast({ title: "✅ انتهت جميع التقارير" });
        } else {
          toast({ title: `📄 تم فتح التقرير ${data.reportNumber}`, description: `${data.index} من ${data.total}` });
          setCertify(prev => ({ ...prev, openedReport: data.reportNumber, currentIndex: data.index - 1 }));
        }
      } else {
        toast({ variant: "destructive", title: "خطأ", description: data.error });
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ في الاتصال" });
    } finally {
      setLoadingNext(false);
    }
  };

  const handleRefreshNumbers = async () => {
    setRefreshing(true);
    try {
      const resp = await fetch(`${apiBase}/api/automation/certify/refresh`, { method: "POST" });
      if (resp.ok) {
        const data = await resp.json();
        setCertify(prev => ({ ...prev, reportNumbers: data.reportNumbers, currentIndex: 0 }));
        toast({ title: "تم التحديث", description: `${data.count} تقرير` });
        if (data.reportNumbers?.length > 0) {
          await fetch(`${apiBase}/api/automation/certify/open`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ reportNumber: data.reportNumbers[0] }),
          });
          setCertify(prev => ({ ...prev, openedReport: data.reportNumbers[0] }));
        }
      }
    } catch {} finally { setRefreshing(false); }
  };

  const isRunning = certify.status === "running";
  const isReady   = certify.status === "ready";
  const total     = certify.reportNumbers.length;
  const current   = certify.currentIndex + 1;
  const hasNext   = certify.currentIndex < total - 1;

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
                <CardTitle className="text-base">التعميد التلقائي</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {isRunning
                    ? "جارٍ فتح المتصفح وقراءة التقارير..."
                    : isReady && total > 0
                    ? `التقرير ${current} من ${total} — رقم ${certify.openedReport ?? "—"}`
                    : isReady
                    ? "لا توجد تقارير في الصفحة"
                    : certify.status === "failed"
                    ? "فشل فتح المتصفح"
                    : "يفتح منصة تقييم ويعمّد التقارير تلقائياً"}
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              {isReady && (
                <Button onClick={handleApproveReport} disabled={loadingApprove}
                  className="gap-2 font-medium bg-emerald-700 hover:bg-emerald-800 text-white">
                  {loadingApprove
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> جارٍ الاعتماد...</>
                    : <><Stamp className="h-4 w-4" /> اعتماد التقرير</>}
                </Button>
              )}
              {isReady && total > 0 && (
                <Button onClick={handleNextReport} disabled={loadingNext || !hasNext} variant="outline" className="gap-2">
                  {loadingNext
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> جارٍ الفتح...</>
                    : hasNext
                    ? <><ChevronLeft className="h-4 w-4" /> التقرير التالي ({current + 1}/{total})</>
                    : "✅ آخر تقرير"}
                </Button>
              )}
              {isReady && (
                <Button variant="outline" size="sm" onClick={handleRefreshNumbers} disabled={refreshing} className="gap-2">
                  <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
                  تحديث القائمة
                </Button>
              )}
              {(isRunning || isReady) && (
                <Button variant="outline" size="sm" onClick={handleStopCertify}
                  className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
                  <StopCircle className="h-4 w-4" /> إغلاق
                </Button>
              )}
              <Button onClick={handleStartCertify} disabled={isRunning} className="gap-2">
                {isRunning
                  ? <><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التحميل...</>
                  : <><PlayCircle className="h-4 w-4" /> بداية التعميد</>}
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* شريط تقدم التقارير */}
        {isReady && total > 0 && (
          <CardContent className="pt-0">
            <div className="flex items-center gap-3 mb-2">
              <div className="flex-1 bg-muted rounded-full h-2">
                <div className="bg-emerald-500 h-2 rounded-full transition-all duration-500"
                  style={{ width: `${(current / total) * 100}%` }} />
              </div>
              <span className="text-xs text-muted-foreground whitespace-nowrap">{current} / {total}</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {certify.reportNumbers.map((num, idx) => (
                <Badge key={num} variant={idx === certify.currentIndex ? "default" : idx < certify.currentIndex ? "secondary" : "outline"}
                  className={`font-mono text-xs ${idx === certify.currentIndex ? "bg-emerald-600" : idx < certify.currentIndex ? "opacity-50" : ""}`}>
                  {num}
                </Badge>
              ))}
            </div>
          </CardContent>
        )}

        {certify.status === "failed" && certify.error && (
          <CardContent className="pt-0">
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{certify.error}</span>
            </div>
          </CardContent>
        )}

        {certify.logs.length > 0 && (
          <CardContent className="pt-0">
            <div className="rounded-lg bg-slate-950 text-green-400 font-mono text-xs p-3 space-y-0.5 max-h-28 overflow-y-auto" dir="ltr">
              {certify.logs.map((l, i) => <div key={i}>{l}</div>)}
            </div>
          </CardContent>
        )}
      </Card>

      {/* ─── جدول التقارير المعمدة ──────────────────────────────────────────── */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between flex-wrap gap-3">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-lg">سجل التقارير المعمدة</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  التقارير التي تم تعميدها بنجاح عبر منصة قيمة
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-sm px-3 py-1">
                {recordsLoading ? "..." : filtered.length} تقرير
              </Badge>
              <Button variant="outline" size="sm" onClick={fetchRecords} className="gap-2">
                <RefreshCw className="h-3.5 w-3.5" /> تحديث
              </Button>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم التقرير أو رقم تقييم..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
            </div>
          </div>

          {recordsLoading ? (
            <div className="space-y-3">
              {[...Array(4)].map((_, i) => <Skeleton key={i} className="h-12 w-full rounded-md" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <FileText className="h-12 w-12 opacity-30" />
              <p className="text-base font-medium">لا توجد تقارير معمدة بعد</p>
              <p className="text-sm">ستظهر هنا فور اكتمال كل تعميد تلقائي</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-right font-semibold">#</TableHead>
                    <TableHead className="text-right font-semibold">رقم التقرير (DC)</TableHead>
                    <TableHead className="text-right font-semibold">رقم تقرير قيمة</TableHead>
                    <TableHead className="text-right font-semibold">تاريخ التعميد</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered.map((rec, idx) => (
                    <TableRow key={rec.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="text-muted-foreground text-sm">{idx + 1}</TableCell>
                      <TableCell>
                        <span className="font-mono text-sm font-semibold text-blue-700 bg-blue-50 border border-blue-200 rounded px-2 py-0.5">
                          {rec.reportCode || "—"}
                        </span>
                      </TableCell>
                      <TableCell>
                        <span className="font-mono text-sm font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-0.5">
                          {rec.taqeemReportNumber || "—"}
                        </span>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {rec.certifiedAt
                          ? format(new Date(rec.certifiedAt), "d MMM yyyy — HH:mm", { locale: arSA })
                          : "—"}
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
