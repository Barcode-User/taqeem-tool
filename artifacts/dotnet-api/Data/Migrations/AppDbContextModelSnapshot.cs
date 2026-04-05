using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using TaqeemApi.Data;

#nullable disable

namespace TaqeemApi.Data.Migrations;

[DbContext(typeof(AppDbContext))]
partial class AppDbContextModelSnapshot : ModelSnapshot
{
    protected override void BuildModel(ModelBuilder modelBuilder)
    {
#pragma warning disable 612, 618
        modelBuilder
            .HasAnnotation("ProductVersion", "9.0.4")
            .HasAnnotation("Relational:MaxIdentifierLength", 128);

        SqlServerModelBuilderExtensions.UseIdentityColumns(modelBuilder);

        modelBuilder.Entity("TaqeemApi.Models.Report", b =>
        {
            b.Property<int>("Id").ValueGeneratedOnAdd()
                .HasColumnType("int");
            SqlServerPropertyBuilderExtensions.UseIdentityColumn(b.Property<int>("Id"));

            b.Property<int?>("Age").HasColumnType("int");
            b.Property<decimal?>("BuildingArea").HasColumnType("decimal(18,2)");
            b.Property<decimal?>("BuildingValue").HasColumnType("decimal(18,2)");
            b.Property<string>("CertificatePath").HasColumnType("nvarchar(max)");
            b.Property<string>("City").HasColumnType("nvarchar(max)");
            b.Property<string>("ClientEmail").HasColumnType("nvarchar(max)");
            b.Property<string>("ClientId").HasColumnType("nvarchar(max)");
            b.Property<string>("ClientName").HasColumnType("nvarchar(max)");
            b.Property<string>("ClientPhone").HasColumnType("nvarchar(max)");
            b.Property<string>("ClientType").HasColumnType("nvarchar(max)");
            b.Property<string>("CommissionDate").HasColumnType("nvarchar(max)");
            b.Property<string>("CompanyName").HasColumnType("nvarchar(max)");
            b.Property<string>("Coordinates").HasColumnType("nvarchar(max)");
            b.Property<DateTime>("CreatedAt").HasColumnType("datetime2").HasDefaultValueSql("GETUTCDATE()");
            b.Property<string>("DeedDate").HasColumnType("nvarchar(max)");
            b.Property<string>("DeedIssuer").HasColumnType("nvarchar(max)");
            b.Property<string>("DeedNumber").HasColumnType("nvarchar(max)");
            b.Property<string>("District").HasColumnType("nvarchar(max)");
            b.Property<decimal?>("FinalValue").HasColumnType("decimal(18,2)");
            b.Property<int?>("FloorsCount").HasColumnType("int");
            b.Property<string>("AutomationError").HasColumnType("nvarchar(max)");
            b.Property<string>("AutomationSessionId").HasColumnType("nvarchar(max)");
            b.Property<string>("AutomationStatus").IsRequired().HasColumnType("nvarchar(max)").HasDefaultValue("idle");
            b.Property<string>("InspectionDate").HasColumnType("nvarchar(max)");
            b.Property<decimal?>("LandArea").HasColumnType("decimal(18,2)");
            b.Property<decimal?>("LandValue").HasColumnType("decimal(18,2)");
            b.Property<string>("LicenseNumber").HasColumnType("nvarchar(max)");
            b.Property<string>("Notes").HasColumnType("nvarchar(max)");
            b.Property<string>("OriginalFileName").HasColumnType("nvarchar(max)");
            b.Property<string>("OwnerId").HasColumnType("nvarchar(max)");
            b.Property<string>("OwnerName").HasColumnType("nvarchar(max)");
            b.Property<string>("PdfFilePath").HasColumnType("nvarchar(max)");
            b.Property<decimal?>("PermittedBuildingRatio").HasColumnType("decimal(18,2)");
            b.Property<int?>("PermittedFloorsCount").HasColumnType("int");
            b.Property<string>("PieceNumber").HasColumnType("nvarchar(max)");
            b.Property<string>("PlanNumber").HasColumnType("nvarchar(max)");
            b.Property<string>("PropertyDescription").HasColumnType("nvarchar(max)");
            b.Property<string>("PropertyType").HasColumnType("nvarchar(max)");
            b.Property<string>("PropertyUse").HasColumnType("nvarchar(max)");
            b.Property<string>("QrCodeBase64").HasColumnType("nvarchar(max)");
            b.Property<string>("Region").HasColumnType("nvarchar(max)");
            b.Property<string>("ReportDate").HasColumnType("nvarchar(max)");
            b.Property<string>("ReportNumber").HasColumnType("nvarchar(max)");
            b.Property<string>("RequestNumber").HasColumnType("nvarchar(max)");
            b.Property<string>("Status").IsRequired().HasColumnType("nvarchar(max)").HasDefaultValue("processing");
            b.Property<string>("Street").HasColumnType("nvarchar(max)");
            b.Property<string>("StreetFacades").HasColumnType("nvarchar(max)");
            b.Property<decimal?>("StreetWidth").HasColumnType("decimal(18,2)");
            b.Property<string>("TaqeemReportNumber").HasColumnType("nvarchar(max)");
            b.Property<string>("TaqeemSubmittedAt").HasColumnType("nvarchar(max)");
            b.Property<string>("Utilities").HasColumnType("nvarchar(max)");
            b.Property<DateTime>("UpdatedAt").HasColumnType("datetime2").HasDefaultValueSql("GETUTCDATE()");
            b.Property<string>("ValuationDate").HasColumnType("nvarchar(max)");
            b.Property<string>("ValuationMethod").HasColumnType("nvarchar(max)");
            b.Property<string>("ValuationPurpose").HasColumnType("nvarchar(max)");
            b.Property<string>("ValuerEmail").HasColumnType("nvarchar(max)");
            b.Property<string>("ValuerMobile").HasColumnType("nvarchar(max)");
            b.Property<string>("ValuerName").HasColumnType("nvarchar(max)");
            b.Property<string>("ClientId").HasColumnType("nvarchar(max)");

            b.HasKey("Id");
            b.ToTable("Reports");
        });
#pragma warning restore 612, 618
    }
}
