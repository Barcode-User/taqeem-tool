import { Link, useLocation } from "wouter";
import { LayoutDashboard, UploadCloud, FileText } from "lucide-react";

export default function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();

  const navigation = [
    { name: "لوحة القيادة", href: "/", icon: LayoutDashboard },
    { name: "رفع تقرير جديد", href: "/upload", icon: UploadCloud },
  ];

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
            const isActive = location === item.href || (location.startsWith("/reports/") && item.href === "/");
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
        </nav>
        
        <div className="p-4 border-t border-border">
          <div className="flex items-center gap-3 px-3 py-2 bg-muted/50 rounded-lg">
            <div className="h-10 w-10 rounded-full bg-secondary flex items-center justify-center text-secondary-foreground font-bold">
              م
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-bold text-foreground">مقيّم معتمد</span>
              <span className="text-xs text-muted-foreground mt-0.5">رقم الترخيص: 12345</span>
            </div>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 flex flex-col overflow-hidden bg-background">
        <div className="h-16 border-b border-border flex items-center justify-between px-8 bg-card z-10 shadow-sm">
          <h2 className="text-lg font-bold text-foreground">
            {location === "/" ? "لوحة القيادة" : 
             location === "/upload" ? "رفع تقرير جديد" : 
             "تفاصيل التقرير"}
          </h2>
        </div>
        <div className="flex-1 overflow-auto p-8">
          {children}
        </div>
      </main>
    </div>
  );
}