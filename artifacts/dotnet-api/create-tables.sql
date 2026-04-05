-- =============================================
-- TaqeemDb - إنشاء جدول Reports يدوياً
-- شغّل هذا السكريبت في SQL Server Management Studio
-- بعد اختيار قاعدة بيانات TaqeemDb
-- =============================================

USE TaqeemDb;
GO

-- إنشاء جدول __EFMigrationsHistory (مطلوب لـ EF Core)
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='__EFMigrationsHistory' AND xtype='U')
BEGIN
    CREATE TABLE [__EFMigrationsHistory] (
        [MigrationId]    NVARCHAR(150) NOT NULL,
        [ProductVersion] NVARCHAR(32)  NOT NULL,
        CONSTRAINT [PK___EFMigrationsHistory] PRIMARY KEY ([MigrationId])
    );
END
GO

-- إدخال سجل Migration حتى لا يُعيد EF Core إنشاء الجداول
IF NOT EXISTS (SELECT * FROM [__EFMigrationsHistory] WHERE [MigrationId] = '20260101000000_InitialCreate')
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES ('20260101000000_InitialCreate', '9.0.4');
END
GO

-- إنشاء جدول Reports
IF NOT EXISTS (SELECT * FROM sysobjects WHERE name='Reports' AND xtype='U')
BEGIN
    CREATE TABLE [Reports] (
        [Id]                     INT             IDENTITY(1,1) NOT NULL,
        -- معلومات التقرير
        [ReportNumber]           NVARCHAR(MAX)   NULL,
        [ReportDate]             NVARCHAR(MAX)   NULL,
        [ValuationDate]          NVARCHAR(MAX)   NULL,
        [InspectionDate]         NVARCHAR(MAX)   NULL,
        [CommissionDate]         NVARCHAR(MAX)   NULL,
        [RequestNumber]          NVARCHAR(MAX)   NULL,
        -- معلومات المقيّم
        [ValuerName]             NVARCHAR(MAX)   NULL,
        [LicenseNumber]          NVARCHAR(MAX)   NULL,
        [ValuerMobile]           NVARCHAR(MAX)   NULL,
        [ValuerEmail]            NVARCHAR(MAX)   NULL,
        [CompanyName]            NVARCHAR(MAX)   NULL,
        -- معلومات العميل
        [ClientName]             NVARCHAR(MAX)   NULL,
        [ClientId]               NVARCHAR(MAX)   NULL,
        [ClientType]             NVARCHAR(MAX)   NULL,
        [ClientEmail]            NVARCHAR(MAX)   NULL,
        [ClientPhone]            NVARCHAR(MAX)   NULL,
        -- معلومات المالك
        [OwnerName]              NVARCHAR(MAX)   NULL,
        [OwnerId]                NVARCHAR(MAX)   NULL,
        -- معلومات العقار
        [PropertyType]           NVARCHAR(MAX)   NULL,
        [PropertyUse]            NVARCHAR(MAX)   NULL,
        [PropertyDescription]    NVARCHAR(MAX)   NULL,
        [Region]                 NVARCHAR(MAX)   NULL,
        [City]                   NVARCHAR(MAX)   NULL,
        [District]               NVARCHAR(MAX)   NULL,
        [Street]                 NVARCHAR(MAX)   NULL,
        [DeedNumber]             NVARCHAR(MAX)   NULL,
        [DeedDate]               NVARCHAR(MAX)   NULL,
        [DeedIssuer]             NVARCHAR(MAX)   NULL,
        [PlanNumber]             NVARCHAR(MAX)   NULL,
        [PieceNumber]            NVARCHAR(MAX)   NULL,
        [LandArea]               DECIMAL(18,2)   NULL,
        [BuildingArea]           DECIMAL(18,2)   NULL,
        [FloorsCount]            INT             NULL,
        [Age]                    INT             NULL,
        [Coordinates]            NVARCHAR(MAX)   NULL,
        -- معلومات الشارع
        [StreetFacades]          NVARCHAR(MAX)   NULL,
        [StreetWidth]            DECIMAL(18,2)   NULL,
        [Utilities]              NVARCHAR(MAX)   NULL,
        [PermittedFloorsCount]   INT             NULL,
        [PermittedBuildingRatio] DECIMAL(18,2)   NULL,
        -- التقييم
        [LandValue]              DECIMAL(18,2)   NULL,
        [BuildingValue]          DECIMAL(18,2)   NULL,
        [FinalValue]             DECIMAL(18,2)   NULL,
        [ValuationMethod]        NVARCHAR(MAX)   NULL,
        [ValuationPurpose]       NVARCHAR(MAX)   NULL,
        [Notes]                  NVARCHAR(MAX)   NULL,
        -- منصة تقييم
        [TaqeemReportNumber]     NVARCHAR(MAX)   NULL,
        [TaqeemSubmittedAt]      NVARCHAR(MAX)   NULL,
        -- الأتمتة
        [AutomationStatus]       NVARCHAR(MAX)   NOT NULL DEFAULT 'idle',
        [AutomationError]        NVARCHAR(MAX)   NULL,
        [AutomationSessionId]    NVARCHAR(MAX)   NULL,
        [QrCodeBase64]           NVARCHAR(MAX)   NULL,
        [CertificatePath]        NVARCHAR(MAX)   NULL,
        -- الملف
        [PdfFilePath]            NVARCHAR(MAX)   NULL,
        [OriginalFileName]       NVARCHAR(MAX)   NULL,
        -- الحالة والتواريخ
        [Status]                 NVARCHAR(MAX)   NOT NULL DEFAULT 'processing',
        [CreatedAt]              DATETIME2       NOT NULL DEFAULT GETUTCDATE(),
        [UpdatedAt]              DATETIME2       NOT NULL DEFAULT GETUTCDATE(),

        CONSTRAINT [PK_Reports] PRIMARY KEY ([Id])
    );

    PRINT 'تم إنشاء جدول Reports بنجاح ✅';
END
ELSE
BEGIN
    PRINT 'جدول Reports موجود مسبقاً';
END
GO

-- للتحقق
SELECT COUNT(*) AS [عدد الأعمدة] FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'Reports';
GO
