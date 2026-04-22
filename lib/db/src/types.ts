/**
 * types.ts — أنواع قاعدة البيانات المشتركة
 * هذا الملف مستقل عن أي مكتبة قاعدة بيانات
 */

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
  valuersInput: string | null;
  taqeemReportNumber: string | null;
  clientName: string | null;
  clientEmail: string | null;
  clientPhone: string | null;
  intendedUser: string | null;
  reportType: string | null;
  valuationPurpose: string | null;
  valuationHypothesis: string | null;
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
  buildingCompletionPercentage: string | null;
  buildingType: string | null;
  finishingStatus: string | null;
  furnitureStatus: string | null;
  airConditioningType: string | null;
  isLandRented: string | null;
  additionalFeatures: string | null;
  isBestUse: string | null;
  landArea: number | null;
  buildingArea: number | null;
  basementArea: number | null;
  annexArea: number | null;
  floorsCount: number | null;
  permittedFloorsCount: number | null;
  permittedBuildingRatio: number | null;
  streetWidth: number | null;
  streetFacades: string | null;
  facadesCount: number | null;
  utilities: string | null;
  coordinates: string | null;
  latitude: number | null;
  longitude: number | null;
  valuationMethod: string | null;
  marketWay: string | null;
  incomeWay: string | null;
  costWay: string | null;
  marketValue: number | null;
  incomeValue: number | null;
  costValue: number | null;
  marketApproachPercentage: number | null;
  incomeApproachPercentage: number | null;
  costApproachPercentage: number | null;
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

export function isConfigured(): boolean {
  return true;
}
