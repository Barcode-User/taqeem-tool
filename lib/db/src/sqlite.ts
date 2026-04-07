/**
 * sqlite.ts — قاعدة بيانات SQLite المحلية (Windows)
 * تستخدم node:sqlite المدمج في Node.js 22+
 * ملف البيانات: data/taqeem.db بجانب start.bat
 */

import { DatabaseSync } from "node:sqlite";
import * as path from "path";
import * as fs from "fs";
import type { Report, InsertReport } from "./types";

// ─── مسار ملف البيانات ───────────────────────────────────────────────────────
const DATA_DIR = process.env.SQLITE_DATA_DIR
  ?? path.join(process.cwd(), "data");

if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, "taqeem.db");

// ─── تهيئة قاعدة البيانات ────────────────────────────────────────────────────
let _db: DatabaseSync | null = null;

function getDb(): DatabaseSync {
  if (_db) return _db;
  _db = new DatabaseSync(DB_PATH);

  _db.exec(`
    CREATE TABLE IF NOT EXISTS Reports (
      Id                        INTEGER PRIMARY KEY AUTOINCREMENT,
      ReportNumber              TEXT,
      ReportDate                TEXT,
      ValuationDate             TEXT,
      InspectionDate            TEXT,
      CommissionDate            TEXT,
      RequestNumber             TEXT,
      Status                    TEXT NOT NULL DEFAULT 'pending',
      ValuerName                TEXT,
      ValuerPercentage          REAL,
      LicenseNumber             TEXT,
      LicenseDate               TEXT,
      MembershipNumber          TEXT,
      MembershipType            TEXT,
      SecondValuerName          TEXT,
      SecondValuerPercentage    REAL,
      SecondValuerLicenseNumber TEXT,
      SecondValuerMembershipNumber TEXT,
      TaqeemReportNumber        TEXT,
      ClientName                TEXT,
      ClientEmail               TEXT,
      ClientPhone               TEXT,
      IntendedUser              TEXT,
      ReportType                TEXT,
      ValuationPurpose          TEXT,
      ValuationBasis            TEXT,
      PropertyType              TEXT,
      PropertySubType           TEXT,
      Region                    TEXT,
      City                      TEXT,
      District                  TEXT,
      Street                    TEXT,
      BlockNumber               TEXT,
      PlotNumber                TEXT,
      PlanNumber                TEXT,
      PropertyUse               TEXT,
      DeedNumber                TEXT,
      DeedDate                  TEXT,
      OwnerName                 TEXT,
      OwnershipType             TEXT,
      BuildingPermitNumber      TEXT,
      BuildingStatus            TEXT,
      BuildingAge               TEXT,
      LandArea                  REAL,
      BuildingArea              REAL,
      BasementArea              REAL,
      AnnexArea                 REAL,
      FloorsCount               INTEGER,
      PermittedFloorsCount      INTEGER,
      PermittedBuildingRatio    REAL,
      StreetWidth               REAL,
      StreetFacades             TEXT,
      Utilities                 TEXT,
      Coordinates               TEXT,
      ValuationMethod           TEXT,
      MarketValue               REAL,
      IncomeValue               REAL,
      CostValue                 REAL,
      FinalValue                REAL,
      PricePerMeter             REAL,
      CompanyName               TEXT,
      CommercialRegNumber       TEXT,
      PdfFileName               TEXT,
      PdfFilePath               TEXT,
      Notes                     TEXT,
      AutomationStatus          TEXT NOT NULL DEFAULT 'pending',
      AutomationError           TEXT,
      AutomationSessionId       TEXT,
      QrCodeBase64              TEXT,
      CertificatePath           TEXT,
      TaqeemSubmittedAt         TEXT,
      CreatedAt                 TEXT NOT NULL DEFAULT (datetime('now')),
      UpdatedAt                 TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  console.log(`[DB] SQLite: ${DB_PATH}`);
  return _db;
}

// ─── تحويل صف SQLite إلى كائن Report ─────────────────────────────────────────
function rowToReport(row: any): Report {
  const num = (v: any) => (v != null ? Number(v) : null);
  const str = (v: any) => (v != null ? String(v) : null);
  return {
    id: row.Id,
    reportNumber: str(row.ReportNumber),
    reportDate: str(row.ReportDate),
    valuationDate: str(row.ValuationDate),
    inspectionDate: str(row.InspectionDate),
    commissionDate: str(row.CommissionDate),
    requestNumber: str(row.RequestNumber),
    status: str(row.Status) ?? "pending",
    valuerName: str(row.ValuerName),
    valuerPercentage: num(row.ValuerPercentage),
    licenseNumber: str(row.LicenseNumber),
    licenseDate: str(row.LicenseDate),
    membershipNumber: str(row.MembershipNumber),
    membershipType: str(row.MembershipType),
    secondValuerName: str(row.SecondValuerName),
    secondValuerPercentage: num(row.SecondValuerPercentage),
    secondValuerLicenseNumber: str(row.SecondValuerLicenseNumber),
    secondValuerMembershipNumber: str(row.SecondValuerMembershipNumber),
    taqeemReportNumber: str(row.TaqeemReportNumber),
    clientName: str(row.ClientName),
    clientEmail: str(row.ClientEmail),
    clientPhone: str(row.ClientPhone),
    intendedUser: str(row.IntendedUser),
    reportType: str(row.ReportType),
    valuationPurpose: str(row.ValuationPurpose),
    valuationBasis: str(row.ValuationBasis),
    propertyType: str(row.PropertyType),
    propertySubType: str(row.PropertySubType),
    region: str(row.Region),
    city: str(row.City),
    district: str(row.District),
    street: str(row.Street),
    blockNumber: str(row.BlockNumber),
    plotNumber: str(row.PlotNumber),
    planNumber: str(row.PlanNumber),
    propertyUse: str(row.PropertyUse),
    deedNumber: str(row.DeedNumber),
    deedDate: str(row.DeedDate),
    ownerName: str(row.OwnerName),
    ownershipType: str(row.OwnershipType),
    buildingPermitNumber: str(row.BuildingPermitNumber),
    buildingStatus: str(row.BuildingStatus),
    buildingAge: str(row.BuildingAge),
    landArea: num(row.LandArea),
    buildingArea: num(row.BuildingArea),
    basementArea: num(row.BasementArea),
    annexArea: num(row.AnnexArea),
    floorsCount: row.FloorsCount != null ? parseInt(row.FloorsCount) : null,
    permittedFloorsCount: row.PermittedFloorsCount != null ? parseInt(row.PermittedFloorsCount) : null,
    permittedBuildingRatio: num(row.PermittedBuildingRatio),
    streetWidth: num(row.StreetWidth),
    streetFacades: str(row.StreetFacades),
    utilities: str(row.Utilities),
    coordinates: str(row.Coordinates),
    valuationMethod: str(row.ValuationMethod),
    marketValue: num(row.MarketValue),
    incomeValue: num(row.IncomeValue),
    costValue: num(row.CostValue),
    finalValue: num(row.FinalValue),
    pricePerMeter: num(row.PricePerMeter),
    companyName: str(row.CompanyName),
    commercialRegNumber: str(row.CommercialRegNumber),
    pdfFileName: str(row.PdfFileName),
    pdfFilePath: str(row.PdfFilePath),
    notes: str(row.Notes),
    automationStatus: str(row.AutomationStatus) ?? "pending",
    automationError: str(row.AutomationError),
    automationSessionId: str(row.AutomationSessionId),
    qrCodeBase64: str(row.QrCodeBase64),
    certificatePath: str(row.CertificatePath),
    taqeemSubmittedAt: str(row.TaqeemSubmittedAt),
    createdAt: new Date(row.CreatedAt),
    updatedAt: new Date(row.UpdatedAt),
  };
}

// ─── CRUD ────────────────────────────────────────────────────────────────────

export async function sqliteListReports(): Promise<Report[]> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM Reports ORDER BY CreatedAt DESC").all() as any[];
  return rows.map(rowToReport);
}

export async function sqliteGetReportById(id: number): Promise<Report | null> {
  const db = getDb();
  const row = db.prepare("SELECT * FROM Reports WHERE Id = ?").get(id) as any;
  return row ? rowToReport(row) : null;
}

export async function sqliteGetReportsByAutomationStatus(status: string): Promise<Report[]> {
  const db = getDb();
  const rows = db.prepare("SELECT * FROM Reports WHERE AutomationStatus = ?").all(status) as any[];
  return rows.map(rowToReport);
}

export async function sqliteGetReportAutomationStatus(id: number) {
  const db = getDb();
  const row = db.prepare("SELECT AutomationStatus, AutomationError FROM Reports WHERE Id = ?").get(id) as any;
  if (!row) return null;
  return { automationStatus: row.AutomationStatus, automationError: row.AutomationError };
}

export async function sqliteInsertReport(data: InsertReport): Promise<Report> {
  const db = getDb();
  const now = new Date().toISOString();
  const result = db.prepare(`
    INSERT INTO Reports (
      ReportNumber, ReportDate, ValuationDate, InspectionDate, CommissionDate,
      RequestNumber, Status, ValuerName, ValuerPercentage, LicenseNumber,
      LicenseDate, MembershipNumber, MembershipType, SecondValuerName,
      SecondValuerPercentage, SecondValuerLicenseNumber, SecondValuerMembershipNumber,
      TaqeemReportNumber, ClientName, ClientEmail, ClientPhone, IntendedUser,
      ReportType, ValuationPurpose, ValuationBasis, PropertyType, PropertySubType,
      Region, City, District, Street, BlockNumber, PlotNumber, PlanNumber,
      PropertyUse, DeedNumber, DeedDate, OwnerName, OwnershipType,
      BuildingPermitNumber, BuildingStatus, BuildingAge, LandArea, BuildingArea,
      BasementArea, AnnexArea, FloorsCount, PermittedFloorsCount,
      PermittedBuildingRatio, StreetWidth, StreetFacades, Utilities, Coordinates,
      ValuationMethod, MarketValue, IncomeValue, CostValue, FinalValue,
      PricePerMeter, CompanyName, CommercialRegNumber, PdfFileName, PdfFilePath,
      Notes, AutomationStatus, CreatedAt, UpdatedAt
    ) VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
    )
  `).run(
    data.reportNumber ?? null, data.reportDate ?? null, data.valuationDate ?? null,
    data.inspectionDate ?? null, data.commissionDate ?? null,
    data.requestNumber ?? null, data.status ?? "pending",
    data.valuerName ?? null, data.valuerPercentage ?? null, data.licenseNumber ?? null,
    data.licenseDate ?? null, data.membershipNumber ?? null, data.membershipType ?? null,
    data.secondValuerName ?? null, data.secondValuerPercentage ?? null,
    data.secondValuerLicenseNumber ?? null, data.secondValuerMembershipNumber ?? null,
    data.taqeemReportNumber ?? null,
    data.clientName ?? null, data.clientEmail ?? null, data.clientPhone ?? null,
    data.intendedUser ?? null, data.reportType ?? null, data.valuationPurpose ?? null,
    data.valuationBasis ?? null, data.propertyType ?? null, data.propertySubType ?? null,
    data.region ?? null, data.city ?? null, data.district ?? null, data.street ?? null,
    data.blockNumber ?? null, data.plotNumber ?? null, data.planNumber ?? null,
    data.propertyUse ?? null, data.deedNumber ?? null, data.deedDate ?? null,
    data.ownerName ?? null, data.ownershipType ?? null,
    data.buildingPermitNumber ?? null, data.buildingStatus ?? null, data.buildingAge ?? null,
    data.landArea ?? null, data.buildingArea ?? null,
    data.basementArea ?? null, data.annexArea ?? null,
    data.floorsCount ?? null, data.permittedFloorsCount ?? null,
    data.permittedBuildingRatio ?? null, data.streetWidth ?? null,
    data.streetFacades ?? null, data.utilities ?? null, data.coordinates ?? null,
    data.valuationMethod ?? null, data.marketValue ?? null, data.incomeValue ?? null,
    data.costValue ?? null, data.finalValue ?? null, data.pricePerMeter ?? null,
    data.companyName ?? null, data.commercialRegNumber ?? null,
    data.pdfFileName ?? null, data.pdfFilePath ?? null,
    data.notes ?? null, data.automationStatus ?? "pending",
    now, now
  );

  const id = Number(result.lastInsertRowid);
  const row = db.prepare("SELECT * FROM Reports WHERE Id = ?").get(id) as any;
  return rowToReport(row);
}

export async function sqliteUpdateReport(id: number, data: Partial<InsertReport>): Promise<Report | null> {
  const db = getDb();
  const now = new Date().toISOString();

  const fieldMap: Record<string, string> = {
    reportNumber: "ReportNumber", reportDate: "ReportDate", valuationDate: "ValuationDate",
    inspectionDate: "InspectionDate", commissionDate: "CommissionDate",
    requestNumber: "RequestNumber", status: "Status", valuerName: "ValuerName",
    valuerPercentage: "ValuerPercentage", licenseNumber: "LicenseNumber",
    licenseDate: "LicenseDate", membershipNumber: "MembershipNumber",
    membershipType: "MembershipType", secondValuerName: "SecondValuerName",
    secondValuerPercentage: "SecondValuerPercentage",
    secondValuerLicenseNumber: "SecondValuerLicenseNumber",
    secondValuerMembershipNumber: "SecondValuerMembershipNumber",
    taqeemReportNumber: "TaqeemReportNumber",
    clientName: "ClientName", clientEmail: "ClientEmail", clientPhone: "ClientPhone",
    intendedUser: "IntendedUser", reportType: "ReportType",
    valuationPurpose: "ValuationPurpose", valuationBasis: "ValuationBasis",
    propertyType: "PropertyType", propertySubType: "PropertySubType",
    region: "Region", city: "City", district: "District", street: "Street",
    blockNumber: "BlockNumber", plotNumber: "PlotNumber", planNumber: "PlanNumber",
    propertyUse: "PropertyUse", deedNumber: "DeedNumber", deedDate: "DeedDate",
    ownerName: "OwnerName", ownershipType: "OwnershipType",
    buildingPermitNumber: "BuildingPermitNumber", buildingStatus: "BuildingStatus",
    buildingAge: "BuildingAge", landArea: "LandArea", buildingArea: "BuildingArea",
    basementArea: "BasementArea", annexArea: "AnnexArea", floorsCount: "FloorsCount",
    permittedFloorsCount: "PermittedFloorsCount",
    permittedBuildingRatio: "PermittedBuildingRatio", streetWidth: "StreetWidth",
    streetFacades: "StreetFacades", utilities: "Utilities", coordinates: "Coordinates",
    valuationMethod: "ValuationMethod", marketValue: "MarketValue",
    incomeValue: "IncomeValue", costValue: "CostValue", finalValue: "FinalValue",
    pricePerMeter: "PricePerMeter", companyName: "CompanyName",
    commercialRegNumber: "CommercialRegNumber", pdfFileName: "PdfFileName",
    pdfFilePath: "PdfFilePath", notes: "Notes",
    automationStatus: "AutomationStatus", automationError: "AutomationError",
    automationSessionId: "AutomationSessionId", qrCodeBase64: "QrCodeBase64",
    certificatePath: "CertificatePath", taqeemSubmittedAt: "TaqeemSubmittedAt",
  };

  const sets: string[] = ["UpdatedAt = ?"];
  const values: any[] = [now];

  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in data) {
      sets.push(`${col} = ?`);
      values.push((data as any)[key] ?? null);
    }
  }

  values.push(id);
  db.prepare(`UPDATE Reports SET ${sets.join(", ")} WHERE Id = ?`).run(...values);

  const row = db.prepare("SELECT * FROM Reports WHERE Id = ?").get(id) as any;
  return row ? rowToReport(row) : null;
}

export async function sqliteDeleteReport(id: number): Promise<void> {
  const db = getDb();
  db.prepare("DELETE FROM Reports WHERE Id = ?").run(id);
}

export async function sqliteGetReportStats() {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM Reports").get() as any).c;
  const extracted = (db.prepare("SELECT COUNT(*) as c FROM Reports WHERE Status = 'extracted'").get() as any).c;
  const reviewed = (db.prepare("SELECT COUNT(*) as c FROM Reports WHERE Status = 'reviewed'").get() as any).c;
  const submitted = (db.prepare("SELECT COUNT(*) as c FROM Reports WHERE Status = 'submitted'").get() as any).c;
  const pending = (db.prepare("SELECT COUNT(*) as c FROM Reports WHERE Status = 'pending'").get() as any).c;
  return { total, extracted, reviewed, submitted, pending };
}

export async function sqliteHasPendingQueue(): Promise<number> {
  const db = getDb();
  const rows = db.prepare("SELECT Id FROM Reports WHERE AutomationStatus = 'queued'").all() as any[];
  return rows.length;
}
