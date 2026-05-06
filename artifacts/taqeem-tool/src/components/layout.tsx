import { Link, useLocation } from "wouter";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, UploadCloud, FileText, ShieldCheck, ShieldOff,
  Loader2, GitCompare, CheckCircle2, LogOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";

type SessionStatus = "not_logged_in" | "logging_in" | "waiting_otp" | "authenticated" | "failed";
type UserRole = "entry" | "certifier";

const ROLE_KEY = "taqeem_role";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";

  const [sessionStatus, setSessionStatus] = useState<SessionStatus>("not_logged_in");
  const [sessionUsername, setSessionUsername] = useState<string | undefined>();
  const [role, setRole] = useState<UserRole>(() => {
    const saved = localStorage.getItem(ROLE_KEY);
    return saved === "certifier" ? "certifier" : "entry";
  });

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
  }, [apiBase]);

  const handleSwitchRole = () => {
    localStorage.removeItem(ROLE_KEY);
    window.location.reload();
  };

  const isCertifier = role === "certifier";

  const entryNavigation = [
    { name: "لوحة القيادة",   href: "/",           icon: LayoutDashboard },
    { name: "رفع تقرير جديد", href: "/upload",      icon: UploadCloud     },
    { name: "مقارنة البيانات", href: "/datasystem",  icon: GitCompare      },
  ];

  const certifierNavigation = [
    { name: "التقارير المعمدة", href: "/", icon: CheckCircle2 },
  ];

  const navigation = isCertifier ? certifierNavigation : entryNavigation;

  const pageTitle =
    isCertifier
      ? (location === "/" ? "التقارير المعمدة" : "تفاصيل التقرير")
      : location === "/"            ? "لوحة القيادة"
      : location === "/upload"      ? "رفع تقرير جديد"
      : location === "/datasystem"  ? "مقارنة بيانات النظام"
      : location === "/taqeem-session" ? "إعدادات جلسة تقييم"
      : "تفاصيل التقرير";

  return (
    <div className="flex min-h-[100dvh] w-full bg-background font-sans" dir="rtl">
      {/* Sidebar */}
      <aside className="w-64 flex flex-col border-l border-border bg-card shadow-sm">
        <div className={`flex h-16 items-center px-6 border-b border-border text-white ${isCertifier ? "bg-emerald-700" : "bg-primary"}`}>
          <FileText className="h-6 w-6 ml-2" />
          <span className="text-lg font-bold tracking-tight">أداة تقارير التقييم</span>
        </div>

        {/* Role badge */}
        <div className={`mx-4 mt-4 mb-2 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold ${isCertifier ? "bg-emerald-100 text-emerald-700" : "bg-blue-100 text-blue-700"}`}>
          <div className={`h-2 w-2 rounded-full ${isCertifier ? "bg-emerald-500" : "bg-blue-500"}`} />
          {isCertifier ? "معمد بيانات" : "مدخل بيانات"}
        </div>

        <nav className="flex-1 px-4 py-3 space-y-1">
          {navigation.map((item) => {
            const isActive =
              location === item.href ||
              (location.startsWith("/reports/") && item.href === "/");
            return (
              <Link key={item.name} href={item.href}>
                <div
                  className={`flex items-center px-4 py-3 text-sm font-medium rounded-md cursor-pointer transition-colors ${
                    isActive
                      ? isCertifier ? "bg-emerald-50 text-emerald-700" : "bg-primary/10 text-primary"
                      : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                  }`}
                >
                  <item.icon className={`h-5 w-5 ml-3 ${isActive ? (isCertifier ? "text-emerald-600" : "text-primary") : "text-muted-foreground"}`} />
                  {item.name}
                </div>
              </Link>
            );
          })}

          {/* Session link — مدخل بيانات فقط */}
          {!isCertifier && (
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
          )}
        </nav>

        {/* Bottom: user info + switch role */}
        <div className="p-4 border-t border-border space-y-2">
          <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg">
            <div className={`h-10 w-10 rounded-full flex items-center justify-center font-bold text-white ${isCertifier ? "bg-emerald-600" : "bg-secondary"}`}>
              {isCertifier ? "ع" : "م"}
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground">
                {isCertifier ? "معمد بيانات" : "مدخل بيانات"}
              </span>
              <span className="text-xs text-muted-foreground mt-0.5">باركود للتقييم</span>
            </div>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSwitchRole}
            className="w-full justify-start text-muted-foreground hover:text-foreground"
          >
            <LogOut className="h-4 w-4 ml-2" />
            تغيير الدور
          </Button>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="h-16 border-b border-border flex items-center justify-between px-8 bg-card z-10 shadow-sm">
          <h2 className="text-lg font-bold text-foreground">{pageTitle}</h2>

          {!isCertifier && sessionStatus === "authenticated" && sessionUsername && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              تقييم: {sessionUsername}
            </div>
          )}
          {!isCertifier && (sessionStatus === "logging_in" || sessionStatus === "waiting_otp") && (
            <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              {sessionStatus === "waiting_otp" ? "انتظار OTP..." : "جارٍ تسجيل الدخول..."}
            </div>
          )}
          {isCertifier && (
            <div className="flex items-center gap-2 text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-full px-3 py-1">
              <CheckCircle2 className="h-3.5 w-3.5" />
              معمد بيانات
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
