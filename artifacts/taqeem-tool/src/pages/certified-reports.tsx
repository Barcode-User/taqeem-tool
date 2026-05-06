import { useState } from "react";
import { Link } from "wouter";
import { useListReports } from "@workspace/api-client-react";
import {
  Card, CardContent, CardHeader, CardTitle,
} from "@/components/ui/card";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CheckCircle2, Search, FileText, Eye } from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";

export default function CertifiedReports() {
  const [searchQuery, setSearchQuery] = useState("");

  const { data: allReports, isLoading } = useListReports({
    query: { staleTime: 30_000, refetchOnWindowFocus: true },
  });

  const reports = allReports?.filter(
    (r) => (r as any).automationStatus === "completed",
  );

  const filtered = reports?.filter((r) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      r.reportNumber?.toLowerCase().includes(q) ||
      r.clientName?.toLowerCase().includes(q) ||
      r.propertyType?.toLowerCase().includes(q) ||
      r.region?.toLowerCase().includes(q) ||
      r.city?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="h-9 w-9 rounded-full bg-emerald-100 flex items-center justify-center">
                <CheckCircle2 className="h-5 w-5 text-emerald-600" />
              </div>
              <div>
                <CardTitle className="text-lg">التقارير المعمدة</CardTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  التقارير المرفوعة بنجاح على منصة تقييم
                </p>
              </div>
            </div>
            <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200 text-sm px-3 py-1">
              {isLoading ? "..." : (filtered?.length ?? 0)} تقرير
            </Badge>
          </div>
        </CardHeader>

        <CardContent>
          <div className="flex items-center gap-3 mb-4">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="بحث برقم التقرير أو اسم العميل..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pr-9"
              />
            </div>
          </div>

          {isLoading ? (
            <div className="space-y-3">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full rounded-md" />
              ))}
            </div>
          ) : filtered?.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground gap-3">
              <FileText className="h-12 w-12 opacity-30" />
              <p className="text-base font-medium">لا توجد تقارير معمدة</p>
              <p className="text-sm">التقارير المرفوعة بنجاح على تقييم ستظهر هنا</p>
            </div>
          ) : (
            <div className="rounded-md border overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow className="bg-muted/40">
                    <TableHead className="text-right font-semibold">رقم التقرير</TableHead>
                    <TableHead className="text-right font-semibold">العميل</TableHead>
                    <TableHead className="text-right font-semibold">نوع الأصل</TableHead>
                    <TableHead className="text-right font-semibold">المنطقة / المدينة</TableHead>
                    <TableHead className="text-right font-semibold">قيمة التقييم</TableHead>
                    <TableHead className="text-right font-semibold">تاريخ التقرير</TableHead>
                    <TableHead className="text-right font-semibold">عرض</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filtered?.map((report) => (
                    <TableRow key={report.id} className="hover:bg-muted/30 transition-colors">
                      <TableCell className="font-mono text-sm font-medium text-primary">
                        {report.reportNumber || "—"}
                      </TableCell>
                      <TableCell className="font-medium">
                        {report.clientName || "—"}
                      </TableCell>
                      <TableCell>{report.propertyType || "—"}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {[report.region, report.city].filter(Boolean).join(" / ") || "—"}
                      </TableCell>
                      <TableCell className="font-medium text-emerald-700">
                        {report.finalValue
                          ? Number(report.finalValue).toLocaleString("ar-SA") + " ر.س"
                          : "—"}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {report.reportDate
                          ? format(new Date(report.reportDate), "d MMM yyyy", { locale: arSA })
                          : "—"}
                      </TableCell>
                      <TableCell>
                        <Link href={`/reports/${report.id}`}>
                          <Button variant="ghost" size="sm" className="h-8 px-2">
                            <Eye className="h-4 w-4 ml-1" />
                            عرض
                          </Button>
                        </Link>
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
