/**
 * pg.ts — طبقة الاتصال بـ PostgreSQL
 * تُستخدم تلقائياً على Replit عندما DATABASE_URL يبدأ بـ postgresql://
 *
 * نستخدم require() كسولاً حتى لا يُخفق البناء على Windows عند غياب pg
 */
import type { Pool as PgPool } from "pg";
import type { Report, InsertReport } from "./types";

export type { Report, InsertReport };

let _pgPool: PgPool | null = null;

function getPgPool(): PgPool {
  if (_pgPool) return _pgPool;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Pool } = require("pg") as typeof import("pg");
  _pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_URL?.includes("sslmode=require")
      ? { rejectUnauthorized: false }
      : false,
    connectionTimeoutMillis: 5000,
  });
  return _pgPool;
}

async function ensureTable(): Promise<void> {
  const pool = getPgPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS reports (
      id SERIAL PRIMARY KEY,
      report_number VARCHAR(100),
      report_date VARCHAR(50),
      valuation_date VARCHAR(50),
      inspection_date VARCHAR(50),
      commission_date VARCHAR(50),
      request_number VARCHAR(100),
      status VARCHAR(50) NOT NULL DEFAULT 'pending',
      valuer_name VARCHAR(255),
      valuer_percentage NUMERIC(5,2),
      license_number VARCHAR(100),
      license_date VARCHAR(50),
      membership_number VARCHAR(100),
      membership_type VARCHAR(100),
      second_valuer_name VARCHAR(255),
      second_valuer_percentage NUMERIC(5,2),
      second_valuer_license_number VARCHAR(100),
      second_valuer_membership_number VARCHAR(100),
      taqeem_report_number VARCHAR(100),
      client_name VARCHAR(255),
      client_email VARCHAR(255),
      client_phone VARCHAR(50),
      intended_user VARCHAR(255),
      report_type VARCHAR(100),
      valuation_purpose TEXT,
      valuation_basis VARCHAR(100),
      property_type VARCHAR(100),
      property_sub_type VARCHAR(100),
      region VARCHAR(100),
      city VARCHAR(100),
      district VARCHAR(100),
      street VARCHAR(255),
      block_number VARCHAR(50),
      plot_number VARCHAR(50),
      plan_number VARCHAR(50),
      property_use VARCHAR(100),
      deed_number VARCHAR(100),
      deed_date VARCHAR(50),
      owner_name VARCHAR(255),
      ownership_type VARCHAR(100),
      building_permit_number VARCHAR(100),
      building_status VARCHAR(100),
      building_age VARCHAR(50),
      land_area NUMERIC(15,2),
      building_area NUMERIC(15,2),
      basement_area NUMERIC(15,2),
      annex_area NUMERIC(15,2),
      floors_count INTEGER,
      permitted_floors_count INTEGER,
      permitted_building_ratio NUMERIC(5,2),
      street_width NUMERIC(8,2),
      street_facades VARCHAR(100),
      utilities TEXT,
      coordinates VARCHAR(255),
      latitude NUMERIC(12,8),
      longitude NUMERIC(12,8),
      valuation_method VARCHAR(255),
      market_way VARCHAR(500),
      income_way VARCHAR(500),
      cost_way VARCHAR(500),
      market_value NUMERIC(18,2),
      income_value NUMERIC(18,2),
      cost_value NUMERIC(18,2),
      final_value NUMERIC(18,2),
      price_per_meter NUMERIC(15,2),
      company_name VARCHAR(255),
      commercial_reg_number VARCHAR(100),
      pdf_file_name VARCHAR(500),
      pdf_file_path TEXT,
      notes TEXT,
      automation_status VARCHAR(50) NOT NULL DEFAULT 'idle',
      automation_error TEXT,
      automation_session_id VARCHAR(255),
      qr_code_base64 TEXT,
      certificate_path TEXT,
      taqeem_submitted_at VARCHAR(50),
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  // ── migration: أعمدة جديدة للقواعد الموجودة ──────────────────────────────
  const newCols = [
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS market_way VARCHAR(500)",
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS income_way VARCHAR(500)",
    "ALTER TABLE reports ADD COLUMN IF NOT EXISTS cost_way VARCHAR(500)",
  ];
  for (const sql of newCols) await pool.query(sql).catch(() => {});
}

let _tableReady = false;
async function withTable(): Promise<PgPool> {
  if (!_tableReady) {
    await ensureTable();
    _tableReady = true;
  }
  return getPgPool();
}

function rowToReport(row: any): Report {
  const num = (v: any) => (v != null ? Number(v) : null);
  const str = (v: any) => (v != null ? String(v) : null);
  return {
    id: row.id,
    reportNumber: str(row.report_number),
    reportDate: str(row.report_date),
    valuationDate: str(row.valuation_date),
    inspectionDate: str(row.inspection_date),
    commissionDate: str(row.commission_date),
    requestNumber: str(row.request_number),
    status: str(row.status) ?? "pending",
    valuerName: str(row.valuer_name),
    valuerPercentage: num(row.valuer_percentage),
    licenseNumber: str(row.license_number),
    licenseDate: str(row.license_date),
    membershipNumber: str(row.membership_number),
    membershipType: str(row.membership_type),
    secondValuerName: str(row.second_valuer_name),
    secondValuerPercentage: num(row.second_valuer_percentage),
    secondValuerLicenseNumber: str(row.second_valuer_license_number),
    secondValuerMembershipNumber: str(row.second_valuer_membership_number),
    valuersInput: str(row.valuers_input),
    taqeemReportNumber: str(row.taqeem_report_number),
    clientName: str(row.client_name),
    clientEmail: str(row.client_email),
    clientPhone: str(row.client_phone),
    intendedUser: str(row.intended_user),
    reportType: str(row.report_type),
    valuationPurpose: str(row.valuation_purpose),
    valuationHypothesis: str(row.valuation_hypothesis),
    valuationBasis: str(row.valuation_basis),
    propertyType: str(row.property_type),
    propertySubType: str(row.property_sub_type),
    region: str(row.region),
    city: str(row.city),
    district: str(row.district),
    street: str(row.street),
    blockNumber: str(row.block_number),
    plotNumber: str(row.plot_number),
    planNumber: str(row.plan_number),
    propertyUse: str(row.property_use),
    deedNumber: str(row.deed_number),
    deedDate: str(row.deed_date),
    ownerName: str(row.owner_name),
    ownershipType: str(row.ownership_type),
    buildingPermitNumber: str(row.building_permit_number),
    buildingStatus: str(row.building_status),
    buildingAge: str(row.building_age),
    buildingCompletionPercentage: str(row.building_completion_percentage),
    buildingType: str(row.building_type),
    finishingStatus: str(row.finishing_status),
    furnitureStatus: str(row.furniture_status),
    airConditioningType: str(row.air_conditioning_type),
    isLandRented: str(row.is_land_rented),
    additionalFeatures: str(row.additional_features),
    isBestUse: str(row.is_best_use),
    landArea: num(row.land_area),
    buildingArea: num(row.building_area),
    basementArea: num(row.basement_area),
    annexArea: num(row.annex_area),
    floorsCount: row.floors_count != null ? Number(row.floors_count) : null,
    permittedFloorsCount: row.permitted_floors_count != null ? Number(row.permitted_floors_count) : null,
    permittedBuildingRatio: num(row.permitted_building_ratio),
    streetWidth: num(row.street_width),
    streetFacades: str(row.street_facades),
    facadesCount: row.facades_count != null ? parseInt(String(row.facades_count)) : null,
    utilities: str(row.utilities),
    coordinates: str(row.coordinates),
    latitude: num(row.latitude),
    longitude: num(row.longitude),
    valuationMethod: str(row.valuation_method),
    marketWay: str(row.market_way),
    incomeWay: str(row.income_way),
    costWay: str(row.cost_way),
    marketValue: num(row.market_value),
    incomeValue: num(row.income_value),
    costValue: num(row.cost_value),
    marketApproachPercentage: num(row.market_approach_percentage),
    incomeApproachPercentage: num(row.income_approach_percentage),
    costApproachPercentage: num(row.cost_approach_percentage),
    finalValue: num(row.final_value),
    pricePerMeter: num(row.price_per_meter),
    companyName: str(row.company_name),
    commercialRegNumber: str(row.commercial_reg_number),
    pdfFileName: str(row.pdf_file_name),
    pdfFilePath: str(row.pdf_file_path),
    notes: str(row.notes),
    automationStatus: str(row.automation_status) ?? "idle",
    automationError: str(row.automation_error),
    automationSessionId: str(row.automation_session_id),
    qrCodeBase64: str(row.qr_code_base64),
    certificatePath: str(row.certificate_path),
    taqeemSubmittedAt: str(row.taqeem_submitted_at),
    createdAt: row.created_at instanceof Date ? row.created_at : new Date(row.created_at),
    updatedAt: row.updated_at instanceof Date ? row.updated_at : new Date(row.updated_at),
  };
}

const FIELD_MAP_PG: Record<string, string> = {
  reportNumber: "report_number", reportDate: "report_date",
  valuationDate: "valuation_date", inspectionDate: "inspection_date",
  commissionDate: "commission_date", requestNumber: "request_number",
  status: "status", valuerName: "valuer_name", valuerPercentage: "valuer_percentage",
  licenseNumber: "license_number", licenseDate: "license_date",
  membershipNumber: "membership_number", membershipType: "membership_type",
  secondValuerName: "second_valuer_name", secondValuerPercentage: "second_valuer_percentage",
  secondValuerLicenseNumber: "second_valuer_license_number",
  secondValuerMembershipNumber: "second_valuer_membership_number",
  taqeemReportNumber: "taqeem_report_number",
  clientName: "client_name", clientEmail: "client_email", clientPhone: "client_phone",
  intendedUser: "intended_user", reportType: "report_type",
  valuationPurpose: "valuation_purpose", valuationHypothesis: "valuation_hypothesis", valuationBasis: "valuation_basis",
  propertyType: "property_type", propertySubType: "property_sub_type",
  region: "region", city: "city", district: "district", street: "street",
  blockNumber: "block_number", plotNumber: "plot_number", planNumber: "plan_number",
  propertyUse: "property_use", deedNumber: "deed_number", deedDate: "deed_date",
  ownerName: "owner_name", ownershipType: "ownership_type",
  buildingPermitNumber: "building_permit_number", buildingStatus: "building_status",
  buildingAge: "building_age", landArea: "land_area", buildingArea: "building_area",
  basementArea: "basement_area", annexArea: "annex_area",
  floorsCount: "floors_count", permittedFloorsCount: "permitted_floors_count",
  permittedBuildingRatio: "permitted_building_ratio", streetWidth: "street_width",
  streetFacades: "street_facades", utilities: "utilities", coordinates: "coordinates",
  latitude: "latitude", longitude: "longitude",
  valuationMethod: "valuation_method",
  marketWay: "market_way", incomeWay: "income_way", costWay: "cost_way",
  marketValue: "market_value", incomeValue: "income_value", costValue: "cost_value",
  finalValue: "final_value",
  pricePerMeter: "price_per_meter", companyName: "company_name",
  commercialRegNumber: "commercial_reg_number", pdfFileName: "pdf_file_name",
  pdfFilePath: "pdf_file_path", notes: "notes", automationStatus: "automation_status",
  automationError: "automation_error", automationSessionId: "automation_session_id",
  qrCodeBase64: "qr_code_base64", certificatePath: "certificate_path",
  taqeemSubmittedAt: "taqeem_submitted_at",
};

export async function pgListReports(): Promise<Report[]> {
  const pool = await withTable();
  const r = await pool.query("SELECT * FROM reports ORDER BY created_at DESC");
  return r.rows.map(rowToReport);
}

export async function pgGetReportById(id: number): Promise<Report | null> {
  const pool = await withTable();
  const r = await pool.query("SELECT * FROM reports WHERE id = $1", [id]);
  return r.rows[0] ? rowToReport(r.rows[0]) : null;
}

export async function pgGetReportsByAutomationStatus(automationStatus: string): Promise<Pick<Report, "id" | "reportNumber">[]> {
  const pool = await withTable();
  const r = await pool.query("SELECT id, report_number FROM reports WHERE automation_status = $1 ORDER BY created_at ASC", [automationStatus]);
  return r.rows.map(row => ({ id: row.id, reportNumber: row.report_number ?? null }));
}

export async function pgGetReportAutomationStatus(id: number): Promise<{ automationStatus: string } | null> {
  const pool = await withTable();
  const r = await pool.query("SELECT automation_status FROM reports WHERE id = $1", [id]);
  if (!r.rows[0]) return null;
  return { automationStatus: r.rows[0].automation_status ?? "idle" };
}

export async function pgInsertReport(data: InsertReport): Promise<Report> {
  const pool = await withTable();
  const cols: string[] = [];
  const vals: any[] = [];

  for (const [jsKey, pgCol] of Object.entries(FIELD_MAP_PG)) {
    const v = (data as any)[jsKey];
    if (v !== undefined && v !== null) {
      cols.push(`"${pgCol}"`);
      vals.push(v);
    }
  }

  const placeholders = vals.map((_, i) => `$${i + 1}`).join(", ");
  const query = `INSERT INTO reports (${cols.join(", ")}) VALUES (${placeholders}) RETURNING *`;
  const r = await pool.query(query, vals);
  return rowToReport(r.rows[0]);
}

export async function pgUpdateReport(id: number, data: Partial<InsertReport>): Promise<Report | null> {
  const pool = await withTable();
  const sets: string[] = [`"updated_at" = NOW()`];
  const vals: any[] = [];
  let idx = 1;

  for (const [jsKey, pgCol] of Object.entries(FIELD_MAP_PG)) {
    const v = (data as any)[jsKey];
    if (v !== undefined) {
      sets.push(`"${pgCol}" = $${idx}`);
      vals.push(v);
      idx++;
    }
  }

  vals.push(id);
  const query = `UPDATE reports SET ${sets.join(", ")} WHERE id = $${idx} RETURNING *`;
  const r = await pool.query(query, vals);
  return r.rows[0] ? rowToReport(r.rows[0]) : null;
}

export async function pgDeleteReport(id: number): Promise<void> {
  const pool = await withTable();
  await pool.query("DELETE FROM reports WHERE id = $1", [id]);
}

export async function pgGetReportStats(): Promise<{ total: number; pending: number; extracted: number; reviewed: number; submitted: number }> {
  const pool = await withTable();
  const r = await pool.query(`
    SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN status = 'pending'   THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN status = 'extracted' THEN 1 ELSE 0 END) AS extracted,
      SUM(CASE WHEN status = 'reviewed'  THEN 1 ELSE 0 END) AS reviewed,
      SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submitted
    FROM reports
  `);
  const row = r.rows[0];
  return {
    total: Number(row?.total ?? 0),
    pending: Number(row?.pending ?? 0),
    extracted: Number(row?.extracted ?? 0),
    reviewed: Number(row?.reviewed ?? 0),
    submitted: Number(row?.submitted ?? 0),
  };
}

export async function pgHasPendingQueue(): Promise<number> {
  const pool = await withTable();
  const r = await pool.query("SELECT COUNT(*) AS cnt FROM reports WHERE automation_status = 'queued'");
  return Number(r.rows[0]?.cnt ?? 0);
}
