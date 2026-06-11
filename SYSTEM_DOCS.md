# توثيق نظام أداة تقارير التقييم

---

## 1. نظرة عامة على النظام

النظام عبارة عن **أداة ويب محلية** تعمل على جهاز Windows. مهمتها:
1. **رفع PDF** → استخراج بياناته تلقائياً بالذكاء الاصطناعي
2. **مراجعة البيانات** يدوياً
3. **رفعها آلياً** على منصة تقييم الحكومية

---

## 2. بنية المشروع

```
المشروع/
├── artifacts/
│   ├── api-server/          ← السيرفر (Node.js + Express)
│   │   ├── dist/            ← الكود المُجمَّع (هذا ما يُشغَّل فعلياً)
│   │   └── src/             ← الكود المصدري (للتعديل ثم البناء)
│   └── taqeem-tool/         ← الواجهة الأمامية (React)
│       └── dist/public/     ← الواجهة المُجمَّعة (تُقدَّم من السيرفر)
├── lib/
│   └── db/src/
│       ├── sqlite.ts        ← كل عمليات SQLite (الجهاز المحلي)
│       ├── pg.ts            ← PostgreSQL (Replit فقط)
│       └── types.ts         ← تعريف حقول التقرير
└── data/                    ← مجلد البيانات (يُنشأ تلقائياً)
    ├── taqeem.db            ← قاعدة البيانات SQLite
    └── config.json          ← إعدادات النظام (يمكن تعديله)
```

---

## 3. دورة حياة التقرير (Status Flow)

```
[رفع PDF]
    ↓
 pending          ← تم الإنشاء، لم تُستخرج بيانات بعد
    ↓
 extracted        ← استُخرجت البيانات من PDF بالذكاء الاصطناعي
    ↓
 reviewed         ← المستخدم راجع البيانات وأكدها
    ↓
 submitted        ← رُفع على منصة تقييم بنجاح
```

### حالات الأتمتة (automationStatus) — مستقلة عن Status:

| الحالة | المعنى | اللون في اللوحة |
|--------|--------|-----------------|
| `idle` | لم يُضاف للطابور | — |
| `queued` | في انتظار الرفع الآلي | أزرق |
| `running` | البوت يعمل الآن | أصفر |
| `submitted` | رُفع بنجاح | أخضر |
| `failed` | فشل عام | أحمر |
| `qr_error` | نجح الرفع لكن QrInformationApi فشل | أحمر |

---

## 4. ملف الإعدادات `data/config.json`

هذا الملف يُنشئه المستخدم يدوياً بجانب `start.bat`.

```json
{
  "qrApiUrl": "http://192.168.1.88:4545"
}
```

### الحقول المتاحة:

| الحقل | الوصف | القيمة الافتراضية |
|-------|-------|-------------------|
| `qrApiUrl` | عنوان نظام QrInformationApi الخارجي | `http://localhost:5000` |

**كيف يعمل:** السيرفر يقرأ هذا الملف عند كل إرسال. إذا غيّرت القيمة، التغيير يسري فوراً بدون إعادة تشغيل.

---

## 5. قاعدة البيانات (SQLite)

الملف: `data/taqeem.db` (بجانب `start.bat`)

### جدول Reports — الأعمدة الرئيسية:

| العمود (SQL) | الحقل (JS) | الوصف |
|-------------|------------|-------|
| `Id` | `id` | معرّف فريد |
| `ReportNumber` | `reportNumber` | رقم التقرير |
| `ClientName` | `clientName` | اسم العميل |
| `Status` | `status` | pending/extracted/reviewed/submitted |
| `AutomationStatus` | `automationStatus` | حالة الأتمتة |
| `AutomationError` | `automationError` | رسالة الخطأ |
| `IsPriority` | `isPriority` | أولوية في الطابور (0/1) |
| `QrCodeBase64` | `qrCodeBase64` | صورة QR كـ base64 |
| `CertificatePath` | `certificatePath` | مسار شهادة التسجيل |
| `CreatedAt` | `createdAt` | تاريخ الإنشاء |

**ملاحظة مهمة:** أسماء الأعمدة في SQL هي PascalCase (`ReportNumber`) لكن في JavaScript هي camelCase (`reportNumber`). التحويل يتم تلقائياً في `lib/db/src/sqlite.ts`.

### كيف تُضاف أعمدة جديدة:

النظام يضيف الأعمدة الجديدة تلقائياً عند التشغيل (ALTER TABLE IF NOT EXISTS). لإضافة عمود جديد:

1. أضف في `lib/db/src/sqlite.ts` داخل `getDb()`:
```typescript
addIfMissing("MyNewColumn", "TEXT");
```

2. أضف في `fieldMap` داخل `sqliteUpdateReport`:
```typescript
myNewField: "MyNewColumn",
```

3. أضف في `rowToReport`:
```typescript
myNewField: str(row.MyNewColumn),
```

4. أضف في `types.ts` داخل interface `Report`:
```typescript
myNewField: string | null;
```

---

## 6. واجهة المستخدم — الشاشات الرئيسية

### أ. لوحة التحكم (Dashboard)
**الملف:** `artifacts/taqeem-tool/src/pages/dashboard.tsx`

**التركيب الرئيسي:**
```
dashboard.tsx
├── بطاقات الإحصاء (الأعلى) → تفلتر الجدول عند الضغط عليها
├── فلاتر البحث والحالة
├── جدول التقارير (يُرتَّب: الأولوية أولاً ← الأحدث أولاً)
└── أزرار الأتمتة (تسجيل الدخول، الرفع، OTP)
```

**كيف تُضيف عموداً جديداً للجدول:**
```tsx
// في TableHeader أضف:
<TableHead className="text-right">عنوان العمود</TableHead>

// في TableBody داخل filteredReports.map أضف:
<TableCell>{report.myNewField || "—"}</TableCell>
```

**كيف تُغيّر ألوان الحالات:**
```tsx
// ابحث عن: automationStatus === "qr_error"
// الألوان في مكوّن Badge — ابحث عن statusBadge أو automationBadge
```

### ب. تفاصيل التقرير (Report Detail)
**الملف:** `artifacts/taqeem-tool/src/pages/report-detail.tsx`

**التركيب:**
```
report-detail.tsx
├── بيانات التقرير (قابلة للتعديل)
├── بيانات المقيّم
├── بيانات العقار
└── أزرار الحفظ والإرسال
```

---

## 7. السيرفر (API Server)

### أ. نقاط النهاية الرئيسية

**الملف:** `artifacts/api-server/src/routes/reports.ts`

| Method | المسار | الوظيفة |
|--------|--------|--------|
| `GET` | `/api/reports` | قائمة كل التقارير |
| `GET` | `/api/reports/stats` | إحصاء للبطاقات |
| `POST` | `/api/reports/upload` | رفع PDF + استخراج AI |
| `PATCH` | `/api/reports/:id` | تعديل أي حقل |
| `PATCH` | `/api/reports/:id/status` | تغيير الحالة فقط |
| `DELETE` | `/api/reports/:id` | حذف تقرير |

**الملف:** `artifacts/api-server/src/routes/automation.ts`

| Method | المسار | الوظيفة |
|--------|--------|--------|
| `POST` | `/api/automation/login` | تسجيل دخول تقييم |
| `POST` | `/api/automation/login-otp` | إرسال OTP |
| `POST` | `/api/automation/start/:id` | إضافة تقرير للطابور |
| `GET` | `/api/automation/queue` | عرض الطابور |
| `GET` | `/api/automation/session-status` | حالة الجلسة |

### ب. كيف تُضيف API جديدة

```typescript
// في artifacts/api-server/src/routes/reports.ts
router.get("/reports/my-new-endpoint", async (req, res) => {
  try {
    const data = await listReports();
    res.json(data);
  } catch (err: any) {
    req.log.error({ err }, "failed");
    res.status(500).json({ error: err.message });
  }
});
```

---

## 8. نظام الأتمتة (Playwright Bot)

### تدفق العمل:

```
المستخدم يضغط "رفع" → queue-processor.ts → taqeem-bot.ts
                              ↓
                    يأخذ أول تقرير في الطابور
                    (الأولوية أولاً ← الأقدم أولاً)
                              ↓
                    يفتح Chrome ويُسجّل الدخول
                              ↓
                    يملأ النموذج ويرسل
                              ↓
                    يلتقط QR Code
                              ↓
                    يُرسل QrInformationApi
                              ↓
              نجاح ✅              فشل ❌
                ↓                    ↓
          submitted             qr_error (أحمر)
          التقرير التالي         التقرير التالي
```

### الملفات:

| الملف | الوظيفة |
|-------|--------|
| `taqeem-bot.ts` | البوت الرئيسي — يفتح Chrome ويملأ النماذج |
| `queue-processor.ts` | مُدير الطابور — يُشغّل التقارير واحداً واحداً |
| `automation.ts` (routes) | تدفق الاعتماد (certify) — يراقب QR ويُرسل |
| `session-manager.ts` | يحفظ جلسة المتصفح بين التقارير |

---

## 9. نظام الأولوية (النجمة ⭐)

- النجمة تظهر **فقط** للتقارير في حالة `queued`
- الضغط عليها يُحرّك التقرير للأسفل بصرياً (في القائمة)
- في الطابور (البوت): التقارير ذات الأولوية تُعالَج **أولاً**
- يُحفظ في العمود `IsPriority` في قاعدة البيانات

**ترتيب الطابور:**
```
IsPriority DESC, CreatedAt ASC
(الأولوية أولاً ← الأقدم أولاً)
```

**الترتيب البصري في اللوحة:**
```
IsPriority ASC, CreatedAt DESC
(بدون أولوية أولاً ← الأولوية للأسفل)
```

---

## 10. خطوات التحديث على Windows

```
1. شغّل update.ps1       ← يُحمّل آخر إصدار من GitHub
2. شغّل start.bat        ← يوقف السيرفر القديم ويُشغّل الجديد
3. Ctrl+Shift+R في المتصفح ← يُحدّث الواجهة
```

### تحقق من الإصدار:
```
افتح في المتصفح: http://localhost:8080/api/v4
يجب أن يظهر: {"v":4,...}
```

---

## 11. كيف تُعدّل وتنشر تغييراً

### تغيير في الواجهة (Frontend):
```bash
# 1. عدّل الملف في artifacts/taqeem-tool/src/
# 2. في Replit (Terminal):
cd artifacts/taqeem-tool && pnpm run build
# 3. شغّل push script لرفع الملفات على GitHub
# 4. على جهاز Windows: update.ps1 → start.bat → Ctrl+Shift+R
```

### تغيير في السيرفر (Backend):
```bash
# 1. عدّل الملف في artifacts/api-server/src/ أو lib/db/src/
# 2. في Replit (Terminal):
cd artifacts/api-server && pnpm run build
# 3. رفع على GitHub
# 4. على جهاز Windows: update.ps1 → start.bat
```

---

## 12. الأخطاء الشائعة وحلولها

| المشكلة | السبب | الحل |
|---------|-------|------|
| `⚠️` في logs QrInformationApi | سيرفر قديم يعمل | run update.ps1 ثم start.bat |
| النجمة تعود للوراء | السيرفر لا يحفظ isPriority | تحديث السيرفر |
| `🛑 توقف مراقب الـ polling` | طبيعي بعد كل تقرير | مراقب جديد يبدأ للتقرير التالي |
| البوت لا يتصل بتقييم | IP خارجي محجوب | الأتمتة تعمل فقط من جهازك المحلي |
| config.json غير مقروء | مسار خاطئ | ضع الملف بجانب start.bat في مجلد data/ |

---

## 13. المتغيرات البيئية

| المتغير | الاستخدام | مكان التعريف |
|---------|----------|--------------|
| `PORT` | منفذ السيرفر (افتراضي 8080) | start.bat |
| `SQLITE_DATA_DIR` | مجلد قاعدة البيانات | اختياري |
| `DATABASE_URL` | PostgreSQL (Replit فقط) | Replit Secrets |
| `AI_INTEGRATIONS_OPENAI_API_KEY` | OpenAI لاستخراج PDF | Replit Secrets |
