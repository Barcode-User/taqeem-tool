Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force

$repoUrl    = "https://github.com/Barcode-User/taqeem-tool.git"
$installDir = "D:\Devolper\New\taqeem-tool"

Write-Host ""
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   أداة تقارير التقييم — إعداد تلقائي" -ForegroundColor Cyan
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""

# ─── 1. تحديث الكود من GitHub ────────────────────────────────────
if (Test-Path "$installDir\.git") {
    Write-Host "[1/3] تحديث الكود من GitHub..." -ForegroundColor Yellow
    Set-Location $installDir
    git pull origin main
} else {
    Write-Host "[1/3] تحميل المشروع من GitHub..." -ForegroundColor Yellow
    git clone $repoUrl $installDir
    Set-Location $installDir
}
Write-Host "     تم بنجاح." -ForegroundColor Green
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
    Write-Host "  1) OpenAI GPT-4o-mini (مدفوع — الأفضل جودةً)" -ForegroundColor Green
    Write-Host "     https://platform.openai.com/api-keys" -ForegroundColor Cyan
    Write-Host "  2) Groq (مجاني تماماً)" -ForegroundColor White
    Write-Host "     https://console.groq.com/keys" -ForegroundColor Cyan
    Write-Host ""

    $choice = Read-Host "  اختيارك (1 أو 2)"

    if ($choice -eq "1") {
        $key = Read-Host "  الصق مفتاح OpenAI هنا (يبدأ بـ sk-)"
        if ($key -match "^sk-") {
            $key | Out-File -FilePath $openaiKeyFile -Encoding ascii -NoNewline
            Write-Host "     تم حفظ المفتاح في openai-key.txt" -ForegroundColor Green
        } else {
            Write-Host "     [تحذير] المفتاح لا يبدو صحيحاً — تم تخطي هذه الخطوة" -ForegroundColor Red
            Write-Host "     يمكنك إنشاء openai-key.txt يدوياً لاحقاً" -ForegroundColor Gray
        }
    } elseif ($choice -eq "2") {
        $key = Read-Host "  الصق مفتاح Groq هنا (يبدأ بـ gsk_)"
        if ($key -match "^gsk_") {
            $key | Out-File -FilePath $groqKeyFile -Encoding ascii -NoNewline
            Write-Host "     تم حفظ المفتاح في groq-key.txt" -ForegroundColor Green
        } else {
            Write-Host "     [تحذير] المفتاح لا يبدو صحيحاً — تم تخطي هذه الخطوة" -ForegroundColor Red
            Write-Host "     يمكنك إنشاء groq-key.txt يدوياً لاحقاً" -ForegroundColor Gray
        }
    } else {
        Write-Host "     تم تخطي هذه الخطوة — أنشئ openai-key.txt أو groq-key.txt يدوياً" -ForegroundColor Gray
    }
} else {
    Write-Host "[2/3] مفتاح AI موجود بالفعل." -ForegroundColor Green
}
Write-Host ""

# ─── 3. تثبيت المكتبات ───────────────────────────────────────────
Write-Host "[3/3] تثبيت المكتبات (pnpm install)..." -ForegroundColor Yellow
pnpm install --frozen-lockfile
Write-Host "     تم بنجاح." -ForegroundColor Green
Write-Host ""

Write-Host "=========================================" -ForegroundColor Cyan
Write-Host "   الإعداد اكتمل! لتشغيل الأداة:" -ForegroundColor Green
Write-Host "   انقر نقراً مزدوجاً على: start.bat" -ForegroundColor White
Write-Host "=========================================" -ForegroundColor Cyan
Write-Host ""
pause
