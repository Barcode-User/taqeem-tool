@echo off
chcp 65001 >nul
REM =======================================================
REM  أداة تقارير التقييم — تشغيل محلي على Windows
REM  شغّل هذا الملف من cmd.exe (لا PowerShell)
REM  بضغطة مزدوجة أو: cmd /c start.bat
REM =======================================================

REM ─── إعدادات SQL Server ────────────────────────────────
REM الخيار 1: Integrated Security (Windows Authentication)
set MSSQL_CONNECTION_STRING=Server=DESKTOP-ABC\SQLEXPRESS;Database=TaqeemDb_Qeemah;Integrated Security=True;TrustServerCertificate=True;

REM الخيار 2: SQL Authentication (أزل REM من الأسطر الأربعة وعطّل الخيار 1)
REM set MSSQL_CONNECTION_STRING=
REM set MSSQL_SERVER=DESKTOP-ABC\SQLEXPRESS
REM set MSSQL_DATABASE=TaqeemDb_Qeemah
REM set MSSQL_USER=sa
REM set MSSQL_PASSWORD=YourPassword

REM ─── مفتاح OpenAI (مطلوب للاستخراج التلقائي) ──────────
REM المفتاح يُقرأ من ملف openai-key.txt (غير مرفوع لـ GitHub)
REM أنشئ الملف بجانب start.bat وضع فيه مفتاحك فقط بدون أي نص إضافي
if exist "%~dp0openai-key.txt" (
    set /p OPENAI_API_KEY=<"%~dp0openai-key.txt"
)

REM ─── إعدادات OpenAI (تُضبط تلقائياً من المفتاح أعلاه) ─
set AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
set AI_INTEGRATIONS_OPENAI_API_KEY=%OPENAI_API_KEY%

REM ─── إعدادات عامة ───────────────────────────────────────
set PORT=8080
set NODE_ENV=production

REM ─── انتقال لمجلد المشروع ────────────────────────────────
cd /d "%~dp0"
echo.
echo =========================================
echo   أداة تقارير التقييم
echo =========================================
echo.

REM ─── التحقق من وجود مفتاح OpenAI ────────────────────────
if "%OPENAI_API_KEY%"=="" (
    echo [تحذير] لم يتم تعيين مفتاح OpenAI!
    echo.
    echo         الحل: أنشئ ملف باسم openai-key.txt
    echo         بجانب ملف start.bat وضع فيه مفتاحك فقط:
    echo         sk-proj-...
    echo.
    echo         يمكنك الحصول على مفتاح من: https://platform.openai.com/api-keys
    echo.
    pause
    exit /b 1
)

REM ─── تثبيت المكتبات إن لم تكن موجودة ──────────────────
if not exist "node_modules" (
    echo [0/2] تثبيت المكتبات... قد يستغرق دقيقتين
    call pnpm install
    if %ERRORLEVEL% NEQ 0 (
        echo [خطأ] فشل تثبيت المكتبات.
        pause
        exit /b 1
    )
    echo [0/2] تثبيت متصفح Playwright...
    call npx playwright install chromium
)

REM ─── تحديث Playwright إن كانت مجلدات المتصفح غير موجودة ────
if not exist "%LOCALAPPDATA%\ms-playwright" (
    echo [0/2] تثبيت متصفح Playwright Chromium...
    call npx playwright install chromium
)

REM ─── بناء الخادم (esbuild بدون typecheck) ───────────────
echo [1/2] بناء الخادم...
call pnpm --filter @workspace/api-server run build
if %ERRORLEVEL% NEQ 0 (
    echo [خطأ] فشل البناء.
    pause
    exit /b 1
)

REM ─── بناء الواجهة (يُشغَّل مرة واحدة فقط) ───────────────
if not exist "artifacts\taqeem-tool\dist\public\index.html" (
    echo [2/2] بناء الواجهة الأمامية...
    call pnpm --filter @workspace/taqeem-tool run build
) else (
    echo [2/2] الواجهة جاهزة.
)

REM ─── تشغيل الخادم ────────────────────────────────────────
echo.
echo [✓] الخادم يعمل على: http://localhost:%PORT%
echo [✓] افتح المتصفح على العنوان أعلاه
echo.
echo اضغط Ctrl+C لإيقاف التشغيل
echo.
node --enable-source-maps artifacts\api-server\dist\index.mjs

pause
