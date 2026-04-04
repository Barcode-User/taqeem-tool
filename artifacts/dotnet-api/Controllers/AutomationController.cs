using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using TaqeemApi.Automation;
using TaqeemApi.Data;

namespace TaqeemApi.Controllers;

[ApiController]
[Route("api/automation")]
public class AutomationController(
    SessionStore sessionStore,
    TaqeemBot bot,
    AppDbContext db,
    ILogger<AutomationController> logger) : ControllerBase
{
    // ── SESSION MANAGEMENT ────────────────────────────────────────────────────

    // GET /api/automation/session-status
    [HttpGet("session-status")]
    public IActionResult GetSessionStatus()
        => Ok(sessionStore.GetStatusDto());

    // POST /api/automation/login
    [HttpPost("login")]
    public async Task<IActionResult> Login([FromBody] LoginRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.Username) || string.IsNullOrWhiteSpace(req.Password))
            return BadRequest(new { error = "username and password are required" });

        var loginId = await sessionStore.StartLoginAsync(
            req.Username, req.Password,
            async (session, u, p) => await bot.RunLoginFlowAsync(session, u, p));

        return Ok(new { loginId, message = "بدأت عملية تسجيل الدخول — انتظر رمز OTP" });
    }

    // POST /api/automation/login-otp
    [HttpPost("login-otp")]
    public IActionResult SubmitLoginOtp([FromBody] OtpRequest req)
    {
        if (string.IsNullOrWhiteSpace(req.LoginId) || string.IsNullOrWhiteSpace(req.Otp))
            return BadRequest(new { error = "loginId and otp are required" });

        var ok = sessionStore.SubmitOtp(req.LoginId, req.Otp);
        if (!ok) return BadRequest(new { error = "جلسة تسجيل الدخول غير موجودة أو انتهت" });

        return Ok(new { message = "تم إرسال OTP — جارٍ إكمال تسجيل الدخول..." });
    }

    // POST /api/automation/logout
    [HttpPost("logout")]
    public async Task<IActionResult> Logout()
    {
        await sessionStore.LogoutAsync();
        return Ok(new { message = "تم تسجيل الخروج." });
    }

    // ── REPORT AUTOMATION ─────────────────────────────────────────────────────

    // POST /api/automation/start/:reportId
    [HttpPost("start/{reportId:int}")]
    public async Task<IActionResult> Start(int reportId)
    {
        var report = await db.Reports
            .Where(r => r.Id == reportId)
            .Select(r => new { r.AutomationStatus })
            .FirstOrDefaultAsync();

        if (report == null) return NotFound(new { error = "Report not found" });
        if (report.AutomationStatus is "running" or "waiting_otp")
            return Conflict(new { error = "التقرير قيد المعالجة بالفعل" });

        try
        {
            var sessionId = await bot.StartAutomationAsync(reportId);
            return Ok(new { sessionId, message = "بدأت عملية الرفع الآلي" });
        }
        catch (Exception ex)
        {
            logger.LogError(ex, "Failed to start automation for report {ReportId}", reportId);
            return StatusCode(500, new { error = ex.Message });
        }
    }

    // GET /api/automation/status/:reportId
    [HttpGet("status/{reportId:int}")]
    public async Task<IActionResult> Status(int reportId)
    {
        var report = await db.Reports
            .Where(r => r.Id == reportId)
            .Select(r => new
            {
                r.AutomationStatus, r.AutomationError, r.AutomationSessionId,
                r.QrCodeBase64, r.CertificatePath, r.TaqeemSubmittedAt
            })
            .FirstOrDefaultAsync();

        if (report == null) return NotFound(new { error = "Report not found" });

        var session = bot.GetReportSession(reportId);
        var logs = session?.Logs ?? [];

        return Ok(new
        {
            reportId,
            automationStatus = report.AutomationStatus ?? "idle",
            report.AutomationError,
            sessionId = report.AutomationSessionId,
            report.QrCodeBase64,
            hasCertificate = !string.IsNullOrEmpty(report.CertificatePath),
            report.TaqeemSubmittedAt,
            logs
        });
    }

    // GET /api/automation/certificate/:reportId
    [HttpGet("certificate/{reportId:int}")]
    public async Task<IActionResult> Certificate(int reportId)
    {
        var report = await db.Reports
            .Where(r => r.Id == reportId)
            .Select(r => new { r.CertificatePath })
            .FirstOrDefaultAsync();

        if (report?.CertificatePath == null || !System.IO.File.Exists(report.CertificatePath))
            return NotFound(new { error = "Certificate not found" });

        return PhysicalFile(report.CertificatePath, "application/pdf",
            $"certificate_{reportId}.pdf");
    }

    // POST /api/automation/retry/:reportId
    [HttpPost("retry/{reportId:int}")]
    public async Task<IActionResult> Retry(int reportId)
    {
        await db.Reports.Where(r => r.Id == reportId).ExecuteUpdateAsync(s => s
            .SetProperty(r => r.AutomationStatus, "idle")
            .SetProperty(r => r.AutomationError, (string?)null));

        try
        {
            var sessionId = await bot.StartAutomationAsync(reportId);
            return Ok(new { sessionId, message = "تمت إعادة المحاولة" });
        }
        catch (Exception ex)
        {
            return StatusCode(500, new { error = ex.Message });
        }
    }
}

public record LoginRequest(string Username, string Password);
public record OtpRequest(string LoginId, string Otp);
