$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Taqeem Tool - Barcode for Valuation" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# --- تحديث من GitHub ---
$gitAvailable = (Get-Command git -ErrorAction SilentlyContinue) -ne $null
$serverFile   = Join-Path $root "artifacts\api-server\dist\index.mjs"
$frontendFile = Join-Path $root "artifacts\taqeem-tool\dist\public\index.html"

if ($gitAvailable) {
    Write-Host "[update] Syncing from GitHub..." -ForegroundColor Yellow
    git fetch origin main
    git reset --hard origin/main
    Write-Host ""
} elseif (-not (Test-Path $serverFile) -or -not (Test-Path $frontendFile)) {
    Write-Host "[update] Git not found. Downloading from GitHub..." -ForegroundColor Yellow
    $zipUrl  = "https://github.com/Barcode-User/taqeem-tool/archive/refs/heads/main.zip"
    $zipTemp = "$env:TEMP\taqeem-update.zip"
    $extTemp = "$env:TEMP\taqeem-extract"
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $zipUrl -OutFile $zipTemp -UseBasicParsing
        if (Test-Path $extTemp) { Remove-Item $extTemp -Recurse -Force }
        Expand-Archive -Path $zipTemp -DestinationPath $extTemp -Force
        Remove-Item $zipTemp -Force
        $src = Join-Path $extTemp "taqeem-tool-main"
        foreach ($p in @("artifacts\api-server\dist", "artifacts\taqeem-tool\dist", "start.ps1", "start.bat", "update.ps1")) {
            $from = Join-Path $src $p
            $to   = Join-Path $root $p
            if (Test-Path $from) {
                $dir = Split-Path $to
                if (-not (Test-Path $dir)) { New-Item -ItemType Directory -Path $dir -Force | Out-Null }
                Copy-Item -Path $from -Destination $to -Recurse -Force
                Write-Host "  OK: $p" -ForegroundColor Green
            }
        }
        Remove-Item $extTemp -Recurse -Force
    } catch {
        Write-Host "[ERROR] Download failed: $_" -ForegroundColor Red
        Write-Host "  Download manually from: https://github.com/Barcode-User/taqeem-tool" -ForegroundColor Yellow
        Read-Host "Press Enter to exit"
        exit 1
    }
    Write-Host ""
} else {
    Write-Host "[update] Files present, skipping update." -ForegroundColor Gray
    Write-Host ""
}

# --- قراءة مفتاح OpenAI ---
$keyFile = Join-Path $root "openai-key.txt"
if (-not (Test-Path $keyFile)) {
    Write-Host ""
    Write-Host "[ERROR] openai-key.txt not found" -ForegroundColor Red
    Write-Host "  Create a file named openai-key.txt next to start.bat" -ForegroundColor Yellow
    Write-Host "  Put your API key inside: sk-proj-..." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
$openaiKey = (Get-Content $keyFile -Raw).Trim()

# --- ضبط المتغيرات ---
$env:PORT                            = "8080"
$env:NODE_ENV                        = "production"
$env:AI_INTEGRATIONS_OPENAI_BASE_URL = "https://api.openai.com/v1"
$env:AI_INTEGRATIONS_OPENAI_API_KEY  = $openaiKey
$env:AI_MODEL                        = "gpt-4o-mini"
$env:MSSQL_SERVER                    = ""
$env:MSSQL_DATABASE                  = ""
$env:MSSQL_USER                      = ""
$env:MSSQL_PASSWORD                  = ""
$env:DATABASE_URL                    = ""
Write-Host "[AI] Using OpenAI GPT-4o-mini" -ForegroundColor Green
Write-Host ""

# --- ايقاف الخادم القديم ---
Write-Host "[stop] Stopping old server on port 8080..." -ForegroundColor Yellow
try {
    $conns = netstat -ano | Select-String ":8080\s"
    foreach ($line in $conns) {
        $parts = ($line.ToString().Trim() -split "\s+")
        $pid   = $parts[-1]
        if ($pid -match "^\d+$" -and $pid -ne "0") {
            Stop-Process -Id ([int]$pid) -Force -ErrorAction SilentlyContinue
        }
    }
} catch {}
Start-Sleep -Seconds 2
Write-Host ""

# --- تثبيت node_modules ---
$nmPath = Join-Path $root "node_modules"
if (-not (Test-Path $nmPath)) {
    Write-Host "[install] Installing node_modules..." -ForegroundColor Yellow
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($pnpm) { & pnpm install } else { & npm install }
    Write-Host ""
}

# --- تثبيت playwright في api-server ---
$pwPath = Join-Path $root "artifacts\api-server\node_modules\playwright"
if (-not (Test-Path $pwPath)) {
    Write-Host "[playwright] Installing playwright..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "artifacts\api-server")
    & npm install playwright --no-save --legacy-peer-deps
    Pop-Location
    Write-Host ""
}

# --- تثبيت متصفح Chromium ---
$msPlaywright = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (-not (Test-Path $msPlaywright)) {
    Write-Host "[playwright] Installing Chromium browser..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "artifacts\api-server")
    & npx playwright install chromium 2>$null
    Pop-Location
    Write-Host ""
}

# --- التحقق من الملفات ---
if (-not (Test-Path $serverFile)) {
    Write-Host ""
    Write-Host "[ERROR] Server file not found: $serverFile" -ForegroundColor Red
    Write-Host "  Run update.ps1 to download files." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[1/2] Server OK." -ForegroundColor Green

if (-not (Test-Path $frontendFile)) {
    Write-Host ""
    Write-Host "[ERROR] Frontend file not found: $frontendFile" -ForegroundColor Red
    Write-Host "  Run update.ps1 to download files." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
Write-Host "[2/2] Frontend OK." -ForegroundColor Green

# --- تشغيل الخادم ---
Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Server running at: http://localhost:8080" -ForegroundColor Green
Write-Host "  Open browser at the address above" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""

$indexMjs = Join-Path $root "artifacts\api-server\dist\index.mjs"
& node --enable-source-maps $indexMjs
