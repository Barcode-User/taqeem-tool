/**
 * mssql.ts — طبقة الاتصال بـ SQL Server
 * تستخدم متغيرات البيئة: MSSQL_SERVER, MSSQL_DATABASE, MSSQL_USER, MSSQL_PASSWORD
 */
import sql from "mssql";

export interface Report {
  id: number;
  reportNumber: string | null;
  reportDate: string | null;
  valuationDate: string | null;
  inspectionDate: string | null;
  commissionDate: string | null;
  requestNumber: string | null;
  status: string;
  valuerName: string | null;
  valuerPercentage: number | null;
  licenseNumber: string | null;
  licenseDate: string | null;
  membershipNumber: string | null;
  membershipType: string | null;
  secondValuerName: string | null;
  secondValuerPercentage: number | null;
  secondValuerLicenseNumber: string | null;
  secondValuerMembershipNumber: string | null;
  taqeemReportNumber: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  intendedUser: string | null;
  reportType: string | null;
  valuationPurpose: string | null;
  valuationBasis: string | null;
  propertyType: string | null;
  propertySubType: string | null;
  region: string | null;
  city: string | null;
  district: string | null;
  street: string | null;
  blockNumber: string | null;
  plotNumber: string | null;
  planNumber: string | null;
  propertyUse: string | null;
  deedNumber: string | null;
  deedDate: string | null;
  ownerName: string | null;
  ownershipType: string | null;
  buildingPermitNumber: string | null;
  buildingStatus: string | null;
  buildingAge: string | null;
  landArea: number | null;
  buildingArea: number | null;
  basementArea: number | null;
  annexArea: number | null;
  floorsCount: number | null;
  permittedFloorsCount: number | null;
  permittedBuildingRatio: number | null;
  streetWidth: number | null;
  streetFacades: string | null;
  utilities: string | null;
  coordinates: string | null;
  valuationMethod: string | null;
  marketValue: number | null;
  incomeValue: number | null;
  costValue: number | null;
  finalValue: number | null;
  pricePerMeter: number | null;
  companyName: string | null;
  commercialRegNumber: string | null;
  pdfFileName: string | null;
  pdfFilePath: string | null;
  notes: string | null;
  automationStatus: string;
  automationError: string | null;
  automationSessionId: string | null;
  qrCodeBase64: string | null;
  certificatePath: string | null;
  taqeemSubmittedAt: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export type InsertReport = Omit<Partial<Report>, "id" | "createdAt" | "updatedAt">;

// ─── تكوين الاتصال ────────────────────────────────────────────────────────────
export function isConfigured(): boolean {
  // دائماً true — القيم الافتراضية مُضمَّنة في getConfig()
  return true;
}

function getConfig(): sql.config {
  if (process.env.MSSQL_CONNECTION_STRING) {
    return sql.ConnectionPool.parseConnectionString(process.env.MSSQL_CONNECTION_STRING) as sql.config;
  }
  if (process.env.DATABASE_URL?.startsWith("mssql://")) {
    const url = new URL(process.env.DATABASE_URL);
    return {
      server: url.hostname,
      database: url.pathname.slice(1),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      port: url.port ? parseInt(url.port) : 1433,
      options: { trustServerCertificate: true, encrypt: false },
    };
  }
  return {
    server: process.env.MSSQL_SERVER ?? "192.168.1.88",
    database: process.env.MSSQL_DATABASE ?? "TaqeemDb_Qeemah",
    user: process.env.MSSQL_USER ?? "test1",
    password: process.env.MSSQL_PASSWORD ?? "Aa123456",
    port: parseInt(process.env.MSSQL_PORT ?? "1433"),
    options: { trustServerCertificate: true, encrypt: false },
    pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
  };
}

let _pool: sql.ConnectionPool | null = null;

export async function getPool(): Promise<sql.ConnectionPool> {
  if (_pool && _pool.connected) return _pool;
  _pool = new sql.ConnectionPool(getConfig());
  await _pool.connect();
  return _pool;
}

// ─── تحويل صف SQL Server إلى كائن JavaScript ─────────────────────────────────
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
    plotNumber: str(row.PieceNumber),
    planNumber: str(row.PlanNumber),
    propertyUse: str(row.PropertyUse),
    deedNumber: str(row.DeedNumber),
    deedDate: str(row.DeedDate),
    ownerName: str(row.OwnerName),
    ownershipType: str(row.OwnershipType),
    buildingPermitNumber: str(row.BuildingPermitNumber),
    buildingStatus: str(row.BuildingStatus),
    buildingAge: str(row.BuildingAge) ?? (row.Age != null ? String(row.Age) : null),
    landArea: num(row.LandArea),
    buildingArea: num(row.BuildingArea),
    basementArea: num(row.BasementArea),
    annexArea: num(row.AnnexArea),
    floorsCount: row.FloorsCount != null ? Number(row.FloorsCount) : null,
    permittedFloorsCount: row.PermittedFloorsCount != null ? Number(row.PermittedFloorsCount) : null,
    permittedBuildingRatio: num(row.PermittedBuildingRatio),
    streetWidth: num(row.StreetWidth),
    streetFacades: str(row.StreetFacades),
    utilities: str(row.Utilities),
    coordinates: str(row.Coordinates),
    valuationMethod: str(row.ValuationMethod),
    marketValue: num(row.MarketValue) ?? num(row.LandValue),
    incomeValue: num(row.IncomeValue),
    costValue: num(row.CostValue) ?? num(row.BuildingValue),
    finalValue: num(row.FinalValue),
    pricePerMeter: num(row.PricePerMeter),
    companyName: str(row.CompanyName),
    commercialRegNumber: str(row.CommercialRegNumber),
    pdfFileName: str(row.OriginalFileName) ?? str(row.PdfFileName),
    pdfFilePath: str(row.PdfFilePath),
    notes: str(row.Notes),
    automationStatus: str(row.AutomationStatus) ?? "idle",
    automationError: str(row.AutomationError),
    automationSessionId: str(row.AutomationSessionId),
    qrCodeBase64: str(row.QrCodeBase64),
    certificatePath: str(row.CertificatePath),
    taqeemSubmittedAt: str(row.TaqeemSubmittedAt),
    createdAt: row.CreatedAt instanceof Date ? row.CreatedAt : new Date(row.CreatedAt),
    updatedAt: row.UpdatedAt instanceof Date ? row.UpdatedAt : new Date(row.UpdatedAt),
  };
}

// ─── خريطة الأعمدة: JS camelCase → SQL PascalCase ──────────────────────────
const FIELD_MAP: Record<string, string> = {
  reportNumber: "ReportNumber",
  reportDate: "ReportDate",
  valuationDate: "ValuationDate",
  inspectionDate: "InspectionDate",
  commissionDate: "CommissionDate",
  requestNumber: "RequestNumber",
  status: "Status",
  valuerName: "ValuerName",
  valuerPercentage: "ValuerPercentage",
  licenseNumber: "LicenseNumber",
  licenseDate: "LicenseDate",
  membershipNumber: "MembershipNumber",
  membershipType: "MembershipType",
  secondValuerName: "SecondValuerName",
  secondValuerPercentage: "SecondValuerPercentage",
  secondValuerLicenseNumber: "SecondValuerLicenseNumber",
  secondValuerMembershipNumber: "SecondValuerMembershipNumber",
  taqeemReportNumber: "TaqeemReportNumber",
  clientName: "ClientName",
  clientEmail: "ClientEmail",
  clientPhone: "ClientPhone",
  intendedUser: "IntendedUser",
  reportType: "ReportType",
  valuationPurpose: "ValuationPurpose",
  valuationBasis: "ValuationBasis",
  propertyType: "PropertyType",
  propertySubType: "PropertySubType",
  region: "Region",
  city: "City",
  district: "District",
  street: "Street",
  blockNumber: "BlockNumber",
  plotNumber: "PieceNumber",
  planNumber: "PlanNumber",
  propertyUse: "PropertyUse",
  deedNumber: "DeedNumber",
  deedDate: "DeedDate",
  ownerName: "OwnerName",
  ownershipType: "OwnershipType",
  buildingPermitNumber: "BuildingPermitNumber",
  buildingStatus: "BuildingStatus",
  buildingAge: "BuildingAge",
  landArea: "LandArea",
  buildingArea: "BuildingArea",
  basementArea: "BasementArea",
  annexArea: "AnnexArea",
  floorsCount: "FloorsCount",
  permittedFloorsCount: "PermittedFloorsCount",
  permittedBuildingRatio: "PermittedBuildingRatio",
  streetWidth: "StreetWidth",
  streetFacades: "StreetFacades",
  utilities: "Utilities",
  coordinates: "Coordinates",
  valuationMethod: "ValuationMethod",
  marketValue: "MarketValue",
  incomeValue: "IncomeValue",
  costValue: "CostValue",
  finalValue: "FinalValue",
  pricePerMeter: "PricePerMeter",
  companyName: "CompanyName",
  commercialRegNumber: "CommercialRegNumber",
  pdfFileName: "OriginalFileName",
  pdfFilePath: "PdfFilePath",
  notes: "Notes",
  automationStatus: "AutomationStatus",
  automationError: "AutomationError",
  automationSessionId: "AutomationSessionId",
  qrCodeBase64: "QrCodeBase64",
  certificatePath: "CertificatePath",
  taqeemSubmittedAt: "TaqeemSubmittedAt",
};

// ─── عمليات CRUD ──────────────────────────────────────────────────────────────

export async function listReports(): Promise<Report[]> {
  const pool = await getPool();
  const result = await pool.request().query("SELECT * FROM Reports ORDER BY CreatedAt DESC");
  return result.recordset.map(rowToReport);
}

export async function getReportById(id: number): Promise<Report | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input("id", sql.Int, id)
    .query("SELECT * FROM Reports WHERE Id = @id");
  return result.recordset[0] ? rowToReport(result.recordset[0]) : null;
}

export async function getReportsByAutomationStatus(automationStatus: string): Promise<Pick<Report, "id" | "reportNumber">[]> {
  const pool = await getPool();
  const result = await pool.request()
    .input("status", sql.NVarChar, automationStatus)
    .query("SELECT Id, ReportNumber FROM Reports WHERE AutomationStatus = @status ORDER BY CreatedAt ASC");
  return result.recordset.map(r => ({ id: r.Id, reportNumber: r.ReportNumber ?? null }));
}

export async function getReportAutomationStatus(id: number): Promise<{ automationStatus: string } | null> {
  const pool = await getPool();
  const result = await pool.request()
    .input("id", sql.Int, id)
    .query("SELECT AutomationStatus FROM Reports WHERE Id = @id");
  if (!result.recordset[0]) return null;
  return { automationStatus: result.recordset[0].AutomationStatus ?? "idle" };
}

export async function insertReport(data: InsertReport): Promise<Report> {
  const pool = await getPool();
  const req = pool.request();

  const cols: string[] = [];
  const vals: string[] = [];

  for (const [jsKey, sqlCol] of Object.entries(FIELD_MAP)) {
    const v = (data as any)[jsKey];
    if (v !== undefined && v !== null) {
      req.input(`p_${jsKey}`, v);
      cols.push(`[${sqlCol}]`);
      vals.push(`@p_${jsKey}`);
    }
  }

  const query = `
    INSERT INTO Reports (${cols.join(", ")})
    OUTPUT INSERTED.*
    VALUES (${vals.join(", ")})
  `;
  const result = await req.query(query);
  return rowToReport(result.recordset[0]);
}

export async function updateReport(id: number, data: Partial<InsertReport>): Promise<Report | null> {
  const pool = await getPool();
  const req = pool.request().input("id", sql.Int, id);

  const sets: string[] = ["[UpdatedAt] = GETUTCDATE()"];

  for (const [jsKey, sqlCol] of Object.entries(FIELD_MAP)) {
    if (jsKey === "status" && (data as any)[jsKey] === undefined) continue;
    const v = (data as any)[jsKey];
    if (v !== undefined) {
      req.input(`p_${jsKey}`, v);
      sets.push(`[${sqlCol}] = @p_${jsKey}`);
    }
  }

  const query = `
    UPDATE Reports
    SET ${sets.join(", ")}
    OUTPUT INSERTED.*
    WHERE Id = @id
  `;
  const result = await req.query(query);
  return result.recordset[0] ? rowToReport(result.recordset[0]) : null;
}

export async function deleteReport(id: number): Promise<void> {
  const pool = await getPool();
  await pool.request()
    .input("id", sql.Int, id)
    .query("DELETE FROM Reports WHERE Id = @id");
}

export async function getReportStats(): Promise<{
  total: number; pending: number; extracted: number; reviewed: number; submitted: number;
}> {
  const pool = await getPool();
  const result = await pool.request().query(`
    SELECT
      COUNT(*) AS Total,
      SUM(CASE WHEN Status = 'pending'   THEN 1 ELSE 0 END) AS Pending,
      SUM(CASE WHEN Status = 'extracted' THEN 1 ELSE 0 END) AS Extracted,
      SUM(CASE WHEN Status = 'reviewed'  THEN 1 ELSE 0 END) AS Reviewed,
      SUM(CASE WHEN Status = 'submitted' THEN 1 ELSE 0 END) AS Submitted
    FROM Reports
  `);
  const r = result.recordset[0];
  return {
    total: Number(r?.Total ?? 0),
    pending: Number(r?.Pending ?? 0),
    extracted: Number(r?.Extracted ?? 0),
    reviewed: Number(r?.Reviewed ?? 0),
    submitted: Number(r?.Submitted ?? 0),
  };
}
