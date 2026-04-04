using Microsoft.Playwright;
using TaqeemApi.Data;
using TaqeemApi.Models;
using Microsoft.EntityFrameworkCore;

namespace TaqeemApi.Automation;

public class TaqeemBot(SessionStore sessionStore, IServiceScopeFactory scopeFactory, ILogger<TaqeemBot> logger)
{
    private const string TaqeemUrl = "https://qima.taqeem.gov.sa";
    private static readonly string UploadsDir =
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Uploads");

    private readonly Dictionary<int, AutomationSession> _reportSessions = new();

    // ── LOGIN FLOW ────────────────────────────────────────────────────────────

    public async Task RunLoginFlowAsync(LoginSession session, string username, string password)
    {
        var playwright = await Playwright.CreateAsync();
        var browser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = true,
            Args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        });

        var context = await browser.NewContextAsync(new BrowserNewContextOptions
        {
            Locale = "ar-SA",
            TimezoneId = "Asia/Riyadh",
            ViewportSize = new ViewportSize { Width = 1280, Height = 900 },
            UserAgent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
        });

        session.Browser = browser;
        session.Context = context;

        var page = await context.NewPageAsync();

        AddLog(session.Logs, "الانتقال إلى صفحة تسجيل الدخول...");

        // ⚠️ TODO: تحديث الرابط إذا لزم
        await page.GotoAsync($"{TaqeemUrl}/membership/login",
            new PageGotoOptions { WaitUntil = WaitUntilState.NetworkIdle, Timeout = 30000 });

        // Check if already logged in
        if (!page.Url.Contains("/login"))
        {
            AddLog(session.Logs, "تم استعادة الجلسة السابقة ✅");
            await page.CloseAsync();
            session.Status = LoginStatus.Authenticated;
            session.LoggedInAt = DateTime.UtcNow;
            await sessionStore.SaveStorageStateAsync(context, username);
            sessionStore.SetSharedContext(browser, context);
            return;
        }

        AddLog(session.Logs, "إدخال بيانات الدخول...");

        // ⚠️ TODO: تحديث محددات حقول الدخول
        await page.FillAsync("input[name='username'], input[type='text']:first-of-type", username);
        await page.FillAsync("input[name='password'], input[type='password']", password);
        await page.ClickAsync("button[type='submit'], input[type='submit']");

        AddLog(session.Logs, "انتظار صفحة OTP...");
        session.Status = LoginStatus.WaitingOtp;

        // ⚠️ TODO: تحديث انتظار صفحة OTP
        try { await page.WaitForURLAsync(url => url.Contains("otp") || url.Contains("verify"), new PageWaitForURLOptions { Timeout = 15000 }); }
        catch { }

        session.OtpSource = new TaskCompletionSource<string>();
        var otp = await session.OtpSource.Task;

        AddLog(session.Logs, "إدخال رمز OTP...");
        session.Status = LoginStatus.LoggingIn;

        // ⚠️ TODO: تحديث محدد حقل OTP
        await page.FillAsync("input[name='otp'], input[placeholder*='رمز'], input[maxlength='6']", otp);
        await page.ClickAsync("button[type='submit'], input[type='submit']");
        await page.WaitForNavigationAsync(new PageWaitForNavigationOptions
            { WaitUntil = WaitUntilState.NetworkIdle, Timeout = 30000 });

        AddLog(session.Logs, "تم تسجيل الدخول بنجاح ✅");
        AddLog(session.Logs, "جارٍ حفظ الجلسة لمدة 10 ساعات...");

        await page.CloseAsync();
        session.Status = LoginStatus.Authenticated;
        session.LoggedInAt = DateTime.UtcNow;

        await sessionStore.SaveStorageStateAsync(context, username);
        sessionStore.SetSharedContext(browser, context);

        AddLog(session.Logs, "✅ الجلسة محفوظة — يمكنك رفع أي عدد من التقارير الآن.");
    }

    // ── REPORT AUTOMATION ────────────────────────────────────────────────────

    public async Task<string> StartAutomationAsync(int reportId)
    {
        var context = await sessionStore.GetAuthenticatedContextAsync()
            ?? throw new InvalidOperationException("لا توجد جلسة مسجّلة. يرجى تسجيل الدخول أولاً.");

        var session = new AutomationSession { ReportId = reportId };
        _reportSessions[reportId] = session;

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();

        await db.Reports
            .Where(r => r.Id == reportId)
            .ExecuteUpdateAsync(s => s
                .SetProperty(r => r.AutomationStatus, "running")
                .SetProperty(r => r.AutomationError, (string?)null)
                .SetProperty(r => r.AutomationSessionId, session.SessionId));

        _ = Task.Run(async () =>
        {
            try { await RunAutomationAsync(session, reportId, context); }
            catch (Exception ex)
            {
                AddLog(session.Logs, $"❌ خطأ فادح: {ex.Message}");
                using var s2 = scopeFactory.CreateScope();
                var db2 = s2.ServiceProvider.GetRequiredService<AppDbContext>();
                await db2.Reports.Where(r => r.Id == reportId).ExecuteUpdateAsync(s => s
                    .SetProperty(r => r.AutomationStatus, "failed")
                    .SetProperty(r => r.AutomationError, ex.Message));
                try { if (session.Page != null) await session.Page.CloseAsync(); } catch { }
                _reportSessions.Remove(reportId);
            }
        });

        return session.SessionId;
    }

    private async Task RunAutomationAsync(AutomationSession session, int reportId, IBrowserContext context)
    {
        var page = await context.NewPageAsync();
        session.Page = page;

        using var scope = scopeFactory.CreateScope();
        var db = scope.ServiceProvider.GetRequiredService<AppDbContext>();
        var report = await db.Reports.FindAsync(reportId)
            ?? throw new Exception($"التقرير {reportId} غير موجود");

        AddLog(session.Logs, "بدء عملية الرفع الآلي...");

        // ⚠️ TODO: تحديث رابط إنشاء التقرير
        await page.GotoAsync($"{TaqeemUrl}/membership/report/create",
            new PageGotoOptions { WaitUntil = WaitUntilState.NetworkIdle, Timeout = 30000 });

        if (page.Url.Contains("/login"))
            throw new Exception("انتهت الجلسة — يرجى تسجيل الدخول مجدداً.");

        AddLog(session.Logs, "تعبئة بيانات التقرير...");
        await FillReportFormAsync(page, report);

        if (!string.IsNullOrEmpty(report.PdfFilePath) && File.Exists(report.PdfFilePath))
        {
            AddLog(session.Logs, "رفع ملف PDF...");
            // ⚠️ TODO: تحديث محدد حقل رفع الملف
            var fileInput = await page.QuerySelectorAsync("input[type='file']");
            if (fileInput != null) await fileInput.SetInputFilesAsync(report.PdfFilePath);
        }

        AddLog(session.Logs, "إرسال التقرير...");
        // ⚠️ TODO: تحديث محدد زر الإرسال
        await page.ClickAsync("button[type='submit']:has-text('حفظ'), button:has-text('إرسال')");
        await page.WaitForNavigationAsync(new PageWaitForNavigationOptions
            { WaitUntil = WaitUntilState.NetworkIdle, Timeout = 30000 });

        AddLog(session.Logs, "استخراج QR Code والشهادة...");
        var (qrCode, certPath) = await ExtractResultsAsync(page, session.Logs, reportId);

        await db.Reports.Where(r => r.Id == reportId).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.AutomationStatus, "completed")
            .SetProperty(r => r.QrCodeBase64, qrCode)
            .SetProperty(r => r.CertificatePath, certPath)
            .SetProperty(r => r.TaqeemSubmittedAt, DateTime.UtcNow.ToString("o")));

        AddLog(session.Logs, "✅ اكتملت العملية بنجاح!");
        await page.CloseAsync();
        _reportSessions.Remove(reportId);
    }

    // ⚠️ TODO: تحديث محددات الحقول بناءً على لقطات شاشة منصة تقييم
    private static async Task FillReportFormAsync(IPage page, Report r)
    {
        async Task Fill(string sel, object? val)
        {
            if (val == null) return;
            try
            {
                var el = await page.QuerySelectorAsync(sel);
                if (el != null) await page.FillAsync(sel, val.ToString()!);
            }
            catch { }
        }

        await Fill("[name='report_number'], [id*='report_number']", r.ReportNumber);
        await Fill("[name='report_date'], [id*='report_date']", r.ReportDate);
        await Fill("[name='valuation_date'], [id*='valuation_date']", r.ValuationDate);
        await Fill("[name='client_name'], [id*='client']", r.ClientName);
        await Fill("[name='client_email']", r.ClientEmail);
        await Fill("[name='client_phone']", r.ClientPhone);
        await Fill("[name='deed_number'], [id*='deed']", r.DeedNumber);
        await Fill("[name='land_area'], [id*='land_area']", r.LandArea);
        await Fill("[name='final_value'], [id*='final_value']", r.FinalValue);
    }

    private async Task<(string? qrCode, string? certPath)> ExtractResultsAsync(
        IPage page, List<string> logs, int reportId)
    {
        string? qrCode = null;
        string? certPath = null;

        try
        {
            // ⚠️ TODO: تحديث محدد QR Code
            var qrImg = await page.QuerySelectorAsync("img[src*='qr'], img[alt*='QR']");
            if (qrImg != null)
            {
                var src = await qrImg.GetAttributeAsync("src");
                if (src?.StartsWith("data:") == true) qrCode = src;
                AddLog(logs, "تم استخراج QR Code.");
            }

            // ⚠️ TODO: تحديث محدد رابط الشهادة
            var certFilename = $"certificate_{reportId}_{DateTimeOffset.UtcNow.ToUnixTimeSeconds()}.pdf";
            certPath = Path.Combine(UploadsDir, certFilename);
            var download = await page.RunAndWaitForDownloadAsync(async () =>
            {
                try { await page.ClickAsync("a[href*='certificate'], button:has-text('تحميل الشهادة')"); }
                catch { }
            }, new PageRunAndWaitForDownloadOptions { Timeout = 5000 });

            if (download != null)
            {
                await download.SaveAsAsync(certPath);
                AddLog(logs, "تم تحميل الشهادة.");
            }
            else certPath = null;
        }
        catch (Exception ex)
        {
            AddLog(logs, $"تحذير: لم يتم استخراج النتائج - {ex.Message}");
        }

        return (qrCode, certPath);
    }

    public AutomationSession? GetReportSession(int reportId)
        => _reportSessions.TryGetValue(reportId, out var s) ? s : null;

    private static void AddLog(List<string> logs, string msg)
    {
        logs.Add($"[{DateTime.UtcNow:HH:mm:ss}] {msg}");
    }
}
