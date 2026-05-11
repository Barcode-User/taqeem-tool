@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo.
echo =========================================
echo   Taqeem Tool - Barcode for Valuation
echo =========================================
echo.

REM --- تحديث الكود ---
where git >nul 2>&1
if %ERRORLEVEL% EQU 0 (
    echo [update] Syncing from GitHub...
    git fetch origin main
    git reset --hard origin/main
    echo.
) else (
    echo [update] Git not installed.
    if not exist "artifacts\api-server\dist\index.mjs" (
        echo [update] Running PowerShell updater...
        powershell -ExecutionPolicy Bypass -File "%~dp0update.ps1"
        if %ERRORLEVEL% NEQ 0 (
            echo [ERROR] Update failed. Download manually from GitHub.
            pause
            exit /b 1
        )
    ) else (
        echo [update] Skipping - files already present.
    )
    echo.
)

REM --- مسح متغيرات قواعد البيانات ---
set MSSQL_SERVER=
set MSSQL_DATABASE=
set MSSQL_USER=
set MSSQL_PASSWORD=
set MSSQL_CONNECTION_STRING=
set DATABASE_URL=
set AI_INTEGRATIONS_OPENAI_BASE_URL=
set AI_INTEGRATIONS_OPENAI_API_KEY=
set AI_MODEL=

REM --- قراءة مفتاح OpenAI ---
if not exist "%~dp0openai-key.txt" (
    echo.
    echo [ERROR] openai-key.txt not found
    echo   Create a file named: openai-key.txt
    echo   Next to start.bat, with your key: sk-proj-...
    echo.
    pause
    exit /b 1
)
set /p OPENAI_API_KEY=<"%~dp0openai-key.txt"
set AI_INTEGRATIONS_OPENAI_BASE_URL=https://api.openai.com/v1
set AI_INTEGRATIONS_OPENAI_API_KEY=%OPENAI_API_KEY%
set AI_MODEL=gpt-4o-mini
echo [AI] Using OpenAI GPT-4o-mini
echo.

REM --- اعدادات عامة ---
set PORT=8080
set NODE_ENV=production

REM --- ايقاف الخادم القديم ---
echo [stop] Stopping old server on port 8080...
for /f "tokens=5" %%a in ('netstat -ano ^| findstr ":8080 " 2^>nul') do (
    taskkill /F /PID %%a >nul 2>&1
)
timeout /t 2 /nobreak >nul
echo.

REM --- تثبيت node_modules ---
if not exist "node_modules" (
    echo [install] Installing node_modules...
    call pnpm install 2>nul || call npm install
    echo.
)

REM --- تثبيت playwright في api-server مباشرة ---
if not exist "artifacts\api-server\node_modules\playwright" (
    echo [playwright] Installing playwright in api-server...
    cd artifacts\api-server
    call npm install playwright --no-save --legacy-peer-deps
    cd ..\..
    echo.
)

REM --- تثبيت متصفح Chromium ---
if not exist "%LOCALAPPDATA%\ms-playwright" (
    echo [playwright] Installing Chromium browser...
    cd artifacts\api-server
    call npx playwright install chromium 2>nul
    cd ..\..
    echo.
)

REM --- التحقق من الملفات ---
if not exist "artifacts\api-server\dist\index.mjs" (
    echo.
    echo [ERROR] Server file not found.
    echo   Run update.ps1 first to download files.
    echo.
    pause
    exit /b 1
)
echo [1/2] Server OK.

if not exist "artifacts\taqeem-tool\dist\public\index.html" (
    echo.
    echo [ERROR] Frontend files not found.
    echo   Run update.ps1 first to download files.
    echo.
    pause
    exit /b 1
)
echo [2/2] Frontend OK.

REM --- تشغيل الخادم ---
echo.
echo [OK] Server running at: http://localhost:%PORT%
echo [OK] Open browser at the address above
echo.
echo Press Ctrl+C to stop
echo.
node --enable-source-maps artifacts\api-server\dist\index.mjs

pause
