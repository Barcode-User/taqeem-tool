import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  PlayCircle, StopCircle, Loader2, CheckCircle2,
  AlertCircle, RefreshCw, RotateCcw, Database, ChevronDown, ChevronUp,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type QimaStatus = "idle" | "running" | "ready" | "failed";

type QimaState = {
  status: QimaStatus;
  error?: string;
  logs: string[];
  assignedRequests: string[];
  openedCount: number;
};

type Submission = {
  id: number;
  requestId: string;
  dataJson: string;
  status: "pending" | "success" | "failed";
  errorMessage: string | null;
  apiUrl: string | null;
  createdAt: string;
  sentAt: string | null;
};

export default function QimaRequestsPage() {
  const { toast } = useToast();
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const [state, setState] = useState<QimaState>({
    status: "idle", logs: [], assignedRequests: [], openedCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const [submissions, setSubmissions] = useState<Submission[]>([]);
  const [submissionsLoading, setSubmissionsLoading] = useState(false);
  const [retryingId, setRetryingId] = useState<number | null>(null);
  const [expandedId, setExpandedId] = useState<number | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const r = await fetch(`${apiBase}/api/automation/qima/status`);
      if (r.ok) setState(await r.json());
    } catch {}
  };

  const fetchSubmissions = async () => {
    setSubmissionsLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/automation/qima/submissions`);
      if (r.ok) {
        const data = await r.json();
        setSubmissions(data.submissions ?? []);
      }
    } catch {} finally {
      setSubmissionsLoading(false);
    }
  };

  useEffect(() => {
    fetchStatus();
    fetchSubmissions();
    pollRef.current = setInterval(fetchStatus, 3000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [apiBase]);

  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [state.logs]);

  const handleStart = async () => {
    setLoading(true);
    try {
      const r = await fetch(`${apiBase}/api/automation/qima/start`, { method: "POST" });
      const data = await r.json();
      if (!r.ok) {
        toast({ variant: "destructive", title: "خطأ", description: data.error });
      } else {
        toast({ title: "بدأ الروبوت", description: data.message });
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ في الاتصال" });
    } finally {
      setLoading(false);
    }
  };

  const handleStop = async () => {
    await fetch(`${apiBase}/api/automation/qima/stop`, { method: "POST" });
    toast({ title: "تم الإيقاف" });
  };

  const handleRetry = async (sub: Submission) => {
    setRetryingId(sub.id);
    try {
      const r = await fetch(`${apiBase}/api/automation/qima/submissions/${sub.id}/retry`, {
        method: "POST",
      });
      const data = await r.json();
      if (data.success) {
        toast({ title: "✅ تم الإرسال بنجاح", description: `طلب #${sub.requestId}` });
      } else {
        toast({ variant: "destructive", title: "❌ فشل الإرسال", description: data.message });
      }
      await fetchSubmissions();
    } catch {
      toast({ variant: "destructive", title: "خطأ في الاتصال" });
    } finally {
      setRetryingId(null);
    }
  };

  const isRunning = state.status === "running";
  const isReady = state.status === "ready";
  const isFailed = state.status === "failed";

  const statusBadge = (s: Submission["status"]) => {
    if (s === "success") return (
      <Badge className="bg-green-100 text-green-700 border-green-200 gap-1">
        <CheckCircle2 className="h-3 w-3" /> نجح
      </Badge>
    );
    if (s === "failed") return (
      <Badge className="bg-red-100 text-red-700 border-red-200 gap-1">
        <AlertCircle className="h-3 w-3" /> فشل
      </Badge>
    );
    return (
      <Badge className="bg-slate-100 text-slate-600 border-slate-200 gap-1">
        <Loader2 className="h-3 w-3" /> معلق
      </Badge>
    );
  };

  const formatDate = (iso: string) => {
    try {
      return new Date(iso).toLocaleString("ar-SA", {
        dateStyle: "short", timeStyle: "short",
      });
    } catch { return iso; }
  };

  return (
    <div className="space-y-6" dir="rtl">
      {/* بطاقة التحكم */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className={`h-9 w-9 rounded-full flex items-center justify-center ${
                isRunning ? "bg-blue-100" : isReady ? "bg-green-100" : isFailed ? "bg-red-100" : "bg-slate-100"
              }`}>
                {isRunning ? (
                  <Loader2 className="h-5 w-5 text-blue-600 animate-spin" />
                ) : isReady ? (
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                ) : isFailed ? (
                  <AlertCircle className="h-5 w-5 text-red-500" />
                ) : (
                  <PlayCircle className="h-5 w-5 text-slate-500" />
                )}
              </div>
              <div>
                <CardTitle className="text-base">فتح الطلبات المسندة تلقائياً</CardTitle>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {isRunning
                    ? "الروبوت يعمل — جارٍ البحث وفتح الطلبات..."
                    : isReady
                    ? `اكتمل — تم فتح ${state.openedCount} طلب من ${state.assignedRequests.length}`
                    : isFailed
                    ? `فشل: ${state.error}`
                    : "اضغط ابدأ لفتح طلبات 'مسند تلقائيًا' في نظام قيمة"}
                </p>
              </div>
            </div>
            <div className="flex gap-2">
              {isRunning && (
                <Button variant="outline" size="sm" onClick={handleStop}
                  className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
                  <StopCircle className="h-4 w-4" /> إيقاف
                </Button>
              )}
              {!isRunning && (
                <Button onClick={handleStart} disabled={loading} className="gap-2 bg-violet-600 hover:bg-violet-700">
                  {loading
                    ? <><Loader2 className="h-4 w-4 animate-spin" /> جارٍ التشغيل...</>
                    : <><PlayCircle className="h-4 w-4" /> ابدأ</>}
                </Button>
              )}
              <Button variant="outline" size="sm" onClick={fetchStatus} className="gap-2">
                <RefreshCw className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardHeader>

        {/* الطلبات المكتشفة */}
        {state.assignedRequests.length > 0 && (
          <CardContent className="pt-0">
            <div className="rounded-lg bg-violet-50 border border-violet-200 p-3">
              <p className="text-sm font-medium text-violet-800 mb-2">
                الطلبات المسندة تلقائياً ({state.assignedRequests.length}):
              </p>
              <div className="flex flex-wrap gap-2">
                {state.assignedRequests.map((url, i) => {
                  const match = url.match(/\/(\d+)/);
                  const id = match ? match[1] : `طلب ${i + 1}`;
                  return (
                    <a
                      key={i}
                      href={url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs bg-white border border-violet-300 rounded px-2 py-1 text-violet-700 hover:bg-violet-100 transition-colors"
                    >
                      #{id}
                    </a>
                  );
                })}
              </div>
            </div>
          </CardContent>
        )}

        {/* رسالة خطأ */}
        {isFailed && state.error && (
          <CardContent className="pt-0">
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-700 p-3 text-sm">
              {state.error}
            </div>
          </CardContent>
        )}
      </Card>

      {/* سجل العمليات */}
      {state.logs.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-medium text-muted-foreground">سجل العمليات</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-slate-950 rounded-lg p-4 h-64 overflow-y-auto font-mono text-xs text-green-400 space-y-1">
              {state.logs.map((log, i) => {
                const parts = log.match(/^\[(.+?)\] (.+)$/);
                const time = parts ? new Date(parts[1]).toLocaleTimeString("ar-SA") : "";
                const msg = parts ? parts[2] : log;
                return (
                  <div key={i} className="flex gap-2">
                    <span className="text-slate-500 shrink-0">{time}</span>
                    <span className={
                      msg.startsWith("❌") ? "text-red-400" :
                      msg.startsWith("✅") ? "text-green-400" :
                      msg.startsWith("⚠️") ? "text-yellow-400" :
                      msg.startsWith("🎉") ? "text-emerald-300" :
                      "text-slate-300"
                    }>{msg}</span>
                  </div>
                );
              })}
              <div ref={logsEndRef} />
            </div>
          </CardContent>
        </Card>
      )}

      {/* سجل الإرسالات */}
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Database className="h-4 w-4 text-violet-500" />
              <CardTitle className="text-base">سجل الإرسالات</CardTitle>
              {submissions.length > 0 && (
                <Badge variant="outline" className="text-xs">
                  {submissions.length}
                </Badge>
              )}
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={fetchSubmissions}
              disabled={submissionsLoading}
              className="gap-1.5"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${submissionsLoading ? "animate-spin" : ""}`} />
              تحديث
            </Button>
          </div>
        </CardHeader>
        <CardContent className="pt-0">
          {submissions.length === 0 ? (
            <div className="text-center py-10 text-muted-foreground text-sm">
              {submissionsLoading ? "جارٍ التحميل..." : "لا توجد إرسالات بعد"}
            </div>
          ) : (
            <div className="space-y-2">
              {submissions.map(sub => (
                <div
                  key={sub.id}
                  className={`border rounded-lg overflow-hidden transition-colors ${
                    sub.status === "success"
                      ? "border-green-200 bg-green-50/40"
                      : sub.status === "failed"
                      ? "border-red-200 bg-red-50/40"
                      : "border-slate-200"
                  }`}
                >
                  {/* صف رئيسي */}
                  <div className="flex items-center gap-3 p-3">
                    <span className="text-xs text-muted-foreground font-mono w-6 text-center">
                      #{sub.id}
                    </span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium text-sm">طلب {sub.requestId}</span>
                        {statusBadge(sub.status)}
                      </div>
                      <div className="flex gap-3 mt-0.5 text-xs text-muted-foreground">
                        <span>أُنشئ: {formatDate(sub.createdAt)}</span>
                        {sub.sentAt && <span>أُرسل: {formatDate(sub.sentAt)}</span>}
                      </div>
                      {sub.errorMessage && sub.status === "failed" && (
                        <p className="text-xs text-red-600 mt-1 truncate max-w-sm">
                          {sub.errorMessage}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      {sub.status === "failed" && (
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => handleRetry(sub)}
                          disabled={retryingId === sub.id}
                          className="gap-1.5 text-xs h-7 border-amber-300 text-amber-700 hover:bg-amber-50"
                        >
                          {retryingId === sub.id ? (
                            <Loader2 className="h-3 w-3 animate-spin" />
                          ) : (
                            <RotateCcw className="h-3 w-3" />
                          )}
                          إعادة إرسال
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => setExpandedId(expandedId === sub.id ? null : sub.id)}
                        className="h-7 w-7 p-0"
                      >
                        {expandedId === sub.id
                          ? <ChevronUp className="h-3.5 w-3.5" />
                          : <ChevronDown className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>

                  {/* تفاصيل قابلة للطي */}
                  {expandedId === sub.id && (
                    <div className="border-t border-dashed p-3 bg-white/60">
                      {sub.apiUrl && (
                        <p className="text-xs text-muted-foreground mb-2">
                          <span className="font-medium">API URL:</span>{" "}
                          <span className="font-mono break-all">{sub.apiUrl}</span>
                        </p>
                      )}
                      {sub.errorMessage && (
                        <p className="text-xs text-red-600 mb-2">
                          <span className="font-medium">الخطأ:</span> {sub.errorMessage}
                        </p>
                      )}
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
                          البيانات المُرسَلة
                        </summary>
                        <pre className="mt-2 bg-slate-100 rounded p-2 overflow-x-auto text-[10px] leading-relaxed max-h-48">
                          {(() => {
                            try {
                              return JSON.stringify(JSON.parse(sub.dataJson), null, 2);
                            } catch {
                              return sub.dataJson;
                            }
                          })()}
                        </pre>
                      </details>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
