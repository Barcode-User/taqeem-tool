# TaqeemApi — .NET 10 + SQL Server

نسخة .NET 10 من أداة تقارير التقييم، تستخدم SQL Server كقاعدة بيانات.

## الإعداد

### 1. متطلبات التشغيل
- .NET 10 SDK
- SQL Server (أي إصدار: 2019، 2022، Azure SQL)

### 2. إعداد Connection String

عدّل ملف `appsettings.json`:

```json
"ConnectionStrings": {
  "SqlServer": "Server=YOUR_SERVER;Database=TaqeemDb;User Id=YOUR_USER;Password=YOUR_PASSWORD;TrustServerCertificate=True;"
}
```

أو عبر environment variable:
```bash
export ConnectionStrings__SqlServer="Server=...;Database=TaqeemDb;..."
```

### 3. إعداد OpenAI

```json
"OpenAI": {
  "ApiKey": "sk-...",
  "BaseUrl": "https://api.openai.com/v1",
  "Model": "gpt-4o"
}
```

### 4. تشغيل المشروع

```bash
dotnet run
```

قاعدة البيانات تُنشأ تلقائياً عند أول تشغيل (EF Core migrations).

## نقاط النهاية (Endpoints)

### التقارير
| Method | URL | الوصف |
|--------|-----|-------|
| GET | /api/reports | قائمة التقارير |
| GET | /api/reports/{id} | تفاصيل تقرير |
| POST | /api/reports/upload | رفع PDF جديد |
| PATCH | /api/reports/{id} | تعديل تقرير |
| DELETE | /api/reports/{id} | حذف تقرير |

### الأتمتة
| Method | URL | الوصف |
|--------|-----|-------|
| GET | /api/automation/session-status | حالة جلسة تقييم |
| POST | /api/automation/login | تسجيل الدخول |
| POST | /api/automation/login-otp | إدخال OTP |
| POST | /api/automation/logout | تسجيل الخروج |
| POST | /api/automation/start/{id} | بدء الرفع الآلي |
| GET | /api/automation/status/{id} | حالة الرفع |
| GET | /api/automation/certificate/{id} | تحميل الشهادة |
| POST | /api/automation/retry/{id} | إعادة المحاولة |

## ملاحظة هامة

الـ selectors في `Automation/TaqeemBot.cs` تحتاج تحديثاً بناءً على صفحات منصة تقييم الفعلية.
