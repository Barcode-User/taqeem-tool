using Microsoft.Playwright;

namespace TaqeemApi.Automation;

public enum LoginStatus { NotLoggedIn, LoggingIn, WaitingOtp, Authenticated, Failed }

public class LoginSession
{
    public string LoginId { get; set; } = Guid.NewGuid().ToString();
    public IBrowser? Browser { get; set; }
    public IBrowserContext? Context { get; set; }
    public LoginStatus Status { get; set; } = LoginStatus.LoggingIn;
    public string Username { get; set; } = "";
    public string? Error { get; set; }
    public TaskCompletionSource<string>? OtpSource { get; set; }
    public List<string> Logs { get; set; } = [];
    public DateTime? LoggedInAt { get; set; }
}

public class AutomationSession
{
    public string SessionId { get; set; } = Guid.NewGuid().ToString();
    public int ReportId { get; set; }
    public string Status { get; set; } = "running";
    public IPage? Page { get; set; }
    public List<string> Logs { get; set; } = [];
}

public class SessionStore
{
    private static readonly string StorageFile =
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Uploads", "taqeem-session.json");
    private static readonly string MetaFile =
        Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "Uploads", "taqeem-session.meta.json");
    private static readonly TimeSpan MaxAge = TimeSpan.FromHours(10);

    private LoginSession? _loginSession;
    private IBrowser? _sharedBrowser;
    private IBrowserContext? _sharedContext;

    public LoginSession? CurrentSession => _loginSession;

    public object GetStatusDto()
    {
        if (_loginSession != null)
        {
            return new
            {
                status = StatusToString(_loginSession.Status),
                username = _loginSession.Username,
                loggedInAt = _loginSession.LoggedInAt?.ToString("o"),
                loginId = _loginSession.LoginId,
                logs = _loginSession.Logs,
                error = _loginSession.Error,
                sessionExpiresAt = _loginSession.LoggedInAt.HasValue
                    ? _loginSession.LoggedInAt.Value.Add(MaxAge).ToString("o")
                    : null
            };
        }

        var meta = LoadMeta();
        if (meta != null)
        {
            return new
            {
                status = "authenticated",
                username = meta.Username,
                loggedInAt = meta.LoggedInAt.ToString("o"),
                loginId = (string?)null,
                logs = Array.Empty<string>(),
                error = (string?)null,
                sessionExpiresAt = meta.LoggedInAt.Add(MaxAge).ToString("o")
            };
        }

        return new { status = "not_logged_in", logs = Array.Empty<string>() };
    }

    private static string StatusToString(LoginStatus s) => s switch
    {
        LoginStatus.NotLoggedIn => "not_logged_in",
        LoginStatus.LoggingIn => "logging_in",
        LoginStatus.WaitingOtp => "waiting_otp",
        LoginStatus.Authenticated => "authenticated",
        LoginStatus.Failed => "failed",
        _ => "not_logged_in"
    };

    public async Task<string> StartLoginAsync(string username, string password,
        Func<LoginSession, string, string, Task> loginFlow)
    {
        if (_loginSession?.Browser != null)
        {
            try { await _loginSession.Browser.CloseAsync(); } catch { }
        }

        var session = new LoginSession { Username = username, Status = LoginStatus.LoggingIn };
        _loginSession = session;

        _ = Task.Run(async () =>
        {
            try { await loginFlow(session, username, password); }
            catch (Exception ex)
            {
                session.Status = LoginStatus.Failed;
                session.Error = ex.Message;
                session.Logs.Add($"❌ فشل: {ex.Message}");
            }
        });

        return session.LoginId;
    }

    public bool SubmitOtp(string loginId, string otp)
    {
        if (_loginSession?.LoginId != loginId) return false;
        if (_loginSession.OtpSource == null) return false;
        _loginSession.OtpSource.TrySetResult(otp);
        _loginSession.OtpSource = null;
        return true;
    }

    public async Task<IBrowserContext?> GetAuthenticatedContextAsync()
    {
        if (_sharedContext != null) return _sharedContext;

        var meta = LoadMeta();
        if (meta == null || !File.Exists(StorageFile)) return null;

        var playwright = await Playwright.CreateAsync();
        _sharedBrowser = await playwright.Chromium.LaunchAsync(new BrowserTypeLaunchOptions
        {
            Headless = true,
            Args = ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage", "--disable-gpu"]
        });

        _sharedContext = await _sharedBrowser.NewContextAsync(new BrowserNewContextOptions
        {
            Locale = "ar-SA",
            TimezoneId = "Asia/Riyadh",
            ViewportSize = new ViewportSize { Width = 1280, Height = 900 },
            StorageStatePath = StorageFile
        });

        if (_loginSession == null)
        {
            _loginSession = new LoginSession
            {
                LoginId = "restored",
                Browser = _sharedBrowser,
                Context = _sharedContext,
                Status = LoginStatus.Authenticated,
                Username = meta.Username,
                LoggedInAt = meta.LoggedInAt,
                Logs = ["تم استعادة الجلسة من الملف المحفوظ."]
            };
        }

        return _sharedContext;
    }

    public void SetSharedContext(IBrowser browser, IBrowserContext context)
    {
        _sharedBrowser = browser;
        _sharedContext = context;
    }

    public async Task SaveStorageStateAsync(IBrowserContext context, string username)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(StorageFile)!);
        await context.StorageStateAsync(new BrowserContextStorageStateOptions { Path = StorageFile });
        var meta = new SessionMeta { Username = username, LoggedInAt = DateTime.UtcNow };
        await File.WriteAllTextAsync(MetaFile,
            System.Text.Json.JsonSerializer.Serialize(meta));
    }

    public async Task LogoutAsync()
    {
        if (_sharedBrowser != null)
        {
            try { await _sharedBrowser.CloseAsync(); } catch { }
        }
        _sharedBrowser = null;
        _sharedContext = null;
        _loginSession = null;
        try { File.Delete(StorageFile); } catch { }
        try { File.Delete(MetaFile); } catch { }
    }

    private SessionMeta? LoadMeta()
    {
        try
        {
            if (!File.Exists(MetaFile) || !File.Exists(StorageFile)) return null;
            var meta = System.Text.Json.JsonSerializer.Deserialize<SessionMeta>(
                File.ReadAllText(MetaFile));
            if (meta == null) return null;
            if (DateTime.UtcNow - meta.LoggedInAt > MaxAge)
            {
                try { File.Delete(StorageFile); } catch { }
                try { File.Delete(MetaFile); } catch { }
                return null;
            }
            return meta;
        }
        catch { return null; }
    }

    private class SessionMeta
    {
        public string Username { get; set; } = "";
        public DateTime LoggedInAt { get; set; }
    }
}
