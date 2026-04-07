@echo off
chcp 65001 >nul
REM =======================================================
REM  أداة تقارير التقييم — تشغيل محلي على Windows
REM =======================================================

cd /d "%~dp0"

echo.
echo =========================================
echo   أداة تقارير التقييم — باركود للتقييم
echo =========================================
echo.

REM ─── تحديث من GitHub ─────────────────────────────────
echo [تحديث] جاري مزامنة الكود مع GitHub...
git fetch origin main 2>nul
git reset --hard origin/main 2>nul
echo.

REM ─── إلغاء متغيرات قواعد البيانات القديمة ───────────
set MSSQL_SERVER=
set MSSQL_DATABASE=
set MSSQL_USER=
set MSSQL_PASSWORD=
set MSSQL_CONNECTION_STRING=
set DATABASE_URL=

REM ─── OpenAI فقط — يقرأ من openai-key.txt ────────────
set AI_INTEGRATIONS_OPENAI_BASE_URL=
set AI_INTEGRATIONS_OPENAI_API_KEY=
set AI_MODEL=

if not exist "%~dp0openai-key.txt" (
    echo.
    echo [!] ملف openai-key.txt غير موجود
    echo.
    echo     أنشئ ملفاً باسم: openai-key.txt
    echo     في نفس مجلد start.bat
    echo     وضع فيه مفتاح OpenAI فقط: sk-proj-...
    echo.
    pause
    exit /b 1
)

set /p OPENAI_API_KEY=<"%~dp0openai-key.txt"
set AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
set AI_INTEGRATIONS_OPENAI_API_KEY=%OPENAI_API_KEY%
set AI_MODEL=gpt-4o-mini
echo [AI] يستخدم OpenAI GPT-4o-mini
echo.

REM ─── إعدادات عامة ────────────────────────────────────
set PORT=8080
set NODE_ENV=production

REM ─── تثبيت المكتبات إن لم تكن موجودة ───────────────
if not exist "node_modules" (
    echo [0/2] تثبيت المكتبات... قد يستغرق دقيقتين
    call pnpm install --no-frozen-lockfile
    if %ERRORLEVEL% NEQ 0 (
        echo [خطأ] فشل تثبيت المكتبات.
        pause
        exit /b 1
    )
    echo.
)

REM ─── تثبيت Playwright إن لم يكن موجوداً ─────────────
if not exist "%LOCALAPPDATA%\ms-playwright" (
    echo [0/2] تثبيت متصفح Playwright...
    call npx playwright install chromium 2>nul
)

REM ─── التحقق من الملفات المبنية ───────────────────────
if not exist "artifacts\api-server\dist\index.mjs" (
    echo [خطأ] الخادم غير موجود - تأكد من اتصال الإنترنت وأعد تشغيل start.bat
    pause
    exit /b 1
)
echo [1/2] الخادم جاهز.

if not exist "artifacts\taqeem-tool\dist\public\index.html" (
    echo [خطأ] الواجهة غير موجودة - تأكد من اتصال الإنترنت وأعد تشغيل start.bat
    pause
    exit /b 1
)
echo [2/2] الواجهة جاهزة.

REM ─── تشغيل الخادم ────────────────────────────────────
echo.
echo [✓] الخادم يعمل على: http://localhost:%PORT%
echo [✓] افتح المتصفح على العنوان أعلاه
echo.
echo اضغط Ctrl+C لإيقاف التشغيل
echo.
node --enable-source-maps artifacts\api-server\dist\index.mjs

pause
