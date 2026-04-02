import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import { LayoutDashboard, UploadCloud, FileText, ShieldCheck, ShieldOff, Loader2 } from "lucide-react";

type SessionStatus = "not_logged_in" | "logging_in" | "waiting_otp" | "authenticated" | "failed";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("not_logged_in");
  const [sessionUsername, setSessionUsername] = useState<string | undefined>();

  useEffect(() => {
    const check = async () => {
      try {
        const resp = await fetch(`${apiBase}/api/automation/session-status`);
        if (resp.ok) {
          const data = await resp.json();
          setSessionStatus(data.status);
          setSessionUsername(data.username);
        }
      } catch {}
    };
    check();
    const interval = setInterval(check, 30000);
    return () => clearInterval(interval);
  }, []);

  const navigation = [
    { name: "لوحة القيادة", href: "/", icon: LayoutDashboard },
    { name: "رفع تقرير جديد", href: "/upload", icon: UploadCloud },
  ];

  const pageTitle =
    location === "/" ? "لوحة القيادة" :
    location === "/upload" ? "رفع تقرير جديد" :
    location === "/taqeem-session" ? "إعدادات جلسة تقييم" :
    "تفاصيل التقرير";

  return (
    <div className="flex min-h-[100dvh] w-full bg-background font-sans" dir="rtl">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col border-l border-border bg-card shadow-sm">
        <div className="flex h-16 items-center px-6 border-b border-border bg-primary text-primary-foreground">
          <FileText className="h-6 w-6 ml-2" />
          <span className="text-lg font-bold tracking-tight">أداة تقارير التقييم</span>
        </div>

        <nav className="flex-1 px-4 py-6 space-y-2">
          {navigation.map((item) => {
            const isActive =
              location === item.href ||
              (location.startsWith("/reports/") && item.href === "/");
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={`flex items-center px-4 py-3 text-sm font-medium rounded-md cursor-pointer transition-colors ${
                    isActive
                      ? "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <item.icon className={`h-5 w-5 ml-3 ${isActive ? "text-primary" : "text-muted-foreground"}`} />
                  {item.name}
                </div>
              </Link>
            );
          })}

          {/* Session Link */}
          <Link href="/taqeem-session">
            <div
              className={`flex items-center px-4 py-3 text-sm font-medium rounded-md cursor-pointer transition-colors ${
                location === "/taqeem-session"
                  ? "bg-primary/10 text-primary"
                  : sessionStatus === "authenticated"
                  ? "text-green-700 hover:bg-green-50"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {sessionStatus === "authenticated" ? (
                <ShieldCheck className="h-5 w-5 ml-3 text-green-600" />
              ) : sessionStatus === "logging_in" || sessionStatus === "waiting_otp" ? (
                <Loader2 className="h-5 w-5 ml-3 animate-spin text-blue-500" />
              ) : (
                <ShieldOff className="h-5 w-5 ml-3 text-muted-foreground" />
              )}
              <span>جلسة تقييم</span>
              {sessionStatus === "authenticated" && (
                <span className="mr-auto text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5">مسجّل</span>
              )}
              {(sessionStatus === "logging_in" || sessionStatus === "waiting_otp") && (
                <span className="mr-auto text-xs bg-blue-100 text-blue-700 rounded px-1.5 py-0.5">جارٍ...</span>
              )}
            </div>
          </Link>
        </nav>

        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg">
            <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-bold">
              م
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground">مقيّم معتمد</span>
              <span className="text-xs text-muted-foreground mt-0.5">رقم الترخيص: 1301</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="h-16 border-b border-border flex items-center justify-between px-8 bg-card z-10 shadow-sm">
          <h2 className="text-lg font-bold text-foreground">{pageTitle}</h2>

          {/* Session status badge in header */}
          {sessionStatus === "authenticated" && sessionUsername && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              تقييم: {sessionUsername}
            </div>
          )}
          {(sessionStatus === "logging_in" || sessionStatus === "waiting_otp") && (
            <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {sessionStatus === "waiting_otp" ? "انتظار OTP..." : "جارٍ تسجيل الدخول..."}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}
