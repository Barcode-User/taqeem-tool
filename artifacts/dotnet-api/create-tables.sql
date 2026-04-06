-- =============================================
-- TaqeemDb — إنشاء / تحديث جدول Reports
-- شغّل هذا السكريبت في SQL Server Management Studio
-- بعد اختيار قاعدة بيانات TaqeemDb
-- =============================================

USE TaqeemDb;
GO

-- ─── إنشاء جدول __EFMigrationsHistory إذا لم يكن موجوداً ─────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='__EFMigrationsHistory' AND xtype='U')
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId]    NVARCHAR(150) NOT NULL,
        [ProductVersion] NVARCHAR(32)  NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END
GO

IF NOT EXISTS (SELECT * FROM [__EFMigrationsHistory] WHERE [MigrationId] = '20260101000000_InitialCreate')
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES ('20260101000000_InitialCreate', '9.0.4');
END
GO

-- ─── إنشاء جدول Reports إذا لم يكن موجوداً ──────────────────────────────
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Reports' AND xtype='U')
BEGIN
    CREATE TABLE [Reports] (
        [Id]                       INT             IDENTITY(1,1) NOT NULL,
        -- معلومات التقرير
        [ReportNumber]             NVARCHAR(MAX)   NULL,
        [ReportDate]               NVARCHAR(MAX)   NULL,
        [ValuationDate]            NVARCHAR(MAX)   NULL,
        [InspectionDate]           NVARCHAR(MAX)   NULL,
        [CommissionDate]           NVARCHAR(MAX)   NULL,
        [RequestNumber]            NVARCHAR(MAX)   NULL,
        -- معلومات المقيّم
        [ValuerName]               NVARCHAR(MAX)   NULL,
        [LicenseNumber]            NVARCHAR(MAX)   NULL,
        [LicenseDate]              NVARCHAR(MAX)   NULL,
        [MembershipNumber]         NVARCHAR(MAX)   NULL,
        [MembershipType]           NVARCHAR(MAX)   NULL,
        [ValuerPercentage]         DECIMAL(18,2)   NULL,
        [ValuerMobile]             NVARCHAR(MAX)   NULL,
        [ValuerEmail]              NVARCHAR(MAX)   NULL,
        -- المقيم الثاني
        [SecondValuerName]         NVARCHAR(MAX)   NULL,
        [SecondValuerLicenseNumber] NVARCHAR(MAX)  NULL,
        [SecondValuerMembershipNumber] NVARCHAR(MAX) NULL,
        [SecondValuerPercentage]   DECIMAL(18,2)   NULL,
        -- معلومات الشركة
        [CompanyName]              NVARCHAR(MAX)   NULL,
        [CommercialRegNumber]      NVARCHAR(MAX)   NULL,
        -- معلومات العميل
        [ClientName]               NVARCHAR(MAX)   NULL,
        [ClientId]                 NVARCHAR(MAX)   NULL,
        [ClientType]               NVARCHAR(MAX)   NULL,
        [ClientEmail]              NVARCHAR(MAX)   NULL,
        [ClientPhone]              NVARCHAR(MAX)   NULL,
        [IntendedUser]             NVARCHAR(MAX)   NULL,
        -- معلومات المالك
        [OwnerName]                NVARCHAR(MAX)   NULL,
        [OwnerId]                  NVARCHAR(MAX)   NULL,
        [OwnershipType]            NVARCHAR(MAX)   NULL,
        -- معلومات العقار
        [PropertyType]             NVARCHAR(MAX)   NULL,
        [PropertySubType]          NVARCHAR(MAX)   NULL,
        [PropertyUse]              NVARCHAR(MAX)   NULL,
        [PropertyDescription]      NVARCHAR(MAX)   NULL,
        [Region]                   NVARCHAR(MAX)   NULL,
        [City]                     NVARCHAR(MAX)   NULL,
        [District]                 NVARCHAR(MAX)   NULL,
        [Street]                   NVARCHAR(MAX)   NULL,
        [BlockNumber]              NVARCHAR(MAX)   NULL,
        [PieceNumber]              NVARCHAR(MAX)   NULL,
        [PlanNumber]               NVARCHAR(MAX)   NULL,
        [DeedNumber]               NVARCHAR(MAX)   NULL,
        [DeedDate]                 NVARCHAR(MAX)   NULL,
        [DeedIssuer]               NVARCHAR(MAX)   NULL,
        [BuildingPermitNumber]     NVARCHAR(MAX)   NULL,
        [BuildingStatus]           NVARCHAR(MAX)   NULL,
        [BuildingAge]              NVARCHAR(MAX)   NULL,
        [Age]                      INT             NULL,
        -- المساحات والأبعاد
        [LandArea]                 DECIMAL(18,2)   NULL,
        [BuildingArea]             DECIMAL(18,2)   NULL,
        [BasementArea]             DECIMAL(18,2)   NULL,
        [AnnexArea]                DECIMAL(18,2)   NULL,
        [FloorsCount]              INT             NULL,
        [PermittedFloorsCount]     INT             NULL,
        [PermittedBuildingRatio]   DECIMAL(18,2)   NULL,
        [StreetWidth]              DECIMAL(18,2)   NULL,
        [StreetFacades]            NVARCHAR(MAX)   NULL,
        [Utilities]                NVARCHAR(MAX)   NULL,
        [Coordinates]              NVARCHAR(MAX)   NULL,
        -- التقييم
        [ReportType]               NVARCHAR(MAX)   NULL,
        [ValuationMethod]          NVARCHAR(MAX)   NULL,
        [ValuationPurpose]         NVARCHAR(MAX)   NULL,
        [ValuationBasis]           NVARCHAR(MAX)   NULL,
        [MarketValue]              DECIMAL(18,2)   NULL,
        [IncomeValue]              DECIMAL(18,2)   NULL,
        [CostValue]                DECIMAL(18,2)   NULL,
        [LandValue]                DECIMAL(18,2)   NULL,
        [BuildingValue]            DECIMAL(18,2)   NULL,
        [FinalValue]               DECIMAL(18,2)   NULL,
        [PricePerMeter]            DECIMAL(18,2)   NULL,
        [Notes]                    NVARCHAR(MAX)   NULL,
        -- منصة تقييم
        [TaqeemReportNumber]       NVARCHAR(MAX)   NULL,
        [TaqeemSubmittedAt]        NVARCHAR(MAX)   NULL,
        -- الأتمتة
        [AutomationStatus]         NVARCHAR(MAX)   NOT NULL DEFAULT 'idle',
        [AutomationError]          NVARCHAR(MAX)   NULL,
        [AutomationSessionId]      NVARCHAR(MAX)   NULL,
        [QrCodeBase64]             NVARCHAR(MAX)   NULL,
        [CertificatePath]          NVARCHAR(MAX)   NULL,
        -- الملف
        [PdfFilePath]              NVARCHAR(MAX)   NULL,
        [OriginalFileName]         NVARCHAR(MAX)   NULL,
        -- الحالة والتواريخ
        [Status]                   NVARCHAR(MAX)   NOT NULL DEFAULT 'pending',
        [CreatedAt]                DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        [UpdatedAt]                DATETIME2       NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT [PK_Reports] PRIMARY KEY ([Id])
    );
    PRINT 'تم إنشاء جدول Reports بنجاح ✅';
END
ELSE
BEGIN
    PRINT 'جدول Reports موجود — سيتم إضافة الأعمدة الجديدة إن وجدت...';
END
GO

-- ─── إضافة الأعمدة الجديدة إلى الجدول الموجود (إذا لم تكن موجودة) ─────────
IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='LicenseDate')
    ALTER TABLE [Reports] ADD [LicenseDate] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='MembershipNumber')
    ALTER TABLE [Reports] ADD [MembershipNumber] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='MembershipType')
    ALTER TABLE [Reports] ADD [MembershipType] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='ValuerPercentage')
    ALTER TABLE [Reports] ADD [ValuerPercentage] DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='SecondValuerName')
    ALTER TABLE [Reports] ADD [SecondValuerName] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='SecondValuerLicenseNumber')
    ALTER TABLE [Reports] ADD [SecondValuerLicenseNumber] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='SecondValuerMembershipNumber')
    ALTER TABLE [Reports] ADD [SecondValuerMembershipNumber] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='SecondValuerPercentage')
    ALTER TABLE [Reports] ADD [SecondValuerPercentage] DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='CommercialRegNumber')
    ALTER TABLE [Reports] ADD [CommercialRegNumber] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='IntendedUser')
    ALTER TABLE [Reports] ADD [IntendedUser] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='OwnershipType')
    ALTER TABLE [Reports] ADD [OwnershipType] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='PropertySubType')
    ALTER TABLE [Reports] ADD [PropertySubType] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='BlockNumber')
    ALTER TABLE [Reports] ADD [BlockNumber] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='BuildingPermitNumber')
    ALTER TABLE [Reports] ADD [BuildingPermitNumber] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='BuildingStatus')
    ALTER TABLE [Reports] ADD [BuildingStatus] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='BuildingAge')
    ALTER TABLE [Reports] ADD [BuildingAge] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='BasementArea')
    ALTER TABLE [Reports] ADD [BasementArea] DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='AnnexArea')
    ALTER TABLE [Reports] ADD [AnnexArea] DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='ReportType')
    ALTER TABLE [Reports] ADD [ReportType] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='ValuationBasis')
    ALTER TABLE [Reports] ADD [ValuationBasis] NVARCHAR(MAX) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='MarketValue')
    ALTER TABLE [Reports] ADD [MarketValue] DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='IncomeValue')
    ALTER TABLE [Reports] ADD [IncomeValue] DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='CostValue')
    ALTER TABLE [Reports] ADD [CostValue] DECIMAL(18,2) NULL;

IF NOT EXISTS (SELECT * FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME='Reports' AND COLUMN_NAME='PricePerMeter')
    ALTER TABLE [Reports] ADD [PricePerMeter] DECIMAL(18,2) NULL;

PRINT 'تم التحقق من الأعمدة وإضافة الجديدة بنجاح ✅';
GO

-- ─── للتحقق ─────────────────────────────────────────────────────────────────
SELECT COLUMN_NAME, DATA_TYPE
FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'Reports'
ORDER BY ORDINAL_POSITION;
GO
