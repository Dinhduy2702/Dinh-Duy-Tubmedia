$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Source = $PSScriptRoot
Set-Location -LiteralPath $Source

Write-Host "============================================================" -ForegroundColor Cyan
Write-Host "  TUBMEDIA 1.2.0 FIX10A - VERIFY AND BUILD" -ForegroundColor Cyan
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
        throw "FIX10A incomplete. Missing file: $File"
    }
}

$MergePath = Join-Path $Source "src\main\merge\merge-engine.ts"
$PagePath = Join-Path $Source "src\renderer\src\pages\DownloadMergePage.tsx"
$MergeSource = [System.IO.File]::ReadAllText($MergePath)
$PageSource = [System.IO.File]::ReadAllText($PagePath)

$MergeMarkers = @(
    "timestampRepairAttempted",
    "timestamp-repair-concat",
    "shouldRepairTimestamp"
)

foreach ($Marker in $MergeMarkers) {
    if (-not $MergeSource.Contains($Marker)) {
        throw "FIX10A merge marker not found: $Marker"
    }
}

$PageMarkers = @(
    "merge-error-detail",
    "mergeErrorTechnical",
    "JOB_FAILED"
)

foreach ($Marker in $PageMarkers) {
    if (-not $PageSource.Contains($Marker)) {
        throw "FIX10A UI marker not found: $Marker"
    }
}

Write-Host "FIX10 source markers verified." -ForegroundColor Green
Write-Host "Running TypeScript typecheck..." -ForegroundColor Cyan
& npm.cmd run typecheck
if ($LASTEXITCODE -ne 0) {
    throw "TypeScript typecheck failed with exit code $LASTEXITCODE."
}

Write-Host "Running ESLint..." -ForegroundColor Cyan
& npm.cmd run lint
if ($LASTEXITCODE -ne 0) {
    throw "ESLint failed with exit code $LASTEXITCODE."
}

Write-Host "Starting official build..." -ForegroundColor Cyan
Write-Host ""

$BuildScript = Join-Path $Source "BUILD_INSTALLER_CHINH_THUC.ps1"
& powershell.exe -NoProfile -ExecutionPolicy Bypass -File $BuildScript

if ($LASTEXITCODE -ne 0) {
    throw "Official build failed with exit code $LASTEXITCODE. Stop and send the last error section."
}

Write-Host ""
Write-Host "FIX10A BUILD COMPLETED SUCCESSFULLY" -ForegroundColor Green
