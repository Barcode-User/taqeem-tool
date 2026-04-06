# أداة تقارير التقييم (Taqeem Reports Tool)

أداة ويب لشركات التقييم العقاري السعودية لاستخراج بيانات تقارير PDF تلقائياً بالذكاء الاصطناعي وإعدادها للرفع على منصة TAQEEM الحكومية.

## Project Structure

```
artifacts/
  taqeem-tool/         → React + Vite frontend (Arabic RTL, port from $PORT)
  api-server/          → Express API server (يعمل على 8080 محلياً)
  mockup-sandbox/      → Component preview (design exploration)
  dotnet-api/          → .NET 9 API (بديل، منفذ 8099)
lib/
  db/                  → MSSQL client (mssql package) — بدون Drizzle ORM
  api-zod/             → Orval-generated Zod schemas (مرجع للتوثيق فقط)
  integrations-openai-ai-server/ → OpenAI client (Replit AI integration)
```

## Database — SQL Server

قاعدة البيانات: **Microsoft SQL Server** (على جهاز المستخدم المحلي)

| متغير البيئة | القيمة الافتراضية |
|---|---|
| MSSQL_SERVER | 192.168.1.88 |
| MSSQL_DATABASE | TaqeemDb_Qeemah |
| MSSQL_USER | test1 |
| MSSQL_PASSWORD | (مطلوب) |

**إنشاء الجدول:** شغّل `artifacts/dotnet-api/create-tables.sql` في SSMS

### ملاحظة عن الأعمدة
- `plotNumber` (JS) يُخزَّن في عمود `PieceNumber` (SQL)
- `pdfFileName` (JS) يُخزَّن في عمود `OriginalFileName` (SQL)
- جميع تحويلات camelCase↔PascalCase تتم تلقائياً في `lib/db/src/mssql.ts`

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/reports | قائمة التقارير |
| GET | /api/reports/stats | إحصائيات التقارير |
| GET | /api/reports/:id | تقرير محدد |
| POST | /api/reports | إنشاء تقرير |
| POST | /api/reports/upload | رفع PDF + استخراج AI (field: `pdf`) |
| PATCH | /api/reports/:id | تعديل بيانات التقرير |
| PATCH | /api/reports/:id/status | تعديل الحالة |
| DELETE | /api/reports/:id | حذف التقرير |
| GET | /api/automation/session-status | حالة جلسة TAQEEM |
| POST | /api/automation/login | بدء تسجيل الدخول لـ TAQEEM |
| POST | /api/automation/login-otp | إرسال OTP |
| POST | /api/automation/logout | تسجيل الخروج |
| POST | /api/automation/start/:id | بدء الرفع الآلي لتقرير |
| GET | /api/automation/status/:id | حالة الرفع الآلي |
| POST | /api/automation/retry/:id | إعادة المحاولة |
| GET | /api/automation/queue | عرض الطابور |

## AI Integration

OpenAI عبر Replit AI Integrations proxy:
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`

Model: `gpt-4.1` مع `response_format: { type: "json_object" }`

## تدفق حالة التقرير

1. **pending** — تم الإنشاء
2. **extracted** — استُخرجت البيانات من PDF بالـ AI
3. **reviewed** — تمت المراجعة اليدوية
4. **submitted** — تم الرفع على منصة تقييم

## Automation — Playwright

- منصة تقييم (`qima.taqeem.gov.sa`) تحجب IPs الخارجية
- **الأتمتة تعمل فقط على جهاز المستخدم المحلي (Windows)**
- Playwright: Chrome حقيقي (`channel: 'chrome'`) بوضع `headless: false`
- OTP: يتحقق من hostname وليس URL كامل لتجنب false positive

## التشغيل المحلي (Windows)

```batch
git pull
pnpm install
cd artifacts\api-server
pnpm run build
set PORT=8080 && pnpm run start
```

ثم افتح http://localhost:8080

## الملفات الأساسية

- `lib/db/src/mssql.ts` — كل عمليات SQL Server (CRUD + mapper)
- `artifacts/api-server/src/app.ts` — Express app + static frontend
- `artifacts/api-server/src/routes/reports.ts` — API التقارير
- `artifacts/api-server/src/routes/automation.ts` — API الأتمتة
- `artifacts/api-server/src/automation/taqeem-session-store.ts` — إدارة جلسة TAQEEM
- `artifacts/api-server/src/automation/taqeem-bot.ts` — Playwright bot
- `artifacts/api-server/src/automation/queue-processor.ts` — معالج الطابور
- `artifacts/dotnet-api/create-tables.sql` — سكريبت إنشاء جدول SQL Server
