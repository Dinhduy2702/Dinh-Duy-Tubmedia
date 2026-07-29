$ErrorActionPreference = "Stop"
$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $Root

Write-Host "============================================================"
Write-Host "  TUBMEDIA 1.2.0 FIX11 - RETRY, DRIVE ROOT, PATH MEMORY"
Write-Host "============================================================"
Write-Host ""

$Required = @(
  ".\src\main\files\ensure-directory.ts",
  ".\src\renderer\src\utils\workbench-path-memory.ts",
  ".\tests\unit\fix11-path-and-retry.test.ts",
  ".\BUILD_INSTALLER_CHINH_THUC.ps1"
)
foreach ($File in $Required) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
    throw "FIX11 required file is missing: $File"
  }
}

$Diagnostic = [System.IO.File]::ReadAllText((Join-Path $Root "src\shared\utils\diagnostic-policy.ts"))
$PathService = [System.IO.File]::ReadAllText((Join-Path $Root "src\main\storage\path-service.ts"))
$DownloadPage = [System.IO.File]::ReadAllText((Join-Path $Root "src\renderer\src\pages\DownloadWorkbenchPage.tsx"))
$MergePage = [System.IO.File]::ReadAllText((Join-Path $Root "src\renderer\src\pages\DownloadMergePage.tsx"))
$FolderField = [System.IO.File]::ReadAllText((Join-Path $Root "src\renderer\src\components\FolderField.tsx"))

if (-not $Diagnostic.Contains("JOB_RETRY_SCHEDULED")) { throw "FIX11 retry policy marker is missing." }
if (-not $PathService.Contains("ensureDirectory(path)")) { throw "FIX11 drive-root marker is missing." }
if (-not $DownloadPage.Contains("loadWorkbenchPath('download-output')")) { throw "FIX11 download path memory marker is missing." }
if (-not $MergePage.Contains("loadWorkbenchPath('merge-output')")) { throw "FIX11 merge path memory marker is missing." }
if (-not $FolderField.Contains("chooseFolder(value.trim() || undefined)")) { throw "FIX11 picker default-path marker is missing." }

Write-Host "FIX11 source markers verified." -ForegroundColor Green
Write-Host "Starting official build..." -ForegroundColor Cyan
Write-Host ""

& powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $Root "BUILD_INSTALLER_CHINH_THUC.ps1")
if ($LASTEXITCODE -ne 0) {
  throw "Official build failed with exit code $LASTEXITCODE. Stop and send the final error section."
}

Write-Host ""
Write-Host "FIX11 BUILD COMPLETED SUCCESSFULLY" -ForegroundColor Green
