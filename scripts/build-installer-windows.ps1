$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

function Write-Step {
  param([Parameter(Mandatory = $true)][string]$Text)
  Write-Host ""
  Write-Host ("==> " + $Text) -ForegroundColor Cyan
}

function Run-External {
  param(
    [Parameter(Mandatory = $true)][string]$Label,
    [Parameter(Mandatory = $true)][scriptblock]$Command
  )

  Write-Step $Label
  & $Command
  $code = $LASTEXITCODE
  if ($code -ne 0) {
    throw ($Label + " failed with exit code " + $code)
  }
}

function Write-Utf8BomFile {
  param(
    [Parameter(Mandatory = $true)][string]$Path,
    [Parameter(Mandatory = $true)][string]$Content
  )

  $parent = Split-Path -Parent $Path
  if (-not (Test-Path -LiteralPath $parent)) {
    New-Item -ItemType Directory -Force -Path $parent | Out-Null
  }

  $encoding = New-Object System.Text.UTF8Encoding($true)
  [System.IO.File]::WriteAllText($Path, $Content, $encoding)
}

function Escape-NsisValue {
  param([AllowEmptyString()][string]$Value)

  if ($null -eq $Value) {
    return ""
  }

  $result = $Value.Replace('$', '$$')
  $result = $result.Replace('"', '$\"')
  return $result
}

function ConvertTo-WindowsFileVersion {
  param([Parameter(Mandatory = $true)][string]$Version)

  $match = [regex]::Match(
    $Version,
    '^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)(?:-(?<prerelease>[0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$'
  )
  if (-not $match.Success) {
    throw ("package.json version is not valid SemVer: " + $Version)
  }

  $major = [int64]$match.Groups['major'].Value
  $minor = [int64]$match.Groups['minor'].Value
  $patch = [int64]$match.Groups['patch'].Value
  $revision = [int64]0
  $prerelease = $match.Groups['prerelease'].Value

  if (-not [string]::IsNullOrWhiteSpace($prerelease)) {
    # Windows requires a numeric fourth component. Use the final numeric
    # prerelease identifier: 1.0.0-rc.7 -> 1.0.0.7.
    $revisionMatch = [regex]::Match($prerelease, '(?<revision>\d+)$')
    if ($revisionMatch.Success) {
      $revision = [int64]$revisionMatch.Groups['revision'].Value
    }
  }

  foreach ($component in @($major, $minor, $patch, $revision)) {
    if ($component -lt 0 -or $component -gt 65535) {
      throw ("Windows file-version component must be between 0 and 65535: " + $Version)
    }
  }

  return ($major.ToString() + '.' + $minor.ToString() + '.' + $patch.ToString() + '.' + $revision.ToString())
}

function Find-MakeNsis {
  $directCandidates = @()

  if (${env:ProgramFiles(x86)}) {
    $directCandidates += (Join-Path ${env:ProgramFiles(x86)} "NSIS\makensis.exe")
  }
  if ($env:ProgramFiles) {
    $directCandidates += (Join-Path $env:ProgramFiles "NSIS\makensis.exe")
  }

  foreach ($candidate in $directCandidates) {
    if (Test-Path -LiteralPath $candidate) {
      return (Get-Item -LiteralPath $candidate)
    }
  }

  $cacheRoots = @()
  if ($env:LOCALAPPDATA) {
    $cacheRoots += (Join-Path $env:LOCALAPPDATA "electron-builder\Cache\nsis")
    $cacheRoots += (Join-Path $env:LOCALAPPDATA "electron-builder\cache\nsis")
  }

  foreach ($cacheRoot in ($cacheRoots | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $cacheRoot)) {
      continue
    }

    $found = Get-ChildItem -LiteralPath $cacheRoot -Recurse -Filter "makensis.exe" -ErrorAction SilentlyContinue |
      Where-Object { -not $_.PSIsContainer } |
      Sort-Object LastWriteTime -Descending |
      Select-Object -First 1

    if ($found) {
      return $found
    }
  }

  return $null
}

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$packagePath = Join-Path $projectRoot "package.json"
if (-not (Test-Path -LiteralPath $packagePath)) {
  throw ("package.json was not found in " + $projectRoot)
}

$identityPath = Join-Path $projectRoot "installer\identity.json"
if (-not (Test-Path -LiteralPath $identityPath)) {
  throw ("Stable installer identity is missing: " + $identityPath)
}

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$identity = Get-Content -LiteralPath $identityPath -Raw | ConvertFrom-Json
$productName = [string]$package.build.productName
$productVersion = [string]$package.version
$windowsFileVersion = ConvertTo-WindowsFileVersion -Version $productVersion
$companyName = [string]$package.author
$appId = [string]$package.build.appId
$productDescription = [string]$package.description
$appExe = $productName + ".exe"
$installRegistryKey = [string]$identity.installRegistryKey
$defaultInstallDirectoryName = [string]$identity.defaultInstallDirectoryName
$legacyAppId = [string]$identity.legacyAppId
$legacyProductName = [string]$identity.legacyProductName

if ($appId -ne [string]$identity.appId) {
  throw ("package.json build.appId must remain '" + $identity.appId + "' so an update overwrites the existing installation.")
}
if ($productName -ne [string]$identity.productName) {
  throw ("package.json build.productName must remain '" + $identity.productName + "' so an update finds the existing application.")
}
if ($companyName -ne [string]$identity.companyName) {
  throw ("package.json author must remain '" + $identity.companyName + "' so installer ownership stays stable.")
}
if ([string]::IsNullOrWhiteSpace($installRegistryKey) -or [string]::IsNullOrWhiteSpace($defaultInstallDirectoryName)) {
  throw "Stable installer registry key or default installation directory is empty."
}

$releaseDir = Join-Path $projectRoot "release"
$appSource = Join-Path $releaseDir "win-unpacked"
$installerPath = Join-Path $releaseDir ($productName + "-Setup-" + $productVersion + "-x64.exe")
$appIcon = Join-Path $projectRoot "resources\icon.ico"
$electronBuilder = Join-Path $projectRoot "node_modules\.bin\electron-builder.cmd"
$nsisScript = Join-Path $projectRoot "installer\video-studio-pro.nsi"
$generatedConfig = Join-Path $projectRoot "installer\generated-config.nsh"
$toolsScript = Join-Path $projectRoot "scripts\tools-windows.ps1"

if (-not (Test-Path -LiteralPath $electronBuilder)) {
  throw "electron-builder is missing. Run npm.cmd install first."
}
if (-not (Test-Path -LiteralPath $nsisScript)) {
  throw ("NSIS script is missing: " + $nsisScript)
}
if (-not (Test-Path -LiteralPath $appIcon)) {
  throw ("Application icon is missing: " + $appIcon)
}
if (-not (Test-Path -LiteralPath $toolsScript)) {
  throw ("Tool preparation script is missing: " + $toolsScript)
}

Run-External "Prepare required bundled tools" {
  & powershell -NoProfile -ExecutionPolicy Bypass -File $toolsScript -Mode repair-required
}

Run-External "Prepare Electron runtime" {
  & npm.cmd run prepare:electron
}

Run-External "Build main, preload and renderer" {
  & npm.cmd run build
}

Write-Step "Create win-unpacked application"
if (Test-Path -LiteralPath $appSource) {
  Remove-Item -LiteralPath $appSource -Recurse -Force
}
& $electronBuilder --dir --win --x64
$builderExitCode = $LASTEXITCODE
if ($builderExitCode -ne 0) {
  throw ("electron-builder --dir failed with exit code " + $builderExitCode)
}

$appExecutable = Join-Path $appSource $appExe
if (-not (Test-Path -LiteralPath $appExecutable)) {
  throw ("Packaged application was not found: " + $appExecutable)
}

$toolBackups = Join-Path $appSource "resources\tool\.backups"
if (Test-Path -LiteralPath $toolBackups) {
  Write-Step "Remove tool backups from installer payload"
  Remove-Item -LiteralPath $toolBackups -Recurse -Force
}

Write-Step "Verify yt-dlp, FFmpeg and FFprobe inside packaged application"
$packagedToolDir = Join-Path $appSource "resources\tool"
$requiredPackagedTools = @(
  @{ Name = 'yt-dlp'; File = 'yt-dlp.exe'; Args = @('--version') },
  @{ Name = 'ffmpeg'; File = 'ffmpeg.exe'; Args = @('-version') },
  @{ Name = 'ffprobe'; File = 'ffprobe.exe'; Args = @('-version') }
)
foreach ($requiredTool in $requiredPackagedTools) {
  $toolPath = Join-Path $packagedToolDir $requiredTool.File
  if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) {
    throw ("Packaged application is missing required tool: " + $toolPath)
  }
  & $toolPath @($requiredTool.Args) *> $null
  if ($LASTEXITCODE -ne 0) {
    throw ("Packaged required tool cannot run: " + $requiredTool.Name + " (exit " + $LASTEXITCODE + ")")
  }
  Write-Host ("  OK " + $requiredTool.Name + " -> " + $toolPath) -ForegroundColor Green
}

Write-Step "Locate NSIS compiler"
$makeNsis = Find-MakeNsis
if (-not $makeNsis) {
  throw "makensis.exe was not found. Run npm.cmd run dist:electron-builder once so electron-builder downloads NSIS, then run npm.cmd run dist again."
}

$configLines = @(
  ('!define PRODUCT_NAME "' + (Escape-NsisValue $productName) + '"'),
  ('!define PRODUCT_VERSION "' + (Escape-NsisValue $productVersion) + '"'),
  ('!define PRODUCT_FILE_VERSION "' + (Escape-NsisValue $windowsFileVersion) + '"'),
  ('!define PRODUCT_DESCRIPTION "' + (Escape-NsisValue $productDescription) + '"'),
  ('!define COMPANY_NAME "' + (Escape-NsisValue $companyName) + '"'),
  ('!define APP_ID "' + (Escape-NsisValue $appId) + '"'),
  ('!define APP_EXE "' + (Escape-NsisValue $appExe) + '"'),
  ('!define INSTALL_REGISTRY_KEY "' + (Escape-NsisValue $installRegistryKey) + '"'),
  ('!define DEFAULT_INSTALL_DIRECTORY_NAME "' + (Escape-NsisValue $defaultInstallDirectoryName) + '"'),
  ('!define LEGACY_APP_ID "' + (Escape-NsisValue $legacyAppId) + '"'),
  ('!define LEGACY_PRODUCT_NAME "' + (Escape-NsisValue $legacyProductName) + '"'),
  ('!define APP_SOURCE "' + (Escape-NsisValue $appSource) + '"'),
  ('!define APP_ICON "' + (Escape-NsisValue $appIcon) + '"'),
  ('!define OUTPUT_FILE "' + (Escape-NsisValue $installerPath) + '"')
)
$configText = ($configLines -join "`r`n") + "`r`n"
Write-Utf8BomFile -Path $generatedConfig -Content $configText

if (Test-Path -LiteralPath $installerPath) {
  Remove-Item -LiteralPath $installerPath -Force
}

Write-Step "Compile installer with NSIS"
Write-Host ("NSIS : " + $makeNsis.FullName) -ForegroundColor DarkGray
Write-Host ("Input: " + $appSource) -ForegroundColor DarkGray
Write-Host ("Out  : " + $installerPath) -ForegroundColor DarkGray
Write-Host ("WinVer: " + $windowsFileVersion + " (display " + $productVersion + ")") -ForegroundColor DarkGray

$nsisWorkingDir = Split-Path -Parent $nsisScript
$nsisFileName = Split-Path -Leaf $nsisScript
$makeNsisExitCode = -1
Push-Location -LiteralPath $nsisWorkingDir
try {
  & $makeNsis.FullName "/V3" $nsisFileName
  $makeNsisExitCode = $LASTEXITCODE
}
finally {
  Pop-Location
}

if ($makeNsisExitCode -ne 0) {
  throw ("makensis failed with exit code " + $makeNsisExitCode)
}

if (-not (Test-Path -LiteralPath $installerPath)) {
  throw ("NSIS did not create the installer: " + $installerPath)
}

$installer = Get-Item -LiteralPath $installerPath
$hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
$checksumPath = Join-Path $releaseDir ("Download-video-Tubmedia-" + $productVersion + "-SHA256.txt")
$checksumText = $hash.Hash + "  " + $installer.Name + "`r`n"
Write-Utf8BomFile -Path $checksumPath -Content $checksumText

Write-Step "Create GitHub updater metadata"
$sha512Algorithm = [System.Security.Cryptography.SHA512]::Create()
try {
  $installerBytes = [System.IO.File]::ReadAllBytes($installer.FullName)
  $sha512Base64 = [Convert]::ToBase64String($sha512Algorithm.ComputeHash($installerBytes))
}
finally {
  $sha512Algorithm.Dispose()
}

$latestPath = Join-Path $releaseDir "latest.yml"
$releaseDate = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
$latestText = @"
version: $productVersion
files:
  - url: "$($installer.Name)"
    sha512: $sha512Base64
    size: $($installer.Length)
path: "$($installer.Name)"
sha512: $sha512Base64
releaseDate: '$releaseDate'
"@
Write-Utf8BomFile -Path $latestPath -Content ($latestText.Trim() + "`r`n")

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  BUILD INSTALLER SUCCESS" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ("Installer : " + $installer.FullName)
Write-Host (("Size      : {0:N2} MB") -f ($installer.Length / 1MB))
Write-Host ("SHA-256   : " + $hash.Hash)
Write-Host ("Checksum  : " + $checksumPath)
Write-Host ("Update yml: " + $latestPath)
