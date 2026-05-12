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
} else {
    # بدون Git: تحقق من آخر commit على GitHub وقارنه بالنسخة المحلية
    $shaFile  = Join-Path $root "data\.version"
    $localSha = if (Test-Path $shaFile) { (Get-Content $shaFile -Raw).Trim() } else { "" }
    $remoteSha = ""
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $apiResp   = Invoke-WebRequest -Uri "https://api.github.com/repos/Barcode-User/taqeem-tool/commits/main" `
                       -UseBasicParsing -Headers @{ "User-Agent" = "taqeem-updater" } -TimeoutSec 8
        $remoteSha = ($apiResp.Content | ConvertFrom-Json).sha
    } catch {
        Write-Host "[update] تعذّر التحقق من GitHub — $($_.Exception.Message.Split([char]10)[0])" -ForegroundColor Gray
    }

    $needsUpdate = (-not (Test-Path $serverFile)) -or (-not (Test-Path $frontendFile)) -or ($remoteSha -and $remoteSha -ne $localSha)

    if ($needsUpdate) {
        if ($remoteSha -and $remoteSha -ne $localSha) {
            Write-Host "[update] إصدار جديد متوفر — جارٍ التحديث..." -ForegroundColor Yellow
        } else {
            Write-Host "[update] Git غير مثبت — تحميل الملفات من GitHub..." -ForegroundColor Yellow
        }
        $zipUrl  = "https://github.com/Barcode-User/taqeem-tool/archive/refs/heads/main.zip"
        $zipTemp = "$env:TEMP\taqeem-update.zip"
        $extTemp = "$env:TEMP\taqeem-extract"
        try {
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
            # حفظ الـ SHA الجديد
            $dataDir2 = Join-Path $root "data"
            if (-not (Test-Path $dataDir2)) { New-Item -ItemType Directory -Path $dataDir2 -Force | Out-Null }
            if ($remoteSha) { Set-Content -Path $shaFile -Value $remoteSha -NoNewline }
            Write-Host "[update] تم التحديث بنجاح ✓" -ForegroundColor Green
        } catch {
            Write-Host "[ERROR] فشل التحميل: $_" -ForegroundColor Red
            Write-Host "  حمّل يدوياً من: https://github.com/Barcode-User/taqeem-tool" -ForegroundColor Yellow
            if (-not (Test-Path $serverFile)) { Read-Host "Press Enter to exit"; exit 1 }
        }
    } else {
        Write-Host "[update] النسخة محدّثة ($($localSha.Substring(0,[Math]::Min(7,$localSha.Length))))" -ForegroundColor Green
    }
    Write-Host ""
}

# --- إنشاء data\config.json إن لم يكن موجوداً ---
$dataDir   = Join-Path $root "data"
$cfgFile   = Join-Path $dataDir "config.json"
if (-not (Test-Path $dataDir)) { New-Item -ItemType Directory -Path $dataDir -Force | Out-Null }
if (-not (Test-Path $cfgFile)) {
    $defaultCfg = @{ qrApiUrl = "http://localhost:5000" } | ConvertTo-Json
    [System.IO.File]::WriteAllText($cfgFile, $defaultCfg, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[config] تم إنشاء data\config.json بالإعدادات الافتراضية" -ForegroundColor Cyan
    Write-Host "  يمكنك تعديل qrApiUrl في الملف لتغيير عنوان QrInformationApi" -ForegroundColor Gray
    Write-Host ""
} else {
    $cfgContent = Get-Content $cfgFile -Raw | ConvertFrom-Json
    Write-Host "[config] QrInformationApi → $($cfgContent.qrApiUrl)" -ForegroundColor Cyan
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
