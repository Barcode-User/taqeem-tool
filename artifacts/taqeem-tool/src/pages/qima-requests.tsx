import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PlayCircle, StopCircle, Loader2, CheckCircle2, AlertCircle, RefreshCw } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

type QimaStatus = "idle" | "running" | "ready" | "failed";

type QimaState = {
  status: QimaStatus;
  error?: string;
  logs: string[];
  assignedRequests: string[];
  openedCount: number;
};

export default function QimaRequestsPage() {
  const { toast } = useToast();
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const [state, setState] = useState<QimaState>({
    status: "idle", logs: [], assignedRequests: [], openedCount: 0,
  });
  const [loading, setLoading] = useState(false);
  const logsEndRef = useRef<HTMLDivElement>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const r = await fetch(`${apiBase}/api/automation/qima/status`);
      if (r.ok) setState(await r.json());
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
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

  const isRunning = state.status === "running";
  const isReady = state.status === "ready";
  const isFailed = state.status === "failed";

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
    </div>
  );
}
