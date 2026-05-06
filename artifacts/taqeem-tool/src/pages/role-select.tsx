import { FileText, ClipboardList, ChevronLeft } from "lucide-react";

type Props = { onSelect: (role: "entry" | "certifier") => void };

export default function RoleSelect({ onSelect }: Props) {
  return (
    <div
      className="min-h-screen w-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-50 to-blue-50"
      dir="rtl"
    >
      <div className="mb-10 text-center">
        <div className="flex items-center justify-center gap-3 mb-3">
          <FileText className="h-9 w-9 text-primary" />
          <h1 className="text-3xl font-bold text-foreground">أداة تقارير التقييم</h1>
        </div>
        <p className="text-muted-foreground text-base">اختر دورك للمتابعة</p>
      </div>

      <div className="flex flex-col sm:flex-row gap-6 w-full max-w-2xl px-6">
        <button
          onClick={() => onSelect("entry")}
          className="flex-1 group flex flex-col items-center gap-4 p-8 bg-white border-2 border-border rounded-2xl shadow-sm hover:border-primary hover:shadow-md transition-all cursor-pointer text-right"
        >
          <div className="h-16 w-16 rounded-full bg-blue-100 flex items-center justify-center group-hover:bg-blue-200 transition-colors">
            <ClipboardList className="h-8 w-8 text-blue-600" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-foreground mb-1">مدخل بيانات</p>
            <p className="text-sm text-muted-foreground">رفع التقارير، استخراج البيانات، وإرسالها لمنصة تقييم</p>
          </div>
          <div className="flex items-center gap-1 text-sm font-medium text-primary opacity-0 group-hover:opacity-100 transition-opacity">
            <span>دخول</span>
            <ChevronLeft className="h-4 w-4" />
          </div>
        </button>

        <button
          onClick={() => onSelect("certifier")}
          className="flex-1 group flex flex-col items-center gap-4 p-8 bg-white border-2 border-border rounded-2xl shadow-sm hover:border-emerald-500 hover:shadow-md transition-all cursor-pointer text-right"
        >
          <div className="h-16 w-16 rounded-full bg-emerald-100 flex items-center justify-center group-hover:bg-emerald-200 transition-colors">
            <FileText className="h-8 w-8 text-emerald-600" />
          </div>
          <div className="text-center">
            <p className="text-xl font-bold text-foreground mb-1">معمد بيانات</p>
            <p className="text-sm text-muted-foreground">عرض ومراجعة التقارير المعمدة المرفوعة على منصة تقييم</p>
          </div>
          <div className="flex items-center gap-1 text-sm font-medium text-emerald-600 opacity-0 group-hover:opacity-100 transition-opacity">
            <span>دخول</span>
            <ChevronLeft className="h-4 w-4" />
          </div>
        </button>
      </div>
    </div>
  );
}
