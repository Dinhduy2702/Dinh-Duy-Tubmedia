$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  TUBMEDIA 1.2.0 FIX6 - VERIFY AND BUILD" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan

$Required = @(
    ".\src\renderer\src\components\DiagnosticDock.tsx",
    ".\src\shared\utils\diagnostic-policy.ts",
    ".\FIX6_DIAGNOSTICS_UI_MERGE_v1.2.0_VI.md"
)
foreach ($Path in $Required) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "Patch FIX6 chưa được chép đầy đủ. Thiếu: $Path"
    }
}

Write-Host "`nĐã nhận đủ mã FIX6. Đang chạy build chính thức..." -ForegroundColor Green
powershell.exe -NoProfile -ExecutionPolicy Bypass -File ".\BUILD_INSTALLER_CHINH_THUC.ps1"

if ($LASTEXITCODE -ne 0) {
    throw "Build FIX6 thất bại với exit code $LASTEXITCODE. Hãy gửi toàn bộ phần lỗi cuối."
}
