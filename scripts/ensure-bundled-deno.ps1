[CmdletBinding()]
param()

# 1.8.0 viec A: kem san bo chay JavaScript Deno cho yt-dlp (YouTube can JS runtime de tra du dinh dang).
# Lam theo dung mau ensure-bundled-aria2.ps1: ban chinh thuc, ghim phien ban + SHA-256 cua tep zip, kiem SHA truoc khi giai nen,
# chep vao <du an>\tool\deno.exe (electron-builder dua thu muc tool vao resources\tool). Tep nhi phan khong commit vao git.

$ErrorActionPreference = "Stop"
Set-StrictMode -Version Latest

function Get-FileHashPortable {
  param(
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [ValidateSet("SHA256")][string]$Algorithm = "SHA256"
  )

  $stream = [System.IO.File]::OpenRead($LiteralPath)
  try {
    $sha256 = [System.Security.Cryptography.SHA256]::Create()
    try {
      $hex = ([System.BitConverter]::ToString($sha256.ComputeHash($stream))).Replace("-", "")
      return [PSCustomObject]@{
        Algorithm = $Algorithm
        Hash = $hex
        Path = $LiteralPath
      }
    }
    finally {
      $sha256.Dispose()
    }
  }
  finally {
    $stream.Dispose()
  }
}

function Expand-ZipPortable {
  param(
    [Parameter(Mandatory = $true)][string]$LiteralPath,
    [Parameter(Mandatory = $true)][string]$DestinationPath
  )

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $fullZip = [System.IO.Path]::GetFullPath($LiteralPath)
  $fullDest = [System.IO.Path]::GetFullPath($DestinationPath)
  if (-not (Test-Path -LiteralPath $fullZip -PathType Leaf)) {
    throw "Zip archive not found: $fullZip"
  }
  if (Test-Path -LiteralPath $fullDest) {
    Remove-Item -LiteralPath $fullDest -Recurse -Force
  }
  [System.IO.Compression.ZipFile]::ExtractToDirectory($fullZip, $fullDest)
}

$Project = Split-Path -Parent $PSScriptRoot
$ToolDir = Join-Path $Project "tool"
$Dest = Join-Path $ToolDir "deno.exe"

$Version = "2.9.8"
$ZipName = "deno-x86_64-pc-windows-msvc.zip"
$Url = "https://github.com/denoland/deno/releases/download/v$Version/$ZipName"

# SHA-256 of the official Deno 2.9.8 Windows x64 release archive (GitHub release asset digest, 2026-10-21).
$ExpectedZipSha256 = "CBA84B26E0DF5AE7F74FC66B86A95B866872A86292EBD84FA1E959927EDD93BF"

$CacheRoot = Join-Path $env:LOCALAPPDATA "Tubmedia\ToolCache\deno\$Version"
$CachedExe = Join-Path $CacheRoot "deno.exe"

function Test-Deno([string]$File) {
  if (-not (Test-Path -LiteralPath $File -PathType Leaf)) {
    return $false
  }

  try {
    $output = @(& $File --version 2>&1)
    if ($LASTEXITCODE -ne 0) {
      return $false
    }

    $joined = $output -join "`n"
    return $joined -match ("deno\s+" + [regex]::Escape($Version) + "\b")
  } catch {
    return $false
  }
}

function Copy-VerifiedDeno([string]$Source,[string]$Reason) {
  if (-not (Test-Deno $Source)) {
    return $false
  }

  New-Item -ItemType Directory -Path $ToolDir -Force | Out-Null
  Copy-Item -LiteralPath $Source -Destination $Dest -Force

  if (-not (Test-Deno $Dest)) {
    Remove-Item -LiteralPath $Dest -Force -ErrorAction SilentlyContinue
    Write-Warning "deno copy verification failed: $Reason; trying next source."
    return $false
  }

  Write-Host "DENO_BUNDLED_OK source=$Reason"
  return $true
}

if (Test-Deno $Dest) {
  Write-Host "DENO_BUNDLED_OK source=existing-project-tool"
  exit 0
}

if (Copy-VerifiedDeno -Source $CachedExe -Reason "Tubmedia ToolCache") {
  exit 0
}

$temp = Join-Path $env:TEMP ("Tubmedia-deno-" + [guid]::NewGuid().ToString("N"))
$zip = Join-Path $temp $ZipName
$extract = Join-Path $temp "extract"

try {
  New-Item -ItemType Directory -Path $temp -Force | Out-Null

  Write-Host "Downloading official Deno $Version Windows x64..."
  Invoke-WebRequest `
    -Uri $Url `
    -OutFile $zip `
    -UseBasicParsing `
    -Headers @{ "User-Agent" = "Tubmedia-Build/1.8.0" }

  $zipSha = (Get-FileHashPortable -LiteralPath $zip -Algorithm SHA256).Hash.ToUpperInvariant()

  if ($zipSha -ne $ExpectedZipSha256) {
    throw "Deno archive SHA-256 mismatch. Expected=$ExpectedZipSha256 Actual=$zipSha"
  }

  Expand-ZipPortable -LiteralPath $zip -DestinationPath $extract

  $deno = Get-ChildItem `
    -LiteralPath $extract `
    -Filter "deno.exe" `
    -File `
    -Recurse |
    Select-Object -First 1

  if (-not $deno) {
    throw "deno.exe not found inside official archive"
  }

  if (-not (Test-Deno $deno.FullName)) {
    throw "Downloaded deno.exe failed version/launch verification"
  }

  New-Item -ItemType Directory -Path $CacheRoot -Force | Out-Null
  Copy-Item -LiteralPath $deno.FullName -Destination $CachedExe -Force

  if (-not (Copy-VerifiedDeno -Source $CachedExe -Reason "official-github-release")) {
    throw "Unable to bundle downloaded deno.exe"
  }
} finally {
  Remove-Item -LiteralPath $temp -Recurse -Force -ErrorAction SilentlyContinue
}

$exeSha = (Get-FileHashPortable -LiteralPath $Dest -Algorithm SHA256).Hash
Write-Host "DENO_EXE_SHA256=$exeSha"
Write-Host "DENO_BUNDLE_COMPLETE"
