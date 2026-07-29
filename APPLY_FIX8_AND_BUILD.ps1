$ErrorActionPreference = "Stop"
$Source = $PSScriptRoot
Set-Location -LiteralPath $Source

$StatusBadge = Join-Path $Source "src\renderer\src\components\StatusBadge.tsx"
$BuildScript = Join-Path $Source "BUILD_INSTALLER_CHINH_THUC.ps1"

if (-not (Test-Path -LiteralPath $StatusBadge -PathType Leaf)) {
    throw "Missing StatusBadge.tsx: $StatusBadge"
}
if (-not (Test-Path -LiteralPath $BuildScript -PathType Leaf)) {
    throw "Missing official build script: $BuildScript"
}

Write-Host "Running ESLint after FIX8..." -ForegroundColor Cyan
npm.cmd run lint
if ($LASTEXITCODE -ne 0) {
    throw "ESLint still failed. Stop and send the newest error."
}

Write-Host "ESLint passed. Starting official build..." -ForegroundColor Green
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildScript
if ($LASTEXITCODE -ne 0) {
    throw "Official build failed. Stop and send the last error section."
}

Write-Host "FIX8 build completed successfully." -ForegroundColor Green
