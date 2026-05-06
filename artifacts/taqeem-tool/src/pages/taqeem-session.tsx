import { useState, useEffect, useRef } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  Bot,
  KeyRound,
  LogIn,
  LogOut,
  Loader2,
  Check,
  AlertCircle,
  Terminal,
  ShieldCheck,
  Clock,
} from "lucide-react";

type SessionStatus = {
  status: "not_logged_in" | "logging_in" | "waiting_otp" | "authenticated" | "failed";
  username?: string;
  loggedInAt?: string;
  sessionExpiresAt?: string;
  loginId?: string;
  logs: string[];
  error?: string;
};

const ROLE_KEY = "taqeem_role";

function getCurrentRole(): "entry" | "certifier" {
  const v = localStorage.getItem(ROLE_KEY);
  return v === "certifier" ? "certifier" : "entry";
}

export default function TaqeemSessionPage() {
  const { toast } = useToast();
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const role = getCurrentRole();

  const [session, setSession] = useState<SessionStatus>({ status: "not_logged_in", logs: [] });
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [otp, setOtp] = useState("");
  const [loading, setLoading] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchStatus = async () => {
    try {
      const resp = await fetch(`${apiBase}/api/automation/session-status?role=${role}`);
      if (resp.ok) {
        const data: SessionStatus = await resp.json();
        setSession(data);
        if (data.status === "authenticated" || data.status === "failed" || data.status === "not_logged_in") {
          if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
          setLoading(false);
        }
      }
    } catch {}
  };

  useEffect(() => {
    fetchStatus();
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const startLogin = async () => {
    if (!username || !password) return;
    setLoading(true);
    try {
      const resp = await fetch(`${apiBase}/api/automation/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await resp.json();
      if (resp.ok) {
        toast({ title: "جارٍ تسجيل الدخول...", description: "انتظر رسالة OTP على هاتفك" });
        pollRef.current = setInterval(fetchStatus, 2000);
      } else {
        toast({ variant: "destructive", title: "خطأ", description: data.error });
        setLoading(false);
      }
    } catch {
      toast({ variant: "destructive", title: "خطأ في الاتصال", description: "تعذر الاتصال بالخادم" });
      setLoading(false);
    }
  };

  const submitOtp = async () => {
    if (!otp || !session.loginId) return;
    try {
      const resp = await fetch(`${apiBase}/api/automation/login-otp`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginId: session.loginId, otp, role }),
      });
      const data = await resp.json();
      if (resp.ok) {
        setOtp("");
        toast({ title: "تم إرسال OTP", description: "جارٍ إكمال تسجيل الدخول..." });
        if (!pollRef.current) pollRef.current = setInterval(fetchStatus, 2000);
      } else {
        toast({ variant: "destructive", title: "خطأ", description: data.error });
      }
    } catch {}
  };

  const handleLogout = async () => {
    try {
      await fetch(`${apiBase}/api/automation/logout`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      setSession({ status: "not_logged_in", logs: [] });
      setUsername("");
      setPassword("");
      toast({ title: "تم تسجيل الخروج", description: "يمكنك تسجيل الدخول مجدداً في أي وقت" });
    } catch {
      toast({ variant: "destructive", title: "خطأ", description: "فشل تسجيل الخروج" });
    }
  };

  const formatExpiry = (iso?: string) => {
    if (!iso) return "";
    return new Date(iso).toLocaleString("ar-SA", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" });
  };

  const isCertifier = role === "certifier";
  const isAuthenticated = session.status === "authenticated";
  const isLoggingIn = session.status === "logging_in" || session.status === "waiting_otp" || loading;

  const sessionLabel = isCertifier
    ? "جلسة معمد البيانات — لتعميد التقارير على منصة تقييم"
    : "جلسة مدخل البيانات — لرفع التقارير على منصة تقييم";

  const afterLoginNote = isCertifier
    ? "يمكنك الآن تعميد التقارير على منصة تقييم."
    : "يمكنك الآن رفع أي عدد من التقارير بدون إعادة تسجيل الدخول.";

  return (
    <div className="max-w-xl mx-auto space-y-6">
      {/* Role badge */}
      <div className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border ${isCertifier ? "bg-emerald-50 border-emerald-200 text-emerald-800" : "bg-blue-50 border-blue-200 text-blue-800"}`}>
        <ShieldCheck className="h-4 w-4 shrink-0" />
        {sessionLabel}
      </div>

      {/* Status Card */}
      <Card>
        <CardHeader className="bg-muted/40 border-b pb-3">
          <CardTitle className="text-base flex items-center gap-2">
            <ShieldCheck className={`h-5 w-5 ${isCertifier ? "text-emerald-600" : "text-primary"}`} />
            حالة الجلسة
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-6">
          {isAuthenticated ? (
            <div className="space-y-4">
              <div className="rounded-lg bg-green-50 border border-green-200 text-green-800 p-4 flex items-start gap-3">
                <Check className="h-5 w-5 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">مسجّل الدخول ✅</p>
                  {session.username && <p className="text-sm mt-1 opacity-80">المستخدم: {session.username}</p>}
                  {session.loggedInAt && (
                    <p className="text-xs mt-1 opacity-70 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      وقت الدخول: {formatExpiry(session.loggedInAt)}
                    </p>
                  )}
                  {session.sessionExpiresAt && (
                    <p className="text-xs mt-1 opacity-70 flex items-center gap-1">
                      <Clock className="h-3 w-3" />
                      الجلسة صالحة حتى: {formatExpiry(session.sessionExpiresAt)}
                    </p>
                  )}
                  <p className="text-sm mt-2 font-medium">{afterLoginNote}</p>
                </div>
              </div>
              <Button variant="outline" onClick={handleLogout} className="gap-2 text-red-600 border-red-200 hover:bg-red-50">
                <LogOut className="h-4 w-4" />
                تسجيل الخروج
              </Button>
            </div>
          ) : isLoggingIn ? (
            <div className="rounded-lg bg-blue-50 border border-blue-200 text-blue-800 p-4 flex items-center gap-3">
              <Loader2 className="h-5 w-5 animate-spin shrink-0" />
              <div>
                <p className="font-semibold">
                  {session.status === "waiting_otp" ? "في انتظار رمز OTP..." : "جارٍ تسجيل الدخول..."}
                </p>
                {session.status === "waiting_otp" && (
                  <p className="text-sm mt-1 opacity-80">تم إرسال رمز التحقق لهاتفك — أدخله في النافذة أدناه</p>
                )}
              </div>
            </div>
          ) : session.status === "failed" ? (
            <div className="rounded-lg bg-red-50 border border-red-200 text-red-800 p-4 flex items-start gap-3">
              <AlertCircle className="h-5 w-5 shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold">فشل تسجيل الدخول</p>
                {session.error && <p className="text-sm mt-1 opacity-80">{session.error}</p>}
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-muted border p-4 text-muted-foreground text-sm">
              <p>غير مسجّل الدخول. سجّل دخولك مرة واحدة لتستخدم منصة تقييم طوال اليوم.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Login Form */}
      {!isAuthenticated && !isLoggingIn && (
        <Card>
          <CardHeader className="bg-muted/40 border-b pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <LogIn className={`h-5 w-5 ${isCertifier ? "text-emerald-600" : "text-primary"}`} />
              تسجيل الدخول لمنصة تقييم
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="space-y-2">
              <Label>اسم المستخدم</Label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="اسم المستخدم في منصة تقييم"
                dir="ltr"
              />
            </div>
            <div className="space-y-2">
              <Label>كلمة المرور</Label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="كلمة المرور"
                dir="ltr"
                onKeyDown={(e) => e.key === "Enter" && startLogin()}
              />
            </div>
            <p className="text-xs text-muted-foreground bg-amber-50 border border-amber-200 rounded p-2">
              💡 ستُطلب منك مرة واحدة فقط. بعد تسجيل الدخول، تُحفظ الجلسة لمدة 10 ساعات.
            </p>
            <Button
              onClick={startLogin}
              disabled={!username || !password}
              className={`w-full gap-2 ${isCertifier ? "bg-emerald-600 hover:bg-emerald-700" : ""}`}
            >
              <LogIn className="h-4 w-4" />
              تسجيل الدخول
            </Button>
          </CardContent>
        </Card>
      )}

      {/* OTP Card */}
      {session.status === "waiting_otp" && (
        <Card className="border-2 border-yellow-400 shadow-lg">
          <CardHeader className="bg-yellow-50 border-b border-yellow-200 pb-3">
            <CardTitle className="text-base flex items-center gap-2 text-yellow-800">
              <KeyRound className="h-5 w-5 text-yellow-600" />
              أدخل رمز التحقق OTP
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6 space-y-4">
            <div className="rounded-lg bg-yellow-50 border border-yellow-200 text-yellow-800 p-3 text-sm flex items-start gap-2">
              <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
              <span>تم إرسال رمز التحقق إلى بريدك الإلكتروني أو هاتفك المرتبط بحساب منصة تقييم.</span>
            </div>
            <div className="space-y-2">
              <Label className="font-semibold">رمز OTP</Label>
              <Input
                value={otp}
                onChange={(e) => setOtp(e.target.value.replace(/\D/g, ""))}
                placeholder="أدخل الرمز المكوّن من 6 أرقام"
                dir="ltr"
                className="text-center text-2xl tracking-[0.5em] font-bold h-14"
                maxLength={6}
                inputMode="numeric"
                onKeyDown={(e) => e.key === "Enter" && otp.length >= 4 && submitOtp()}
                autoFocus
              />
            </div>
            <Button onClick={submitOtp} disabled={otp.length < 4} className="w-full gap-2 h-11 text-base">
              <Check className="h-5 w-5" />
              تأكيد رمز OTP
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Logs */}
      {session.logs.length > 0 && (
        <Card>
          <CardHeader className="bg-muted/40 border-b pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Terminal className="h-4 w-4" />
              سجل العمليات
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="bg-slate-950 text-green-400 rounded-lg p-4 font-mono text-xs space-y-1 max-h-48 overflow-y-auto" dir="ltr">
              {session.logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
