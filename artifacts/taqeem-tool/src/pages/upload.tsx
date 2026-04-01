import { useState, useRef } from "react";
import { useLocation } from "wouter";
import { UploadCloud, File, AlertCircle, Loader2, CheckCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

export default function Upload() {
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [progress, setProgress] = useState(0);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const processFile = async (file: File) => {
    if (file.type !== "application/pdf") {
      toast({
        variant: "destructive",
        title: "صيغة غير مدعومة",
        description: "الرجاء رفع ملف بصيغة PDF فقط.",
      });
      return;
    }

    setIsUploading(true);
    setProgress(10);

    const progressInterval = setInterval(() => {
      setProgress((prev) => {
        if (prev >= 95) return prev;
        return prev + Math.floor(Math.random() * 5);
      });
    }, 800);

    try {
      const formData = new FormData();
      formData.append("pdf", file);

      const response = await fetch("/api/reports/upload", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error("Failed to upload");
      }

      const report = await response.json();
      
      clearInterval(progressInterval);
      setProgress(100);
      
      toast({
        title: "تم استخراج البيانات بنجاح",
        description: "تمت معالجة التقرير واستخراج الحقول بنجاح.",
      });
      
      setTimeout(() => {
        setLocation(`/reports/${report.id}`);
      }, 800);
      
    } catch (error) {
      console.error("Upload error:", error);
      clearInterval(progressInterval);
      toast({
        variant: "destructive",
        title: "فشل الرفع",
        description: "حدث خطأ أثناء معالجة التقرير. الرجاء المحاولة مرة أخرى.",
      });
      setIsUploading(false);
      setProgress(0);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      processFile(e.dataTransfer.files[0]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files.length > 0) {
      processFile(e.target.files[0]);
    }
  };

  return (
    <div className="max-w-3xl mx-auto mt-8 animate-in slide-in-from-bottom-4 duration-500">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">رفع تقرير تقييم جديد</h1>
        <p className="text-muted-foreground mt-1">
          قم برفع التقرير بصيغة PDF ليتم استخراج أكثر من 50 حقلاً تلقائياً بواسطة الذكاء الاصطناعي بدقة عالية.
        </p>
      </div>

      <Card className="shadow-md border-primary/20">
        <CardContent className="p-8">
          {!isUploading ? (
            <div
              className={`border-2 border-dashed rounded-2xl p-16 text-center transition-all cursor-pointer flex flex-col items-center justify-center
                ${isDragging 
                  ? "border-primary bg-primary/5 scale-[1.01]" 
                  : "border-muted-foreground/25 hover:border-primary/50 hover:bg-accent/30"
                }
              `}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
            >
              <input
                type="file"
                ref={fileInputRef}
                onChange={handleFileChange}
                accept="application/pdf"
                className="hidden"
              />
              <div className={`w-20 h-20 rounded-full flex items-center justify-center mb-6 transition-colors duration-300 ${isDragging ? "bg-primary/20" : "bg-primary/10"}`}>
                <UploadCloud className={`h-10 w-10 ${isDragging ? "text-primary scale-110" : "text-primary"} transition-transform duration-300`} />
              </div>
              <h3 className="text-xl font-bold text-foreground mb-2">اسحب وأفلت ملف PDF هنا</h3>
              <p className="text-muted-foreground mb-8 max-w-sm">
                الحد الأقصى لحجم الملف هو 20 ميغابايت. يجب أن يكون التقرير صادراً عن مقيّم معتمد.
              </p>
              
              <Button size="lg" type="button" className="px-8 font-bold">
                تصفح الملفات
              </Button>
            </div>
          ) : (
            <div className="py-16 px-6 flex flex-col items-center text-center space-y-8 animate-in fade-in zoom-in duration-300">
              <div className="relative">
                {progress < 100 ? (
                  <>
                    <div className="absolute inset-0 bg-primary/20 rounded-full animate-ping opacity-75"></div>
                    <Loader2 className="h-20 w-20 text-primary animate-spin relative z-10" />
                    <div className="absolute inset-0 flex items-center justify-center z-20">
                      <File className="h-8 w-8 text-primary/70" />
                    </div>
                  </>
                ) : (
                  <div className="h-20 w-20 bg-green-100 rounded-full flex items-center justify-center animate-in zoom-in">
                    <CheckCircle className="h-10 w-10 text-green-600" />
                  </div>
                )}
              </div>
              
              <div className="space-y-4 w-full max-w-md">
                <h3 className="text-xl font-bold">
                  {progress < 100 ? "جاري معالجة واستخراج البيانات..." : "اكتمل الاستخراج!"}
                </h3>
                <p className="text-muted-foreground text-sm">
                  {progress < 100 
                    ? "يقوم الذكاء الاصطناعي الآن بقراءة وتحليل التقرير لاستخراج معلومات العميل، العقار، والقيم التقديرية. يرجى الانتظار." 
                    : "يتم الآن توجيهك لصفحة المراجعة..."}
                </p>
                <div className="space-y-2 pt-4">
                  <div className="flex justify-between text-sm font-medium text-primary">
                    <span>التقدم</span>
                    <span>{progress}%</span>
                  </div>
                  <Progress value={progress} className="h-3 w-full bg-primary/10" />
                </div>
              </div>
            </div>
          )}

          <div className="mt-8 bg-blue-50/50 dark:bg-blue-900/10 border border-blue-100 dark:border-blue-900/30 rounded-xl p-5 flex gap-4 items-start">
            <div className="bg-blue-100 dark:bg-blue-800 p-2 rounded-lg shrink-0">
              <AlertCircle className="h-5 w-5 text-blue-700 dark:text-blue-300" />
            </div>
            <div>
              <h4 className="font-bold text-blue-900 dark:text-blue-200 mb-1">تعليمات هامة</h4>
              <p className="text-sm text-blue-800/80 dark:text-blue-300/80 leading-relaxed">
                النظام مدرب خصيصاً على نماذج تقارير التقييم العقاري المعتمدة من الهيئة السعودية للمقيمين المعتمدين (تقييم). تأكد من وضوح النصوص في ملف الـ PDF لضمان دقة الاستخراج بنسبة 100%.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}