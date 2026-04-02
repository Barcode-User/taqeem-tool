import { pgTable, text, serial, timestamp, real, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const reportsTable = pgTable("reports", {
  id: serial("id").primaryKey(),
  reportNumber: text("report_number"),
  reportDate: text("report_date"),
  valuationDate: text("valuation_date"),
  inspectionDate: text("inspection_date"),
  commissionDate: text("commission_date"),
  requestNumber: text("request_number"),
  status: text("status").notNull().default("pending"),

  valuerName: text("valuer_name"),
  valuerPercentage: real("valuer_percentage"),
  licenseNumber: text("license_number"),
  licenseDate: text("license_date"),
  membershipNumber: text("membership_number"),
  membershipType: text("membership_type"),

  secondValuerName: text("second_valuer_name"),
  secondValuerPercentage: real("second_valuer_percentage"),
  secondValuerLicenseNumber: text("second_valuer_license_number"),
  secondValuerMembershipNumber: text("second_valuer_membership_number"),

  taqeemReportNumber: text("taqeem_report_number"),

  clientName: text("client_name"),
  clientEmail: text("client_email"),
  clientPhone: text("client_phone"),
  intendedUser: text("intended_user"),
  reportType: text("report_type"),
  valuationPurpose: text("valuation_purpose"),
  valuationBasis: text("valuation_basis"),

  propertyType: text("property_type"),
  propertySubType: text("property_sub_type"),
  region: text("region"),
  city: text("city"),
  district: text("district"),
  street: text("street"),
  blockNumber: text("block_number"),
  plotNumber: text("plot_number"),
  planNumber: text("plan_number"),
  propertyUse: text("property_use"),
  deedNumber: text("deed_number"),
  deedDate: text("deed_date"),
  ownerName: text("owner_name"),
  ownershipType: text("ownership_type"),
  buildingPermitNumber: text("building_permit_number"),
  buildingStatus: text("building_status"),
  buildingAge: text("building_age"),

  landArea: real("land_area"),
  buildingArea: real("building_area"),
  basementArea: real("basement_area"),
  annexArea: real("annex_area"),
  floorsCount: integer("floors_count"),
  permittedFloorsCount: integer("permitted_floors_count"),
  permittedBuildingRatio: real("permitted_building_ratio"),
  streetWidth: real("street_width"),
  streetFacades: text("street_facades"),
  utilities: text("utilities"),
  coordinates: text("coordinates"),

  valuationMethod: text("valuation_method"),
  marketValue: real("market_value"),
  incomeValue: real("income_value"),
  costValue: real("cost_value"),
  finalValue: real("final_value"),
  pricePerMeter: real("price_per_meter"),

  companyName: text("company_name"),
  commercialRegNumber: text("commercial_reg_number"),
  pdfFileName: text("pdf_file_name"),
  pdfFilePath: text("pdf_file_path"),
  notes: text("notes"),

  automationStatus: text("automation_status").default("idle"),
  automationError: text("automation_error"),
  automationSessionId: text("automation_session_id"),
  qrCodeBase64: text("qr_code_base64"),
  certificatePath: text("certificate_path"),
  taqeemSubmittedAt: text("taqeem_submitted_at"),

  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertReportSchema = createInsertSchema(reportsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertReport = z.infer<typeof insertReportSchema>;
export type Report = typeof reportsTable.$inferSelect;
