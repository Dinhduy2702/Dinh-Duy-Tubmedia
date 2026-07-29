$ErrorActionPreference = 'Stop'

$Root = $PSScriptRoot
Set-Location -LiteralPath $Root

$PackageJson = Join-Path $Root 'package.json'
$StatusBadge = Join-Path $Root 'src\renderer\src\components\StatusBadge.tsx'
$BuildScript = Join-Path $Root 'BUILD_INSTALLER_CHINH_THUC.ps1'

foreach ($Required in @($PackageJson, $StatusBadge, $BuildScript)) {
    if (-not (Test-Path -LiteralPath $Required -PathType Leaf)) {
        throw "Missing required file: $Required"
    }
}

Write-Host '============================================================' -ForegroundColor Cyan
Write-Host '  TUBMEDIA 1.2.0 FIX9 - VERIFY AND BUILD' -ForegroundColor Cyan
Write-Host '============================================================' -ForegroundColor Cyan
Write-Host ''
Write-Host 'Running TypeScript typecheck...' -ForegroundColor Cyan

& npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) {
    throw "TypeScript typecheck failed with exit code $LASTEXITCODE"
}

Write-Host ''
Write-Host 'TypeScript passed. Running ESLint...' -ForegroundColor Green
& npm.cmd run lint
if ($LASTEXITCODE -ne 0) {
    throw "ESLint failed with exit code $LASTEXITCODE"
}

Write-Host ''
Write-Host 'TypeScript and ESLint passed. Starting official build...' -ForegroundColor Green
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildScript
if ($LASTEXITCODE -ne 0) {
    throw "Official build failed with exit code $LASTEXITCODE"
}

Write-Host ''
Write-Host 'FIX9 OFFICIAL BUILD COMPLETED SUCCESSFULLY' -ForegroundColor Green
exit 0
