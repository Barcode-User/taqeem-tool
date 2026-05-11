# update.ps1 - تحديث الملفات من GitHub بدون git
$ErrorActionPreference = "Stop"
$repoZip = "https://github.com/Barcode-User/taqeem-tool/archive/refs/heads/main.zip"
$zipTemp  = "$env:TEMP\taqeem-update.zip"
$extTemp  = "$env:TEMP\taqeem-extract"
$root     = Split-Path -Parent $MyInvocation.MyCommand.Path

Write-Host ""
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host "   تحديث أداة تقييم — من GitHub" -ForegroundColor Cyan
Write-Host "=======================================" -ForegroundColor Cyan
Write-Host ""

Write-Host "[1/4] تحميل آخر نسخة من GitHub..." -ForegroundColor Yellow
try {
    [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
    Invoke-WebRequest -Uri $repoZip -OutFile $zipTemp -UseBasicParsing
} catch {
    Write-Host "فشل التحميل: $_" -ForegroundColor Red
    exit 1
}

Write-Host "[2/4] فك الضغط..." -ForegroundColor Yellow
if (Test-Path $extTemp) { Remove-Item $extTemp -Recurse -Force }
Expand-Archive -Path $zipTemp -DestinationPath $extTemp -Force
Remove-Item $zipTemp -Force

$src = Join-Path $extTemp "taqeem-tool-main"

Write-Host "[3/4] نسخ الملفات..." -ForegroundColor Yellow

# الملفات التي تحتاج تحديث
$paths = @(
    "start.bat",
    "artifacts\api-server\dist",
    "artifacts\taqeem-tool\dist"
)

foreach ($p in $paths) {
    $from = Join-Path $src $p
    $to   = Join-Path $root $p
    if (Test-Path $from) {
        $parentDir = Split-Path $to
        if (-not (Test-Path $parentDir)) {
            New-Item -ItemType Directory -Path $parentDir -Force | Out-Null
        }
        if ((Get-Item $from).PSIsContainer) {
            Copy-Item -Path $from -Destination $to -Recurse -Force
        } else {
            Copy-Item -Path $from -Destination $to -Force
        }
        Write-Host "  OK: $p" -ForegroundColor Green
    } else {
        Write-Host "  -- $p (not found in zip)" -ForegroundColor Gray
    }
}

Write-Host "[4/4] تنظيف الملفات المؤقتة..." -ForegroundColor Yellow
Remove-Item $extTemp -Recurse -Force

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host "   تم التحديث بنجاح!" -ForegroundColor Green
Write-Host "   شغّل start.bat الآن" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green
Write-Host ""
