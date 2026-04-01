import { useState } from "react";
import { Link } from "wouter";
import { useListReports, useGetReportStats } from "@workspace/api-client-react";
import { 
  Card, 
  CardContent, 
  CardDescription, 
  CardHeader, 
  CardTitle 
} from "@/components/ui/card";
import { 
  Table, 
  TableBody, 
  TableCell, 
  TableHead, 
  TableHeader, 
  TableRow 
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { FileText, Clock, CheckCircle2, Upload, AlertCircle, PlusCircle, Search, Filter } from "lucide-react";
import { format } from "date-fns";
import { arSA } from "date-fns/locale";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

const statusMap: Record<string, { label: string, color: string }> = {
  pending: { label: "قيد الانتظار", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400 border-yellow-200" },
  extracted: { label: "تم الاستخراج", color: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400 border-blue-200" },
  reviewed: { label: "تمت المراجعة", color: "bg-purple-100 text-purple-800 dark:bg-purple-900/30 dark:text-purple-400 border-purple-200" },
  submitted: { label: "تم الرفع", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400 border-green-200" },
};

export default function Dashboard() {
  const { data: reports, isLoading: reportsLoading } = useListReports();
  const { data: stats, isLoading: statsLoading } = useGetReportStats();

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const filteredReports = reports?.filter((report) => {
    const matchesSearch = 
      !searchQuery || 
      (report.reportNumber?.includes(searchQuery)) || 
      (report.clientName?.includes(searchQuery)) ||
      (report.propertyType?.includes(searchQuery));
      
    const matchesStatus = statusFilter === "all" || report.status === statusFilter;
    
    return matchesSearch && matchesStatus;
  });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">ملخص التقارير</h1>
          <p className="text-muted-foreground mt-1">تتبع حالة تقارير التقييم الخاصة بك</p>
        </div>
        <Link href="/upload">
          <Button className="gap-2">
            <PlusCircle className="h-4 w-4" />
            رفع تقرير جديد
          </Button>
        </Link>
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <Card className="border-t-4 border-t-slate-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">إجمالي التقارير</CardTitle>
            <div className="h-8 w-8 bg-slate-100 text-slate-600 rounded-full flex items-center justify-center">
              <FileText className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold">{stats?.total || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-yellow-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">قيد الانتظار / مستخرج</CardTitle>
            <div className="h-8 w-8 bg-yellow-100 text-yellow-600 rounded-full flex items-center justify-center">
              <Clock className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold">{(stats?.pending || 0) + (stats?.extracted || 0)}</div>
            )}
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-purple-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تمت المراجعة</CardTitle>
            <div className="h-8 w-8 bg-purple-100 text-purple-600 rounded-full flex items-center justify-center">
              <CheckCircle2 className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold">{stats?.reviewed || 0}</div>
            )}
          </CardContent>
        </Card>
        <Card className="border-t-4 border-t-green-500 shadow-sm">
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">تم الرفع لتقييم</CardTitle>
            <div className="h-8 w-8 bg-green-100 text-green-600 rounded-full flex items-center justify-center">
              <Upload className="h-4 w-4" />
            </div>
          </CardHeader>
          <CardContent>
            {statsLoading ? (
              <Skeleton className="h-8 w-16" />
            ) : (
              <div className="text-3xl font-bold">{stats?.submitted || 0}</div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card className="shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle>أحدث التقارير</CardTitle>
          <CardDescription>التقارير التي تم معالجتها مؤخراً</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row gap-4 mb-6">
            <div className="relative flex-1 max-w-sm">
              <Search className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input 
                placeholder="بحث برقم التقرير، اسم العميل..." 
                className="pl-3 pr-10"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div className="w-full sm:w-48">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <Filter className="h-4 w-4 ml-2 text-muted-foreground" />
                  <SelectValue placeholder="تصفية حسب الحالة" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">جميع الحالات</SelectItem>
                  <SelectItem value="pending">قيد الانتظار</SelectItem>
                  <SelectItem value="extracted">تم الاستخراج</SelectItem>
                  <SelectItem value="reviewed">تمت المراجعة</SelectItem>
                  <SelectItem value="submitted">تم الرفع</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {reportsLoading ? (
            <div className="space-y-4">
              {[1, 2, 3, 4, 5].map((i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filteredReports && filteredReports.length > 0 ? (
            <div className="rounded-md border">
              <Table>
                <TableHeader className="bg-muted/50">
                  <TableRow>
                    <TableHead className="text-right">رقم التقرير</TableHead>
                    <TableHead className="text-right">اسم العميل</TableHead>
                    <TableHead className="text-right">نوع العقار</TableHead>
                    <TableHead className="text-right">تاريخ التقرير</TableHead>
                    <TableHead className="text-right">الحالة</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredReports.map((report) => (
                    <TableRow key={report.id} className="cursor-pointer hover:bg-muted/50 transition-colors">
                      <TableCell className="font-medium">
                        <Link href={`/reports/${report.id}`}>
                          <div className="block w-full py-1 text-primary hover:underline">{report.reportNumber || "—"}</div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/reports/${report.id}`}>
                          <div className="block w-full py-1">{report.clientName || "—"}</div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/reports/${report.id}`}>
                          <div className="block w-full py-1">{report.propertyType || "—"}</div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/reports/${report.id}`}>
                          <div className="block w-full py-1 text-muted-foreground">
                            {report.reportDate ? format(new Date(report.reportDate), "dd MMMM yyyy", { locale: arSA }) : "—"}
                          </div>
                        </Link>
                      </TableCell>
                      <TableCell>
                        <Link href={`/reports/${report.id}`}>
                          <div className="block w-full py-1">
                            <Badge variant="outline" className={`${statusMap[report.status]?.color} px-2 py-0.5 rounded-full font-normal`}>
                              {statusMap[report.status]?.label || report.status}
                            </Badge>
                          </div>
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-16 text-center border-2 border-dashed rounded-lg bg-muted/20">
              <AlertCircle className="h-12 w-12 text-muted-foreground mb-4 opacity-50" />
              <h3 className="text-xl font-bold text-foreground">لا توجد تقارير مطابقة</h3>
              <p className="text-muted-foreground mt-2 max-w-sm">
                لم يتم العثور على تقارير تطابق معايير البحث الحالية. جرب تغيير كلمات البحث أو المرشحات.
              </p>
              {reports && reports.length === 0 && (
                <Link href="/upload" className="mt-6">
                  <Button>رفع أول تقرير</Button>
                </Link>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}