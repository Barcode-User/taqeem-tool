/**
 * index.ts — نقطة التصدير الموحّدة لقاعدة البيانات
 *
 * - على Replit (DATABASE_URL = postgresql://...) → PostgreSQL
 * - على Windows المحلي → SQLite (بدون إعداد، ملف data/taqeem.db)
 */

export type { Report, InsertReport } from "./types";
export { isConfigured } from "./types";
export * from "./schema";

const isPostgres = !!process.env.DATABASE_URL?.startsWith("postgres");

if (isPostgres) {
  console.log("[DB] وضع قاعدة البيانات: PostgreSQL (Replit)");
} else {
  console.log("[DB] وضع قاعدة البيانات: SQLite (محلي — data/taqeem.db)");
}

import * as pg  from "./pg";
import * as sq  from "./sqlite";

export const listReports = isPostgres
  ? pg.pgListReports : sq.sqliteListReports;

export const getReportById = isPostgres
  ? pg.pgGetReportById : sq.sqliteGetReportById;

export const getReportsByAutomationStatus = isPostgres
  ? pg.pgGetReportsByAutomationStatus : sq.sqliteGetReportsByAutomationStatus;

export const getReportAutomationStatus = isPostgres
  ? pg.pgGetReportAutomationStatus : sq.sqliteGetReportAutomationStatus;

export const insertReport = isPostgres
  ? pg.pgInsertReport : sq.sqliteInsertReport;

export const updateReport = isPostgres
  ? pg.pgUpdateReport : sq.sqliteUpdateReport;

export const deleteReport = isPostgres
  ? pg.pgDeleteReport : sq.sqliteDeleteReport;

export const getReportStats = isPostgres
  ? pg.pgGetReportStats : sq.sqliteGetReportStats;

export const hasPendingQueueDb = isPostgres
  ? pg.pgHasPendingQueue : sq.sqliteHasPendingQueue;

// ─── DataSystem (SQLite فقط) ─────────────────────────────────────────────────
export type { DataSystemRecord } from "./sqlite";
export const sqliteInsertDataSystem = sq.sqliteInsertDataSystem;
export const sqliteGetDataSystemById = sq.sqliteGetDataSystemById;
export const sqliteListDataSystem = sq.sqliteListDataSystem;
export const sqliteUpdateDataSystemLinkedReport = sq.sqliteUpdateDataSystemLinkedReport;
