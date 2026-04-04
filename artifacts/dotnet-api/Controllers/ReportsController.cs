using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaqeemApi.Data;
using TaqeemApi.Models;
using TaqeemApi.Services;

namespace TaqeemApi.Controllers;

[ApiController]
[Route("api/reports")]
public class ReportsController(AppDbContext db, OpenAiService ai, PdfService pdf, ILogger<ReportsController> logger) : ControllerBase
{
    private static readonly string UploadsDir =
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Uploads");

    // GET /api/reports
    [HttpGet]
    public async Task<IActionResult> List([FromQuery] int page = 1, [FromQuery] int limit = 20)
    {
        var total = await db.Reports.CountAsync();
        var reports = await db.Reports
            .OrderByDescending(r => r.CreatedAt)
            .Skip((page - 1) * limit)
            .Take(limit)
            .ToListAsync();
        return Ok(new { total, page, limit, data = reports });
    }

    // GET /api/reports/:id
    [HttpGet("{id:int}")]
    public async Task<IActionResult> Get(int id)
    {
        var report = await db.Reports.FindAsync(id);
        if (report == null) return NotFound(new { error = "Report not found" });
        return Ok(report);
    }

    // POST /api/reports/upload
    [HttpPost("upload")]
    [RequestSizeLimit(50 * 1024 * 1024)]
    public async Task<IActionResult> Upload(IFormFile file)
    {
        if (file == null || file.Length == 0)
            return BadRequest(new { error = "No file uploaded" });

        if (!file.FileName.EndsWith(".pdf", StringComparison.OrdinalIgnoreCase))
            return BadRequest(new { error = "Only PDF files are allowed" });

        Directory.CreateDirectory(UploadsDir);
        var filename = $"{Guid.NewGuid()}_{Path.GetFileName(file.FileName)}";
        var filepath = Path.Combine(UploadsDir, filename);

        await using (var stream = System.IO.File.Create(filepath))
            await file.CopyToAsync(stream);

        // Create pending report
        var report = new Report
        {
            OriginalFileName = file.FileName,
            PdfFilePath = filepath,
            Status = "processing"
        };
        db.Reports.Add(report);
        await db.SaveChangesAsync();

        // Extract text and call AI in background
        _ = Task.Run(async () =>
        {
            try
            {
                var pdfText = pdf.ExtractText(filepath);
                var extracted = await ai.ExtractReportDataAsync(pdfText, file.FileName);

                // Copy extracted fields to report
                db.Entry(report).CurrentValues.SetValues(extracted);
                report.Id = report.Id; // keep original id
                report.Status = "completed";
                report.UpdatedAt = DateTime.UtcNow;
                report.PdfFilePath = filepath;
                report.OriginalFileName = file.FileName;
                await db.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                logger.LogError(ex, "Failed to extract report data");
                report.Status = "failed";
                await db.SaveChangesAsync();
            }
        });

        return Ok(new { id = report.Id, status = "processing", message = "جارٍ معالجة التقرير..." });
    }

    // PATCH /api/reports/:id
    [HttpPatch("{id:int}")]
    public async Task<IActionResult> Update(int id, [FromBody] Report updates)
    {
        var report = await db.Reports.FindAsync(id);
        if (report == null) return NotFound(new { error = "Report not found" });

        // Map only non-null fields
        if (updates.ReportNumber != null) report.ReportNumber = updates.ReportNumber;
        if (updates.ReportDate != null) report.ReportDate = updates.ReportDate;
        if (updates.ValuationDate != null) report.ValuationDate = updates.ValuationDate;
        if (updates.InspectionDate != null) report.InspectionDate = updates.InspectionDate;
        if (updates.CommissionDate != null) report.CommissionDate = updates.CommissionDate;
        if (updates.RequestNumber != null) report.RequestNumber = updates.RequestNumber;
        if (updates.ValuerName != null) report.ValuerName = updates.ValuerName;
        if (updates.LicenseNumber != null) report.LicenseNumber = updates.LicenseNumber;
        if (updates.ValuerMobile != null) report.ValuerMobile = updates.ValuerMobile;
        if (updates.ValuerEmail != null) report.ValuerEmail = updates.ValuerEmail;
        if (updates.CompanyName != null) report.CompanyName = updates.CompanyName;
        if (updates.ClientName != null) report.ClientName = updates.ClientName;
        if (updates.ClientId != null) report.ClientId = updates.ClientId;
        if (updates.ClientType != null) report.ClientType = updates.ClientType;
        if (updates.ClientEmail != null) report.ClientEmail = updates.ClientEmail;
        if (updates.ClientPhone != null) report.ClientPhone = updates.ClientPhone;
        if (updates.OwnerName != null) report.OwnerName = updates.OwnerName;
        if (updates.OwnerId != null) report.OwnerId = updates.OwnerId;
        if (updates.PropertyType != null) report.PropertyType = updates.PropertyType;
        if (updates.PropertyUse != null) report.PropertyUse = updates.PropertyUse;
        if (updates.PropertyDescription != null) report.PropertyDescription = updates.PropertyDescription;
        if (updates.Region != null) report.Region = updates.Region;
        if (updates.City != null) report.City = updates.City;
        if (updates.District != null) report.District = updates.District;
        if (updates.Street != null) report.Street = updates.Street;
        if (updates.DeedNumber != null) report.DeedNumber = updates.DeedNumber;
        if (updates.DeedDate != null) report.DeedDate = updates.DeedDate;
        if (updates.DeedIssuer != null) report.DeedIssuer = updates.DeedIssuer;
        if (updates.PlanNumber != null) report.PlanNumber = updates.PlanNumber;
        if (updates.PieceNumber != null) report.PieceNumber = updates.PieceNumber;
        if (updates.LandArea.HasValue) report.LandArea = updates.LandArea;
        if (updates.BuildingArea.HasValue) report.BuildingArea = updates.BuildingArea;
        if (updates.FloorsCount.HasValue) report.FloorsCount = updates.FloorsCount;
        if (updates.Age.HasValue) report.Age = updates.Age;
        if (updates.Coordinates != null) report.Coordinates = updates.Coordinates;
        if (updates.StreetFacades != null) report.StreetFacades = updates.StreetFacades;
        if (updates.StreetWidth.HasValue) report.StreetWidth = updates.StreetWidth;
        if (updates.Utilities != null) report.Utilities = updates.Utilities;
        if (updates.PermittedFloorsCount.HasValue) report.PermittedFloorsCount = updates.PermittedFloorsCount;
        if (updates.PermittedBuildingRatio.HasValue) report.PermittedBuildingRatio = updates.PermittedBuildingRatio;
        if (updates.LandValue.HasValue) report.LandValue = updates.LandValue;
        if (updates.BuildingValue.HasValue) report.BuildingValue = updates.BuildingValue;
        if (updates.FinalValue.HasValue) report.FinalValue = updates.FinalValue;
        if (updates.ValuationMethod != null) report.ValuationMethod = updates.ValuationMethod;
        if (updates.ValuationPurpose != null) report.ValuationPurpose = updates.ValuationPurpose;
        if (updates.Notes != null) report.Notes = updates.Notes;
        if (updates.Status != null) report.Status = updates.Status;

        report.UpdatedAt = DateTime.UtcNow;
        await db.SaveChangesAsync();
        return Ok(report);
    }

    // DELETE /api/reports/:id
    [HttpDelete("{id:int}")]
    public async Task<IActionResult> Delete(int id)
    {
        var report = await db.Reports.FindAsync(id);
        if (report == null) return NotFound(new { error = "Report not found" });
        db.Reports.Remove(report);
        await db.SaveChangesAsync();
        return Ok(new { message = "Deleted" });
    }
}
