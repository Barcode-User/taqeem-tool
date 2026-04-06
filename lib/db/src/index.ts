/**
 * index.ts — نقطة التصدير الموحّدة لقاعدة البيانات
 *
 * - على Replit (DATABASE_URL = postgresql://...) → يستخدم PostgreSQL
 * - على الجهاز المحلي (MSSQL_CONNECTION_STRING أو MSSQL_SERVER) → يستخدم SQL Server
 */

// ─── أنواع البيانات (مشتركة بين المنصتين) ─────────────────────────────────────
export type { Report, InsertReport } from "./mssql";
export { isConfigured } from "./mssql";
export * from "./schema";

// ─── اكتشاف نوع قاعدة البيانات ────────────────────────────────────────────────
const isPostgres = !!process.env.DATABASE_URL?.startsWith("postgres");

console.log(`[DB] وضع قاعدة البيانات: ${isPostgres ? "PostgreSQL (Replit)" : "SQL Server (محلي)"}`);

// ─── استيراد جميع التطبيقات ────────────────────────────────────────────────────
import * as pg from "./pg";
import * as ms from "./mssql";

// ─── تصدير موحّد يختار التطبيق المناسب تلقائياً ───────────────────────────────
export const listReports = isPostgres
  ? pg.pgListReports : ms.listReports;

export const getReportById = isPostgres
  ? pg.pgGetReportById : ms.getReportById;

export const getReportsByAutomationStatus = isPostgres
  ? pg.pgGetReportsByAutomationStatus : ms.getReportsByAutomationStatus;

export const getReportAutomationStatus = isPostgres
  ? pg.pgGetReportAutomationStatus : ms.getReportAutomationStatus;

export const insertReport = isPostgres
  ? pg.pgInsertReport : ms.insertReport;

export const updateReport = isPostgres
  ? pg.pgUpdateReport : ms.updateReport;

export const deleteReport = isPostgres
  ? pg.pgDeleteReport : ms.deleteReport;

export const getReportStats = isPostgres
  ? pg.pgGetReportStats : ms.getReportStats;

export const hasPendingQueueDb = isPostgres
  ? pg.pgHasPendingQueue
  : async () => {
      const rows = await ms.getReportsByAutomationStatus("queued");
      return rows.length;
    };
