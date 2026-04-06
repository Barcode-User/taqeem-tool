@echo off
chcp 65001 >nul
REM =======================================================
REM  أداة تقارير التقييم — تشغيل محلي على Windows
REM  عدّل إعدادات SQL Server أدناه ثم شغّل هذا الملف
REM =======================================================

REM ─── إعدادات SQL Server ────────────────────────────────
REM الخيار 1: connection string كاملة (Integrated Security)
set MSSQL_CONNECTION_STRING=Server=DESKTOP-ABC\SQLEXPRESS;Database=TaqeemDb_Qeemah;Integrated Security=True;TrustServerCertificate=True;

REM الخيار 2: SQL Authentication (أزل REM من السطور الأربعة)
REM set MSSQL_CONNECTION_STRING=
REM set MSSQL_SERVER=DESKTOP-ABC\SQLEXPRESS
REM set MSSQL_DATABASE=TaqeemDb_Qeemah
REM set MSSQL_USER=sa
REM set MSSQL_PASSWORD=YourPassword

REM ─── إعدادات OpenAI (للاستخراج التلقائي من PDF) ────────
REM set OPENAI_API_KEY=sk-...

REM ─── إعدادات عامة ───────────────────────────────────────
set PORT=8080
set NODE_ENV=production

REM ─── انتقال لمجلد المشروع ────────────────────────────────
cd /d "%~dp0"
echo.
echo =========================================
echo   أداة تقارير التقييم — جارٍ التشغيل
echo =========================================
echo.

REM ─── بناء الخادم (esbuild بدون typecheck) ───────────────
echo [1/2] بناء الخادم...
call pnpm --filter @workspace/api-server run build
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo [خطأ] فشل البناء. تأكد من تثبيت الحزم بـ: pnpm install
    pause
    exit /b 1
)

REM ─── بناء الواجهة (اختياري — يُشغَّل مرة واحدة) ─────────
if not exist "artifacts\taqeem-tool\dist\public\index.html" (
    echo [2/2] بناء الواجهة الأمامية...
    call pnpm --filter @workspace/taqeem-tool run build
) else (
    echo [2/2] الواجهة الأمامية جاهزة مسبقاً.
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
