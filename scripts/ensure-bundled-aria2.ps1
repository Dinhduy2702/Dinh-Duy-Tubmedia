[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

$Project = Split-Path -Parent $PSScriptRoot
$ToolDir = Join-Path $Project "tool"
$Dest = Join-Path $ToolDir "aria2c.exe"

$Version = "1.37.0"
$ZipName = "aria2-1.37.0-win-64bit-build1.zip"
$Url = "https://github.com/aria2/aria2/releases/download/release-1.37.0/$ZipName"

# SHA-256 of the official aria2 1.37.0 Windows x64 build archive.
$ExpectedZipSha256 = "67D015301EEF0B612191212D564C5BB0A14B5B9C4796B76454276A4D28D9B288"

$CacheRoot = Join-Path $env:LOCALAPPDATA "Tubmedia\ToolCache\aria2\1.37.0"
$CachedExe = Join-Path $CacheRoot "aria2c.exe"

function Test-Aria([string]$File) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
    return $false
  }

  try {
    $output = @(& $File --version 2>&1)
    if ($LASTEXITCODE -ne 0) {
      return $false
    }

    $joined = $output -join "`n"
    return $joined -match "aria2 version\s+1\.37\.0"
  } catch {
    return $false
  }
}

function Copy-VerifiedAria([string]$Source,[string]$Reason) {
  if (-not (Test-Aria $Source)) {
    return $false
  }

  New-Item -ItemType Directory -Path $ToolDir -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Dest -Force

  if (-not (Test-Aria $Dest)) {
    throw "aria2c copy verification failed: $Reason"
  }

  Write-Host "ARIA2_BUNDLED_OK source=$Reason"
  return $true
}

if (Test-Aria $Dest) {
  Write-Host "ARIA2_BUNDLED_OK source=existing-project-tool"
  exit 0
}

if (Copy-VerifiedAria -Source $CachedExe -Reason "Tubmedia ToolCache") {
  exit 0
}

$systemAria = Get-Command aria2c.exe -ErrorAction SilentlyContinue
if (-not $systemAria) {
  $systemAria = Get-Command aria2c -ErrorAction SilentlyContinue
}

if ($systemAria) {
  if (Copy-VerifiedAria -Source $systemAria.Source -Reason "system-path") {
    New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
    Copy-Item -LiteralPath $Dest -Destination $CachedExe -Force
    exit 0
  }
}

$temp = Join-Path $env:TEMP ("Tubmedia-aria2-" + [guid]::NewGuid().ToString("N"))
$zip = Join-Path $temp $ZipName
$extract = Join-Path $temp "extract"

try {
  New-Item -ItemType Directory -Path $temp -Force | Out-Null
  New-Item -ItemType Directory -Path $extract -Force | Out-Null

  Write-Host "Downloading official aria2 $Version Windows x64..."
  Invoke-WebRequest `
    -Uri $Url `
    -OutFile $zip `
    -UseBasicParsing `
    -Headers @{ "User-Agent" = "Tubmedia-Build/1.3.3" }

  $zipSha = (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToUpperInvariant()

  if ($zipSha -ne $ExpectedZipSha256) {
    throw "aria2 archive SHA-256 mismatch. Expected=$ExpectedZipSha256 Actual=$zipSha"
  }

  Expand-Archive -LiteralPath $zip -DestinationPath $extract -Force

  $aria = Get-ChildItem `
    -LiteralPath $extract `
    -Filter "aria2c.exe" `
    -File `
    -Recurse |
    Select-Object -First 1

  if (-not $aria) {
    throw "aria2c.exe not found inside official archive"
  }

  if (-not (Test-Aria $aria.FullName)) {
    throw "Downloaded aria2c.exe failed version/launch verification"
  }

  New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
  Copy-Item -LiteralPath $aria.FullName -Destination $CachedExe -Force

  if (-not (Copy-VerifiedAria -Source $CachedExe -Reason "official-github-release")) {
    throw "Unable to bundle downloaded aria2c.exe"
  }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

$exeSha = (Get-FileHash -LiteralPath $Dest -Algorithm SHA256).Hash
Write-Host "ARIA2_EXE_SHA256=$exeSha"
Write-Host "ARIA2_BUNDLE_COMPLETE"