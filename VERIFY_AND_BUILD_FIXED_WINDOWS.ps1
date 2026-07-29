[CmdletBinding()]
param(
  [switch]$SkipInstall,
  [switch]$SkipTools,
  [switch]$SkipE2E,
  [switch]$BuildInstaller
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'

function Write-Section {
  param([Parameter(Mandatory = $true)][string]$Title)
  Write-Host ''
  Write-Host ('=' * 78) -ForegroundColor Cyan
  Write-Host ('  ' + $Title) -ForegroundColor Cyan
  Write-Host ('=' * 78) -ForegroundColor Cyan
}

function Invoke-NativeStep {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][string]$Executable,
    [string[]]$Arguments = @()
  )

  $logPath = Join-Path $script:LogDirectory ($Name + '.log')
  Write-Host ''
  Write-Host ('>>> ' + $Name) -ForegroundColor Yellow
  Write-Host ('    ' + $Executable + ' ' + ($Arguments -join ' ')) -ForegroundColor DarkGray

  $oldPreference = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    & $Executable @Arguments 2>&1 |
      ForEach-Object {
        $line = [string]$_
        Write-Host $line
        Add-Content -LiteralPath $logPath -Value $line -Encoding UTF8
      }
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $oldPreference
  }

  if ($null -eq $exitCode) { $exitCode = 0 }
  if ([int]$exitCode -ne 0) {
    throw ($Name + ' failed with exit code ' + $exitCode + '. Log: ' + $logPath)
  }

  Write-Host ('PASS: ' + $Name) -ForegroundColor Green
}

$project = $PSScriptRoot
Set-Location -LiteralPath $project

$timestamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$logRoot = Join-Path $env:LOCALAPPDATA 'Tubmedia\VerificationLogs'
$script:LogDirectory = Join-Path $logRoot $timestamp
New-Item -ItemType Directory -Path $script:LogDirectory -Force | Out-Null

Write-Section 'TUBMEDIA NEXT FIXED - VERIFY AND BUILD'
Write-Host ('Project : ' + $project)
Write-Host ('Logs    : ' + $script:LogDirectory)
Write-Host ('Node.js : ' + (& node.exe --version))
Write-Host ('npm     : ' + (& npm.cmd --version))

$nodeMajor = [int]((& node.exe -p "process.versions.node.split('.')[0]").Trim())
if ($nodeMajor -ne 24) {
  throw ('Yêu cầu Node.js 24 LTS. Phiên bản hiện tại: ' + (& node.exe --version))
}

Write-Section '1. WINDOWS DOCTOR'
Invoke-NativeStep -Name 'doctor_windows' -Executable 'npm.cmd' -Arguments @('run', 'doctor:windows')

if (-not $SkipInstall) {
  Write-Section '2. INSTALL EXACT DEPENDENCIES'
  Invoke-NativeStep -Name 'npm_ci' -Executable 'npm.cmd' -Arguments @('ci', '--no-audit', '--no-fund')
  Invoke-NativeStep -Name 'prepare_electron' -Executable 'npm.cmd' -Arguments @('run', 'prepare:electron')
}

if (-not $SkipTools) {
  Write-Section '3. REQUIRED MEDIA TOOLS'
  Invoke-NativeStep -Name 'tools_repair' -Executable 'npm.cmd' -Arguments @('run', 'tools:repair:windows')
  Invoke-NativeStep -Name 'tools_check' -Executable 'npm.cmd' -Arguments @('run', 'tools:check:windows')
}

Write-Section '4. RELEASE AND AUDIT GATES'
Invoke-NativeStep -Name 'assets' -Executable 'npm.cmd' -Arguments @('run', 'check:assets')
Invoke-NativeStep -Name 'verify_release' -Executable 'npm.cmd' -Arguments @('run', 'verify:release')
Invoke-NativeStep -Name 'verify_stable' -Executable 'npm.cmd' -Arguments @('run', 'verify:stable')
Invoke-NativeStep -Name 'verify_audit_hardening' -Executable 'npm.cmd' -Arguments @('run', 'verify:audit-hardening')
Invoke-NativeStep -Name 'verify_audit_behavior' -Executable 'npm.cmd' -Arguments @('run', 'verify:audit-behavior')
Invoke-NativeStep -Name 'verify_gate_fixes' -Executable 'npm.cmd' -Arguments @('run', 'verify:gate-fixes')
Invoke-NativeStep -Name 'verify_recovery_upgrade' -Executable 'npm.cmd' -Arguments @('run', 'verify:recovery-upgrade')
Invoke-NativeStep -Name 'verify_notification_cookie_upgrade' -Executable 'npm.cmd' -Arguments @('run', 'verify:notification-cookie-upgrade')
Invoke-NativeStep -Name 'verify_runtime_recovery_upgrade' -Executable 'npm.cmd' -Arguments @('run', 'verify:runtime-recovery-upgrade')

Write-Section '5. SOURCE QUALITY'
Invoke-NativeStep -Name 'typecheck' -Executable 'npm.cmd' -Arguments @('run', 'typecheck')
Invoke-NativeStep -Name 'lint' -Executable 'npm.cmd' -Arguments @('run', 'lint')
Invoke-NativeStep -Name 'unit_test' -Executable 'npm.cmd' -Arguments @('run', 'test')
Invoke-NativeStep -Name 'integration_test' -Executable 'npm.cmd' -Arguments @('run', 'test:integration')

Write-Section '6. BUILD'
Invoke-NativeStep -Name 'build' -Executable 'npm.cmd' -Arguments @('run', 'build')

foreach ($relative in @('out\main\index.js', 'out\renderer\index.html')) {
  $full = Join-Path $project $relative
  if (-not (Test-Path -LiteralPath $full -PathType Leaf)) {
    throw ('Build thiếu file bắt buộc: ' + $full)
  }
  Write-Host ('PASS artifact: ' + $relative) -ForegroundColor Green
}

$preloadArtifact = @(
  'out\preload\index.cjs',
  'out\preload\index.js',
  'out\preload\index.mjs'
) |
  ForEach-Object { Join-Path $project $_ } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1

if (-not $preloadArtifact) {
  throw 'Build thiếu preload artifact index.cjs/index.js/index.mjs.'
}

Write-Host ('PASS artifact: ' + $preloadArtifact.Substring($project.Length + 1)) -ForegroundColor Green

if (-not $SkipE2E) {
  Write-Section '7. ELECTRON E2E'
  Invoke-NativeStep -Name 'e2e' -Executable 'npm.cmd' -Arguments @('run', 'test:e2e')
}

if ($BuildInstaller) {
  Write-Section '8. WINDOWS INSTALLER'
  Invoke-NativeStep -Name 'dist_official' -Executable 'npm.cmd' -Arguments @('run', 'dist:official')

  $installer = Join-Path $project 'release\Download video Tubmedia-Setup-1.2.0-x64.exe'
  if (-not (Test-Path -LiteralPath $installer -PathType Leaf)) {
    throw ('Không tìm thấy installer dự kiến: ' + $installer)
  }

  $hash = Get-FileHash -LiteralPath $installer -Algorithm SHA256
  $hashFile = $installer + '.sha256'
  ($hash.Hash + '  ' + [IO.Path]::GetFileName($installer)) |
    Set-Content -LiteralPath $hashFile -Encoding ASCII

  Write-Host ('Installer : ' + $installer) -ForegroundColor Green
  Write-Host ('SHA-256   : ' + $hash.Hash) -ForegroundColor Green
  Write-Host ('Hash file : ' + $hashFile) -ForegroundColor Green
}

Write-Section 'HOÀN TẤT'
Write-Host ('Logs: ' + $script:LogDirectory) -ForegroundColor Green
