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

REM ─── تحديث من GitHub (اختياري — يعمل فقط إذا كان Git مثبتاً) ────────────
where git >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [تحديث] جاري مزامنة الكود مع GitHub...
    git fetch origin main
    git reset --hard origin/main
) else (
    echo [تحديث] Git غير مثبت — تخطي المزامنة.
)
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

REM ─── إيقاف أي خادم قديم على نفس المنفذ ─────────────
echo [إيقاف] إيقاف أي خادم سابق على المنفذ 8080...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080 " 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo.

REM ─── تثبيت node_modules إن لم تكن موجودة ────────────
if not exist "node_modules" (
    echo [تثبيت] node_modules غير موجودة — جاري التثبيت...
    call pnpm install --ignore-scripts 2>nul || call npm install --ignore-scripts
    echo.
)

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
    echo.
    echo [خطأ] الخادم غير موجود.
    echo       تأكد أن git مثبت وشغّل start.bat مجدداً للتحديث من GitHub.
    echo.
    pause
    exit /b 1
)
echo [1/2] الخادم جاهز.

if not exist "artifacts\taqeem-tool\dist\public\index.html" (
    echo.
    echo [خطأ] الواجهة غير موجودة.
    echo       تأكد أن git مثبت وشغّل start.bat مجدداً للتحديث من GitHub.
    echo.
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
