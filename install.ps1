Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$repoUrl    = "https://github.com/Barcode-User/taqeem-tool.git"
$installDir = "D:\Devolper\New\taqeem-tool"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   أداة تقارير التقييم — إعداد تلقائي" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ─── 1. تحميل/تحديث الكود من GitHub ─────────────────────────────
if (Test-Path "$installDir\.git") {
    Write-Host "[1/3] تحديث الكود من GitHub (إعادة ضبط كاملة)..." -ForegroundColor Yellow
    Set-Location $installDir

    # حذف node_modules القديمة لتجنب تعارض الحزم
    if (Test-Path "$installDir\node_modules") {
        Write-Host "      حذف node_modules القديمة..." -ForegroundColor Gray
        Remove-Item -Recurse -Force "$installDir\node_modules" -ErrorAction SilentlyContinue
    }

    git fetch origin 2>$null
    git reset --hard origin/main 2>$null
} else {
    Write-Host "[1/3] تحميل المشروع من GitHub..." -ForegroundColor Yellow
    if (Test-Path $installDir) {
        Remove-Item -Recurse -Force $installDir -ErrorAction SilentlyContinue
    }
    git clone $repoUrl $installDir
    Set-Location $installDir
}
Write-Host "     تم تحديث الكود بنجاح." -ForegroundColor Green
Write-Host ""

# ─── 2. إعداد مفتاح الذكاء الاصطناعي ────────────────────────────
$groqKeyFile   = Join-Path $installDir "groq-key.txt"
$geminiKeyFile = Join-Path $installDir "gemini-key.txt"
$openaiKeyFile = Join-Path $installDir "openai-key.txt"

$hasKey = (Test-Path $groqKeyFile) -or (Test-Path $geminiKeyFile) -or (Test-Path $openaiKeyFile)

if (-not $hasKey) {
    Write-Host "[2/3] إعداد مفتاح الذكاء الاصطناعي..." -ForegroundColor Yellow
    Write-Host ""
    Write-Host "  اختر مزود الذكاء الاصطناعي:" -ForegroundColor White
    Write-Host "  1) Groq (مجاني تماماً — موصى به)" -ForegroundColor Green
    Write-Host "     https://console.groq.com/keys" -ForegroundColor Cyan
    Write-Host "  2) OpenAI GPT-4o-mini (مدفوع)" -ForegroundColor White
    Write-Host "     https://platform.openai.com/api-keys" -ForegroundColor Cyan
    Write-Host ""

    $choice = Read-Host "  اختيارك (1 أو 2)"

    if ($choice -eq "2") {
        $key = Read-Host "  الصق مفتاح OpenAI هنا (يبدأ بـ sk-)"
        if ($key -match "^sk-") {
            $key | Out-File -FilePath $openaiKeyFile -Encoding ascii -NoNewline
            Write-Host "     تم حفظ المفتاح في openai-key.txt" -ForegroundColor Green
        } else {
            Write-Host "     [تحذير] المفتاح لا يبدو صحيحاً" -ForegroundColor Red
        }
    } else {
        $key = Read-Host "  الصق مفتاح Groq هنا (يبدأ بـ gsk_)"
        if ($key -match "^gsk_") {
            $key | Out-File -FilePath $groqKeyFile -Encoding ascii -NoNewline
            Write-Host "     تم حفظ المفتاح في groq-key.txt" -ForegroundColor Green
        } else {
            Write-Host "     [تحذير] المفتاح لا يبدو صحيحاً" -ForegroundColor Red
        }
    }
} else {
    Write-Host "[2/3] مفتاح AI موجود بالفعل." -ForegroundColor Green
}
Write-Host ""

# ─── 3. تثبيت المكتبات ───────────────────────────────────────────
Write-Host "[3/3] تثبيت المكتبات..." -ForegroundColor Yellow
pnpm install --no-frozen-lockfile
if ($LASTEXITCODE -ne 0) {
    Write-Host "     [خطأ] فشل تثبيت المكتبات." -ForegroundColor Red
    pause
    exit 1
}
Write-Host "     تم بنجاح." -ForegroundColor Green
Write-Host ""

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   الإعداد اكتمل! لتشغيل الأداة:" -ForegroundColor Green
Write-Host "   انقر نقراً مزدوجاً على: start.bat" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
pause
