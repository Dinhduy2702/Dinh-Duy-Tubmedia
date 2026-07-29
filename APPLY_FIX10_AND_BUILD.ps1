$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Source = $PSScriptRoot
Set-Location -LiteralPath $Source

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  TUBMEDIA 1.2.0 FIX10 - TIMESTAMP REPAIR AND ERROR DETAILS" -ForegroundColor Cyan
Write-Host "============================================================" -ForegroundColor Cyan
Write-Host ""

$RequiredFiles = @(
    ".\package.json",
    ".\BUILD_INSTALLER_CHINH_THUC.ps1",
    ".\src\main\merge\merge-engine.ts",
    ".\src\main\media\media-analyzer.ts",
    ".\src\main\media\file-verifier.ts",
    ".\src\renderer\src\pages\DownloadMergePage.tsx",
    ".\tests\unit\fix10-timestamp-error-detail.test.ts",
    ".\tests\unit\media-duration-sanity.test.ts"
)

foreach ($File in $RequiredFiles) {
    if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
        throw "FIX10 is incomplete. Missing file: $File"
    }
}

$MergeSource = [System.IO.File]::ReadAllText((Join-Path $Source "src\main\merge\merge-engine.ts"))
$PageSource = [System.IO.File]::ReadAllText((Join-Path $Source "src\renderer\src\pages\DownloadMergePage.tsx"))

if (-not $MergeSource.Contains("Phát hiện timestamp bất thường · đang tự sửa và ghép lại")) {
    throw "FIX10 timestamp repair code was not found."
}
if (-not $PageSource.Contains("Chi tiết lỗi của quy trình")) {
    throw "FIX10 error detail panel was not found."
}

Write-Host "FIX10 source markers verified." -ForegroundColor Green
Write-Host "Starting official build..." -ForegroundColor Cyan
Write-Host ""

$BuildScript = Join-Path $Source "BUILD_INSTALLER_CHINH_THUC.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildScript

if ($LASTEXITCODE -ne 0) {
    throw "Official build failed with exit code $LASTEXITCODE. Stop and send the last error section."
}

Write-Host ""
Write-Host "FIX10 BUILD COMPLETED SUCCESSFULLY" -ForegroundColor Green
