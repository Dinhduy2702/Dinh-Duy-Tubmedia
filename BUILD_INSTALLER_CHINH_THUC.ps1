$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$ProjectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location -LiteralPath $ProjectRoot

function Run-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Title,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )
  Write-Host ""
  Write-Host ("==> " + $Title) -ForegroundColor Cyan
  & $Command
  if ($LASTEXITCODE -ne 0) {
    throw ($Title + " failed with exit code " + $LASTEXITCODE)
  }
}

$Package = Get-Content -LiteralPath (Join-Path $ProjectRoot "package.json") -Raw | ConvertFrom-Json
if ([string]$Package.version -ne "1.2.8") {
  throw ("Official installer requires package version 1.2.8, found " + [string]$Package.version)
}

Write-Host "============================================================" -ForegroundColor Red
Write-Host "  DOWNLOAD VIDEO TUBMEDIA 1.2.8 - OFFICIAL BUILD" -ForegroundColor Red
Write-Host "============================================================" -ForegroundColor Red

Run-Step "Install exact project dependencies" {
  & npm.cmd install
}
Run-Step "Verify release architecture" {
  & npm.cmd run verify:release
}
Run-Step "Verify stable 1.2.8 identity" {
  & npm.cmd run verify:stable
}
Run-Step "Verify recovery, cookie and runtime behavior" {
  & npm.cmd run verify:recovery-upgrade
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npm.cmd run verify:notification-cookie-upgrade
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npm.cmd run verify:runtime-recovery-upgrade
}
Run-Step "TypeScript typecheck" {
  & npm.cmd run typecheck
}
Run-Step "ESLint" {
  & npm.cmd run lint
}
Run-Step "Unit tests" {
  & npm.cmd run test
}
Run-Step "Integration tests" {
  & npm.cmd run test:integration
}
Run-Step "Build official Windows installer" {
  & npm.cmd run dist:nsis-safe
}

$Installer = Join-Path $ProjectRoot "release\Download video Tubmedia-Setup-1.2.8-x64.exe"
$LatestYml = Join-Path $ProjectRoot "release\latest.yml"
if (-not (Test-Path -LiteralPath $Installer)) {
  throw ("Official installer was not created: " + $Installer)
}
if (-not (Test-Path -LiteralPath $LatestYml)) {
  throw ("Updater metadata was not created: " + $LatestYml)
}

$Hash = Get-FileHash -LiteralPath $Installer -Algorithm SHA256
$HashFile = Join-Path $ProjectRoot "release\Download-video-Tubmedia-1.2.8-SHA256.txt"
$HashContent = @(
  "TUBMEDIA 1.2.8",
  "File: " + (Split-Path -Leaf $Installer),
  "SHA-256: " + $Hash.Hash
) -join [Environment]::NewLine
[System.IO.File]::WriteAllText($HashFile, $HashContent, (New-Object System.Text.UTF8Encoding($false)))
Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  OFFICIAL INSTALLER READY" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ("Installer: " + $Installer)
Write-Host ("Size     : " + [math]::Round((Get-Item -LiteralPath $Installer).Length / 1MB, 2) + " MB")
Write-Host ("SHA-256  : " + $Hash.Hash)
Write-Host ("Hash file : " + $HashFile)
Write-Host ("Update yml: " + $LatestYml)
Write-Host ""
Write-Host "Upload the EXE, SHA256 file and latest.yml to the same GitHub Release." -ForegroundColor Yellow
