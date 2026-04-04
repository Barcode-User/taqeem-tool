using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace TaqeemApi.Data.Migrations;

public partial class InitialCreate : Migration
{
    protected override void Up(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.CreateTable(
            name: "Reports",
            columns: table => new
            {
                Id = table.Column<int>(nullable: false)
                    .Annotation("SqlServer:Identity", "1, 1"),
                ReportNumber = table.Column<string>(nullable: true),
                ReportDate = table.Column<string>(nullable: true),
                ValuationDate = table.Column<string>(nullable: true),
                InspectionDate = table.Column<string>(nullable: true),
                CommissionDate = table.Column<string>(nullable: true),
                RequestNumber = table.Column<string>(nullable: true),
                ValuerName = table.Column<string>(nullable: true),
                LicenseNumber = table.Column<string>(nullable: true),
                ValuerMobile = table.Column<string>(nullable: true),
                ValuerEmail = table.Column<string>(nullable: true),
                CompanyName = table.Column<string>(nullable: true),
                ClientName = table.Column<string>(nullable: true),
                ClientId = table.Column<string>(nullable: true),
                ClientType = table.Column<string>(nullable: true),
                ClientEmail = table.Column<string>(nullable: true),
                ClientPhone = table.Column<string>(nullable: true),
                OwnerName = table.Column<string>(nullable: true),
                OwnerId = table.Column<string>(nullable: true),
                PropertyType = table.Column<string>(nullable: true),
                PropertyUse = table.Column<string>(nullable: true),
                PropertyDescription = table.Column<string>(nullable: true),
                Region = table.Column<string>(nullable: true),
                City = table.Column<string>(nullable: true),
                District = table.Column<string>(nullable: true),
                Street = table.Column<string>(nullable: true),
                DeedNumber = table.Column<string>(nullable: true),
                DeedDate = table.Column<string>(nullable: true),
                DeedIssuer = table.Column<string>(nullable: true),
                PlanNumber = table.Column<string>(nullable: true),
                PieceNumber = table.Column<string>(nullable: true),
                LandArea = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                BuildingArea = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                FloorsCount = table.Column<int>(nullable: true),
                Age = table.Column<int>(nullable: true),
                Coordinates = table.Column<string>(nullable: true),
                StreetFacades = table.Column<string>(nullable: true),
                StreetWidth = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                Utilities = table.Column<string>(nullable: true),
                PermittedFloorsCount = table.Column<int>(nullable: true),
                PermittedBuildingRatio = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                LandValue = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                BuildingValue = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                FinalValue = table.Column<decimal>(type: "decimal(18,2)", nullable: true),
                ValuationMethod = table.Column<string>(nullable: true),
                ValuationPurpose = table.Column<string>(nullable: true),
                Notes = table.Column<string>(nullable: true),
                TaqeemReportNumber = table.Column<string>(nullable: true),
                TaqeemSubmittedAt = table.Column<string>(nullable: true),
                AutomationStatus = table.Column<string>(nullable: false, defaultValue: "idle"),
                AutomationError = table.Column<string>(nullable: true),
                AutomationSessionId = table.Column<string>(nullable: true),
                QrCodeBase64 = table.Column<string>(nullable: true),
                CertificatePath = table.Column<string>(nullable: true),
                PdfFilePath = table.Column<string>(nullable: true),
                OriginalFileName = table.Column<string>(nullable: true),
                Status = table.Column<string>(nullable: false, defaultValue: "processing"),
                CreatedAt = table.Column<DateTime>(nullable: false, defaultValueSql: "GETUTCDATE()"),
                UpdatedAt = table.Column<DateTime>(nullable: false, defaultValueSql: "GETUTCDATE()")
            },
            constraints: table => table.PrimaryKey("PK_Reports", x => x.Id));
    }

    protected override void Down(MigrationBuilder migrationBuilder)
    {
        migrationBuilder.DropTable(name: "Reports");
    }
}
