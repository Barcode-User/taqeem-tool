# أداة تقارير التقييم (Taqeem Reports Tool)

أداة ويب لشركات التقييم العقاري السعودية لاستخراج بيانات تقارير PDF تلقائياً بالذكاء الاصطناعي وإعدادها للرفع على منصة TAQEEM الحكومية.

## Project Structure

```
artifacts/
  taqeem-tool/         → React + Vite frontend (Arabic RTL, port from $PORT)
  api-server/          → Express API server (port 8080)
  mockup-sandbox/      → Component preview (design exploration)
lib/
  db/                  → Drizzle ORM schema + PostgreSQL
  api-spec/            → OpenAPI spec (openapi.yaml)
  api-client-react/    → Orval-generated React Query hooks
  api-zod/             → Orval-generated Zod schemas
  integrations-openai-ai-server/ → OpenAI client (Replit AI integration)
```

## Key Features

- **PDF Upload & AI Extraction**: Upload PDF valuation reports, AI (OpenAI GPT) extracts 50+ structured fields
- **Full CRUD**: Review, edit, and manage all extracted report data
- **Status Tracking**: pending → extracted → reviewed → submitted
- **Arabic RTL UI**: Fully in Arabic with RTL layout

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| GET | /api/reports | List all reports |
| GET | /api/reports/stats | Get report counts by status |
| GET | /api/reports/:id | Get single report |
| POST | /api/reports | Create report |
| POST | /api/reports/upload | Upload PDF + AI extract (multipart/form-data, field: `pdf`) |
| PATCH | /api/reports/:id | Update report fields |
| PATCH | /api/reports/:id/status | Update report status |
| DELETE | /api/reports/:id | Delete report |

## Database

PostgreSQL via `DATABASE_URL`. Schema managed by Drizzle ORM.

Table: `reports` — 50+ fields covering report metadata, valuer info, client info, property details, and valuation results.

To push schema changes:
```bash
pnpm --filter @workspace/db run push
```

## AI Integration

Uses OpenAI via Replit AI Integrations proxy. Environment variables set automatically:
- `AI_INTEGRATIONS_OPENAI_BASE_URL`
- `AI_INTEGRATIONS_OPENAI_API_KEY`

Model: `gpt-5.2` with `response_format: { type: "json_object" }`

## Report Status Flow

1. **pending** (قيد الانتظار) — Created but no data
2. **extracted** (تم الاستخراج) — AI extracted data from PDF
3. **reviewed** (تمت المراجعة) — Manually reviewed and edited
4. **submitted** (تم الرفع) — Submitted to TAQEEM platform

## Development

```bash
# Install dependencies
pnpm install

# Push database schema
pnpm --filter @workspace/db run push

# Run API codegen (after changing openapi.yaml)
pnpm --filter @workspace/api-spec run codegen
```

## Relevant Files

- `lib/api-spec/openapi.yaml` — API spec (source of truth for hooks/schemas)
- `lib/db/src/schema/reports.ts` — Database schema
- `artifacts/api-server/src/routes/reports.ts` — All report API routes
- `artifacts/taqeem-tool/src/App.tsx` — Frontend router
- `lib/api-client-react/src/generated/api.ts` — Generated hooks
