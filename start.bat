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

REM ─── تحديث تلقائي من GitHub ──────────────────────────────
echo [تحديث] جاري تحديث الكود من GitHub...
git pull --ff-only 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo [تحذير] تعذر تحديث الكود ^(ستستمر بالنسخة الحالية^)
)
echo.

REM ─── إلغاء متغيرات SQL Server القديمة تماماً ─────────────
set MSSQL_SERVER=
set MSSQL_DATABASE=
set MSSQL_USER=
set MSSQL_PASSWORD=
set MSSQL_CONNECTION_STRING=

REM ─── قاعدة البيانات: SQLite تلقائياً على Windows ─────────
set DATABASE_URL=

REM ─── مفتاح الذكاء الاصطناعي ──────────────────────────────
REM الأولوية: groq-key.txt → gemini-key.txt → openai-key.txt
set GROQ_API_KEY=
set GEMINI_API_KEY=
set AI_INTEGRATIONS_OPENAI_BASE_URL=
set AI_INTEGRATIONS_OPENAI_API_KEY=
set AI_MODEL=

if exist "%~dp0groq-key.txt" (
    set /p GROQ_API_KEY=<"%~dp0groq-key.txt"
    set AI_MODEL=llama-3.3-70b-versatile
    echo [AI] يستخدم Groq ^(مجاني^)
) else if exist "%~dp0gemini-key.txt" (
    set /p GEMINI_API_KEY=<"%~dp0gemini-key.txt"
    set AI_INTEGRATIONS_OPENAI_BASE_URL=https://generativelanguage.googleapis.com/v1beta/openai/
    set AI_INTEGRATIONS_OPENAI_API_KEY=%GEMINI_API_KEY%
    set AI_MODEL=gemini-2.0-flash
    echo [AI] يستخدم Gemini
) else if exist "%~dp0openai-key.txt" (
    set /p OPENAI_API_KEY=<"%~dp0openai-key.txt"
    set AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
    set AI_INTEGRATIONS_OPENAI_API_KEY=%OPENAI_API_KEY%
    set AI_MODEL=gpt-4o-mini
    echo [AI] يستخدم OpenAI GPT-4o-mini
) else (
    echo.
    echo [!] لم يتم تعيين مفتاح الذكاء الاصطناعي
    echo.
    echo  الخيار 1 - Groq ^(مجاني تماماً^):
    echo    1. افتح: https://console.groq.com/keys
    echo    2. أنشئ ملف باسم: groq-key.txt بجانب start.bat
    echo    3. ضع المفتاح فيه: gsk_...
    echo.
    echo  الخيار 2 - OpenAI GPT-4o-mini:
    echo    1. افتح: https://platform.openai.com/api-keys
    echo    2. أنشئ ملف باسم: openai-key.txt بجانب start.bat
    echo    3. ضع المفتاح فيه: sk-proj-...
    echo.
    pause
    exit /b 1
)

REM ─── إعدادات عامة ───────────────────────────────────────
set PORT=8080
set NODE_ENV=production

REM ─── تثبيت المكتبات إن لم تكن موجودة ──────────────────
if not exist "node_modules" (
    echo.
    echo [0/2] تثبيت المكتبات... قد يستغرق دقيقتين
    call pnpm install --no-frozen-lockfile
    if %ERRORLEVEL% NEQ 0 (
        echo [خطأ] فشل تثبيت المكتبات.
        pause
        exit /b 1
    )
)

REM ─── تثبيت Playwright إن لم يكن موجوداً ────────────────
if not exist "%LOCALAPPDATA%\ms-playwright" (
    echo [0/2] تثبيت متصفح Playwright...
    call npx playwright install chromium 2>nul
)

REM ─── الخادم: نستخدم النسخة المبنية من Replit مباشرة ─────
REM لا حاجة للبناء المحلي — الحزمة جاهزة ومحدّثة من GitHub
echo.
if exist "artifacts\api-server\dist\index.mjs" (
    echo [1/2] الخادم جاهز.
) else (
    echo [1/2] الحزمة المبنية غير موجودة - تأكد من تشغيل: git pull
    pause
    exit /b 1
)

REM ─── الواجهة ─────────────────────────────────────────────
if exist "artifacts\taqeem-tool\dist\public\index.html" (
    echo [2/2] الواجهة جاهزة.
) else (
    echo [2/2] الواجهة غير موجودة - تأكد من تشغيل: git pull
    pause
    exit /b 1
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
