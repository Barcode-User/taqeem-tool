using Microsoft.EntityFrameworkCore;
using TaqeemApi.Models;

namespace TaqeemApi.Data;

public class AppDbContext(DbContextOptions<AppDbContext> options) : DbContext(options)
{
    public DbSet<Report> Reports => Set<Report>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<Report>(entity =>
        {
            entity.HasKey(e => e.Id);
            entity.Property(e => e.AutomationStatus).HasDefaultValue("idle");
            entity.Property(e => e.Status).HasDefaultValue("processing");
            entity.Property(e => e.CreatedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.Property(e => e.UpdatedAt).HasDefaultValueSql("GETUTCDATE()");
            entity.Property(e => e.FinalValue).HasColumnType("decimal(18,2)");
            entity.Property(e => e.LandValue).HasColumnType("decimal(18,2)");
            entity.Property(e => e.BuildingValue).HasColumnType("decimal(18,2)");
            entity.Property(e => e.LandArea).HasColumnType("decimal(18,2)");
            entity.Property(e => e.BuildingArea).HasColumnType("decimal(18,2)");
            entity.Property(e => e.StreetWidth).HasColumnType("decimal(18,2)");
            entity.Property(e => e.PermittedBuildingRatio).HasColumnType("decimal(18,2)");
        });
    }
}
