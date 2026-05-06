import { useState, useEffect } from "react";
import { Switch, Route, Router as WouterRouter } from "wouter";
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

const queryClient = new QueryClient();

export type UserRole = "entry" | "certifier";

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

function App() {
  const [role, setRole] = useState<UserRole | null>(() => {
    const saved = localStorage.getItem(ROLE_KEY);
    return (saved === "entry" || saved === "certifier") ? saved : null;
  });

  const handleSelectRole = (r: UserRole) => {
    localStorage.setItem(ROLE_KEY, r);
    setRole(r);
  };

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === ROLE_KEY) {
        const v = e.newValue;
        setRole((v === "entry" || v === "certifier") ? v : null);
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
