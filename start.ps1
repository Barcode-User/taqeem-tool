$ErrorActionPreference = "Continue"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $root

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "  Taqeem Tool - Barcode for Valuation" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# --- Update from GitHub ---
$gitAvailable = (Get-Command git -ErrorAction SilentlyContinue) -ne $null
$serverFile   = Join-Path $root "artifacts\api-server\dist\index.mjs"
$frontendFile = Join-Path $root "artifacts\taqeem-tool\dist\public\index.html"
$dataDir      = Join-Path $root "data"
$shaFile      = Join-Path $dataDir ".version"

if ($gitAvailable) {
    Write-Host "[update] Syncing from GitHub..." -ForegroundColor Yellow
    git fetch origin main
    git reset --hard origin/main
    Write-Host ""
} else {
    $localSha  = ""
    $remoteSha = ""

    if (Test-Path $shaFile) {
        $localSha = (Get-Content $shaFile -Raw).Trim()
    }

    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $apiResp   = Invoke-WebRequest `
            -Uri "https://api.github.com/repos/Barcode-User/taqeem-tool/commits/main" `
            -UseBasicParsing `
            -Headers @{ "User-Agent" = "taqeem-updater" } `
            -TimeoutSec 8
        $remoteSha = ($apiResp.Content | ConvertFrom-Json).sha
    } catch {
        Write-Host "[update] Cannot reach GitHub - using local files" -ForegroundColor Gray
    }

    $filesExist  = (Test-Path $serverFile) -and (Test-Path $frontendFile)
    $needsUpdate = (-not $filesExist) -or ($remoteSha -and ($remoteSha -ne $localSha))

    if ($needsUpdate) {
        if ($remoteSha -and ($remoteSha -ne $localSha)) {
            Write-Host "[update] New version available - updating..." -ForegroundColor Yellow
        } else {
            Write-Host "[update] Downloading files from GitHub..." -ForegroundColor Yellow
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
            $copyList = @(
                "artifacts\api-server\dist",
                "artifacts\taqeem-tool\dist",
                "start.ps1",
                "start.bat",
                "update.ps1"
            )
            foreach ($p in $copyList) {
                $from = Join-Path $src $p
                $to   = Join-Path $root $p
                if (Test-Path $from) {
                    $dir = Split-Path $to
                    if (-not (Test-Path $dir)) {
                        New-Item -ItemType Directory -Path $dir -Force | Out-Null
                    }
                    Copy-Item -Path $from -Destination $to -Recurse -Force
                    Write-Host "  OK: $p" -ForegroundColor Green
                }
            }
            Remove-Item $extTemp -Recurse -Force

            if (-not (Test-Path $dataDir)) {
                New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
            }
            if ($remoteSha) {
                Set-Content -Path $shaFile -Value $remoteSha -NoNewline
            }
            Write-Host "[update] Update complete." -ForegroundColor Green
        } catch {
            Write-Host "[ERROR] Download failed: $_" -ForegroundColor Red
            Write-Host "  Download manually: https://github.com/Barcode-User/taqeem-tool" -ForegroundColor Yellow
            if (-not (Test-Path $serverFile)) {
                Read-Host "Press Enter to exit"
                exit 1
            }
        }
    } else {
        $short = $localSha.Substring(0, [Math]::Min(7, $localSha.Length))
        Write-Host "[update] Already up to date ($short)" -ForegroundColor Green
    }
    Write-Host ""
}

# --- Create data\config.json if missing ---
$cfgFile = Join-Path $dataDir "config.json"
if (-not (Test-Path $dataDir)) {
    New-Item -ItemType Directory -Path $dataDir -Force | Out-Null
}
if (-not (Test-Path $cfgFile)) {
    $defaultCfg = '{"qrApiUrl":"http://localhost:5000"}'
    [System.IO.File]::WriteAllText($cfgFile, $defaultCfg, [System.Text.UTF8Encoding]::new($false))
    Write-Host "[config] Created data\config.json (default: localhost:5000)" -ForegroundColor Cyan
    Write-Host "  Edit qrApiUrl in that file to change the QrInformationApi address." -ForegroundColor Gray
    Write-Host ""
} else {
    try {
        $cfgContent = Get-Content $cfgFile -Raw | ConvertFrom-Json
        Write-Host "[config] QrInformationApi -> $($cfgContent.qrApiUrl)" -ForegroundColor Cyan
    } catch {
        Write-Host "[config] config.json found (could not parse)" -ForegroundColor Yellow
    }
    Write-Host ""
}

# --- Read OpenAI key ---
$keyFile = Join-Path $root "openai-key.txt"
if (-not (Test-Path $keyFile)) {
    Write-Host ""
    Write-Host "[ERROR] openai-key.txt not found" -ForegroundColor Red
    Write-Host "  Create openai-key.txt next to start.bat" -ForegroundColor Yellow
    Write-Host "  Put your API key inside: sk-proj-..." -ForegroundColor Yellow
    Write-Host ""
    Read-Host "Press Enter to exit"
    exit 1
}
$openaiKey = (Get-Content $keyFile -Raw).Trim()

# --- Set environment variables ---
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

# --- Stop old server on port 8080 ---
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

# --- Install node_modules ---
$nmPath = Join-Path $root "node_modules"
if (-not (Test-Path $nmPath)) {
    Write-Host "[install] Installing node_modules..." -ForegroundColor Yellow
    $pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
    if ($pnpm) { & pnpm install } else { & npm install }
    Write-Host ""
}

# --- Install playwright ---
$pwPath = Join-Path $root "artifacts\api-server\node_modules\playwright"
if (-not (Test-Path $pwPath)) {
    Write-Host "[playwright] Installing playwright..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "artifacts\api-server")
    & npm install playwright --no-save --legacy-peer-deps
    Pop-Location
    Write-Host ""
}

# --- Install Chromium ---
$msPlaywright = Join-Path $env:LOCALAPPDATA "ms-playwright"
if (-not (Test-Path $msPlaywright)) {
    Write-Host "[playwright] Installing Chromium browser..." -ForegroundColor Yellow
    Push-Location (Join-Path $root "artifacts\api-server")
    & npx playwright install chromium 2>$null
    Pop-Location
    Write-Host ""
}

# --- Verify files ---
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

# --- Start server ---
Write-Host ""
Write-Host "=========================================" -ForegroundColor Green
Write-Host "  Server running at: http://localhost:8080" -ForegroundColor Green
Write-Host "  Open browser at the address above" -ForegroundColor Green
Write-Host "  Press Ctrl+C to stop" -ForegroundColor Green
Write-Host "=========================================" -ForegroundColor Green
Write-Host ""

$indexMjs = Join-Path $root "artifacts\api-server\dist\index.mjs"
& node --enable-source-maps $indexMjs
