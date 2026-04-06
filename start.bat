@echo off
REM ===================================================
REM  أداة تقارير التقييم — ملف التشغيل المحلي
REM  عدّل المتغيرات أدناه حسب بيئتك ثم شغّل هذا الملف
REM ===================================================

REM --- إعدادات SQL Server ---
REM الخيار 1: connection string كاملة (يدعم Integrated Security)
set MSSQL_CONNECTION_STRING=Server=DESKTOP-ABC\SQLEXPRESS;Database=TaqeemDb_Qeemah;Integrated Security=True;TrustServerCertificate=True;

REM الخيار 2: متغيرات منفصلة (SQL Authentication)
REM set MSSQL_SERVER=DESKTOP-ABC\SQLEXPRESS
REM set MSSQL_DATABASE=TaqeemDb_Qeemah
REM set MSSQL_USER=test1
REM set MSSQL_PASSWORD=Aa123456

REM --- إعدادات عامة ---
set PORT=8080
set NODE_ENV=production

REM --- تشغيل الخادم ---
cd /d "%~dp0"
echo [*] جاري تشغيل الخادم على المنفذ %PORT%...
node --enable-source-maps artifacts\api-server\dist\index.mjs

pause
