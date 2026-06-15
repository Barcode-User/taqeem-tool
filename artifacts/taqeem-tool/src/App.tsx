import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter, Link as WouterLink, useLocation } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Layout from "@/components/layout";
import Dashboard from "@/pages/dashboard";
import Upload from "@/pages/upload";
import ReportDetails from "@/pages/report-details";
import PreviewReport from "@/pages/preview-report";
import TaqeemSessionPage from "@/pages/taqeem-session";
import DatasystemCompare from "@/pages/datasystem-compare";
import RoleSelect from "@/pages/role-select";
import CertifiedReports from "@/pages/certified-reports";
import QimaRequestsPage from "@/pages/qima-requests";
import {
  FileText as FileTextIcon,
  ShieldCheck,
  ShieldOff,
  Loader2 as Loader2Icon,
  LogOut as LogOutIcon,
  ExternalLink,
  CheckCircle2 as CheckCircle2Icon,
} from "lucide-react";

const queryClient = new QueryClient();

export type UserRole = "entry" | "certifier" | "qima";

const ROLE_KEY = "taqeem_role";

function EntryRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/upload" component={Upload} />
        <Route path="/preview/:token" component={PreviewReport} />
        <Route path="/reports/:id" component={ReportDetails} />
        <Route path="/taqeem-session" component={TaqeemSessionPage} />
        <Route path="/datasystem" component={DatasystemCompare} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function CertifierRouter() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={CertifiedReports} />
        <Route path="/reports/:id" component={ReportDetails} />
        <Route path="/taqeem-session" component={TaqeemSessionPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function QimaLayout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const apiBase = import.meta.env.BASE_URL?.replace(/\/$/, "") || "";
  const [sessionStatus, setSessionStatus] = useState<
    "not_logged_in" | "logging_in" | "waiting_otp" | "authenticated" | "failed"
  >("not_logged_in");
  const [sessionUsername, setSessionUsername] = useState<string | undefined>();

  useEffect(() => {
    const check = async () => {
      try {
        const r = await fetch(`${apiBase}/api/automation/session-status?role=qima`);
        if (r.ok) {
          const d = await r.json();
          setSessionStatus(d.status);
          setSessionUsername(d.username);
        }
      } catch {}
    };
    check();
    const iv = setInterval(check, 30000);
    return () => clearInterval(iv);
  }, [apiBase]);

  const handleSwitchRole = () => {
    localStorage.removeItem("taqeem_role");
    window.location.reload();
  };

  const pageTitle = location === "/taqeem-session" ? "جلسة تقييم" : "التقارير";

  return (
    <div className="flex min-h-[100dvh] w-full bg-background font-sans" dir="rtl">
      <aside className="w-64 flex flex-col border-l border-border bg-card shadow-sm">
        <div className="flex h-16 items-center px-6 border-b border-border text-white bg-violet-700">
          <FileTextIcon className="h-6 w-6 ml-2" />
          <span className="text-lg font-bold tracking-tight">نظام قيمة</span>
        </div>

        <div className="mx-4 mt-4 mb-2 flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold bg-violet-100 text-violet-700">
          <div className="h-2 w-2 rounded-full bg-violet-500" />
          فتح تقارير في نظام قيمة
        </div>

        <nav className="flex-1 px-4 py-3 space-y-1">
          <a
            href="https://qima.taqeem.gov.sa/qaym/request/13/tab"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center px-4 py-3 text-sm font-medium rounded-md cursor-pointer transition-colors text-muted-foreground hover:bg-accent hover:text-accent-foreground"
          >
            <ExternalLink className="h-5 w-5 ml-3 text-muted-foreground" />
            فتح الطلبات
          </a>

          <WouterLink href="/taqeem-session">
            <div
              className={`flex items-center px-4 py-3 text-sm font-medium rounded-md cursor-pointer transition-colors ${
                location === "/taqeem-session"
                  ? "bg-violet-50 text-violet-700"
                  : sessionStatus === "authenticated"
                  ? "text-green-700 hover:bg-green-50"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              }`}
            >
              {sessionStatus === "authenticated" ? (
                <ShieldCheck className="h-5 w-5 ml-3 text-green-600" />
              ) : sessionStatus === "logging_in" || sessionStatus === "waiting_otp" ? (
                <Loader2Icon className="h-5 w-5 ml-3 animate-spin text-blue-500" />
              ) : (
                <ShieldOff className="h-5 w-5 ml-3 text-muted-foreground" />
              )}
              <span>جلسة تقييم</span>
              {sessionStatus === "authenticated" && (
                <span className="mr-auto text-xs bg-green-100 text-green-700 rounded px-1.5 py-0.5">مسجّل</span>
              )}
            </div>
          </WouterLink>
        </nav>

        <div className="p-4 border-t border-border space-y-2">
          <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg">
            <div className="h-10 w-10 rounded-full flex items-center justify-center font-bold text-white bg-violet-600">
              ق
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground">نظام قيمة</span>
              <span className="text-xs text-muted-foreground mt-0.5">باركود للتقييم</span>
            </div>
          </div>
          <button
            onClick={handleSwitchRole}
            className="w-full flex items-center justify-start gap-2 px-3 py-2 text-sm text-muted-foreground hover:text-foreground hover:bg-accent rounded-md transition-colors"
          >
            <LogOutIcon className="h-4 w-4" />
            تغيير الدور
          </button>
        </div>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="h-16 border-b border-border flex items-center justify-between px-8 bg-card z-10 shadow-sm">
          <h2 className="text-lg font-bold text-foreground">{pageTitle}</h2>
          {sessionStatus === "authenticated" && sessionUsername && (
            <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 rounded-full px-3 py-1">
              <ShieldCheck className="h-3.5 w-3.5" />
              تقييم: {sessionUsername}
            </div>
          )}
          {(sessionStatus === "logging_in" || sessionStatus === "waiting_otp") && (
            <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-full px-3 py-1">
              <Loader2Icon className="h-3.5 w-3.5 animate-spin" />
              {sessionStatus === "waiting_otp" ? "انتظار OTP..." : "جارٍ تسجيل الدخول..."}
            </div>
          )}
        </div>
        <div className="flex-1 overflow-auto p-8">{children}</div>
      </main>
    </div>
  );
}

function QimaRouter() {
  return (
    <QimaLayout>
      <Switch>
        <Route path="/" component={QimaRequestsPage} />
        <Route path="/taqeem-session" component={TaqeemSessionPage} />
        <Route component={NotFound} />
      </Switch>
    </QimaLayout>
  );
}

function App() {
  const [role, setRole] = useState<UserRole | null>(() => {
    const saved = localStorage.getItem(ROLE_KEY);
    return saved === "entry" || saved === "certifier" || saved === "qima" ? (saved as UserRole) : null;
  });

  const handleSelectRole = (r: UserRole) => {
    localStorage.setItem(ROLE_KEY, r);
    setRole(r);
  };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ROLE_KEY) {
        const v = e.newValue;
        setRole(v === "entry" || v === "certifier" || v === "qima" ? (v as UserRole) : null);
      }
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          {role === null ? (
            <RoleSelect onSelect={handleSelectRole} />
          ) : role === "entry" ? (
            <EntryRouter />
          ) : role === "qima" ? (
            <QimaRouter />
          ) : (
            <CertifierRouter />
          )}
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
