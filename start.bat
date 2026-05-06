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
git fetch origin main
git reset --hard origin/main
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

REM ─── تثبيت المكتبات ──────────────────────────────────
echo [build] جاري تثبيت المكتبات...
call pnpm install --frozen-lockfile 2>nul || call pnpm install
echo.

REM ─── بناء الخادم دائماً ───────────────────────────────
echo [build] جاري بناء الخادم من المصدر...
call pnpm --filter @workspace/api-server run build
if %ERRORLEVEL% NEQ 0 (
    echo [خطأ] فشل بناء الخادم.
    pause
    exit /b 1
)
echo [build] تم بناء الخادم بنجاح.
echo.

REM ─── تثبيت Playwright إن لم يكن موجوداً ─────────────
if not exist "artifacts\api-server\node_modules\playwright-core" (
    echo [playwright] تثبيت مكتبة Playwright...

    if exist "tmp-pw-install" rmdir /S /Q tmp-pw-install
    mkdir tmp-pw-install
    (
        echo {
        echo   "name": "pw-install",
        echo   "version": "1.0.0",
        echo   "private": true
        echo }
    ) > tmp-pw-install\package.json

    call npm install playwright playwright-core --prefix tmp-pw-install --legacy-peer-deps --no-workspaces --silent
    if %ERRORLEVEL% NEQ 0 (
        echo [خطأ] فشل تثبيت Playwright.
        rmdir /S /Q tmp-pw-install 2>nul
        pause
        exit /b 1
    )

    if not exist "artifacts\api-server\node_modules" mkdir artifacts\api-server\node_modules
    robocopy tmp-pw-install\node_modules artifacts\api-server\node_modules /E /NFL /NDL /NJH /NJS /nc /ns /np >nul
    rmdir /S /Q tmp-pw-install 2>nul
    echo.
)

if not exist "%LOCALAPPDATA%\ms-playwright" (
    echo [playwright] تثبيت متصفح Chromium...
    cd artifacts\api-server
    call npx playwright install chromium --no-workspaces 2>nul
    cd ..\..
)

REM ─── التحقق من الملفات المبنية ───────────────────────
if not exist "artifacts\api-server\dist\index.mjs" (
    echo [خطأ] الخادم غير موجود بعد البناء.
    pause
    exit /b 1
)
echo [1/2] الخادم جاهز.

if not exist "artifacts\taqeem-tool\dist\public\index.html" (
    echo [خطأ] الواجهة غير موجودة.
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
