namespace TaqeemApi.Models;

public class Report
{
    public int Id { get; set; }

    // Report Info
    public string? ReportNumber { get; set; }
    public string? ReportDate { get; set; }
    public string? ValuationDate { get; set; }
    public string? InspectionDate { get; set; }
    public string? CommissionDate { get; set; }
    public string? RequestNumber { get; set; }

    // Valuer Info
    public string? ValuerName { get; set; }
    public string? LicenseNumber { get; set; }
    public string? ValuerMobile { get; set; }
    public string? ValuerEmail { get; set; }
    public string? CompanyName { get; set; }

    // Client Info
    public string? ClientName { get; set; }
    public string? ClientId { get; set; }
    public string? ClientType { get; set; }
    public string? ClientEmail { get; set; }
    public string? ClientPhone { get; set; }

    // Owner Info
    public string? OwnerName { get; set; }
    public string? OwnerId { get; set; }

    // Property Info
    public string? PropertyType { get; set; }
    public string? PropertyUse { get; set; }
    public string? PropertyDescription { get; set; }
    public string? Region { get; set; }
    public string? City { get; set; }
    public string? District { get; set; }
    public string? Street { get; set; }
    public string? DeedNumber { get; set; }
    public string? DeedDate { get; set; }
    public string? DeedIssuer { get; set; }
    public string? PlanNumber { get; set; }
    public string? PieceNumber { get; set; }
    public decimal? LandArea { get; set; }
    public decimal? BuildingArea { get; set; }
    public int? FloorsCount { get; set; }
    public int? Age { get; set; }
    public string? Coordinates { get; set; }

    // Street Info
    public string? StreetFacades { get; set; }
    public decimal? StreetWidth { get; set; }
    public string? Utilities { get; set; }
    public int? PermittedFloorsCount { get; set; }
    public decimal? PermittedBuildingRatio { get; set; }

    // Valuation
    public decimal? LandValue { get; set; }
    public decimal? BuildingValue { get; set; }
    public decimal? FinalValue { get; set; }
    public string? ValuationMethod { get; set; }
    public string? ValuationPurpose { get; set; }
    public string? Notes { get; set; }

    // TAQEEM Platform
    public string? TaqeemReportNumber { get; set; }
    public string? TaqeemSubmittedAt { get; set; }

    // Automation
    public string AutomationStatus { get; set; } = "idle";
    public string? AutomationError { get; set; }
    public string? AutomationSessionId { get; set; }
    public string? QrCodeBase64 { get; set; }
    public string? CertificatePath { get; set; }

    // File
    public string? PdfFilePath { get; set; }
    public string? OriginalFileName { get; set; }

    // Status & Timestamps
    public string Status { get; set; } = "processing";
    public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    public DateTime UpdatedAt { get; set; } = DateTime.UtcNow;
}
