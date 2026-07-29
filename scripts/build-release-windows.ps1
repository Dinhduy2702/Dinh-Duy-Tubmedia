$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

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

$root = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $root

if ([string]::IsNullOrWhiteSpace($env:TUBMEDIA_UPDATE_URL)) {
  throw @"
Thiếu biến môi trường TUBMEDIA_UPDATE_URL.
Ví dụ:
  `$env:TUBMEDIA_UPDATE_URL = "https://updates.tenmiencuaban.com/tubmedia/"
  `$env:TUBMEDIA_UPDATE_CHANNEL = "stable"
  npm.cmd run release:windows
"@
}

$package = Get-Content -LiteralPath (Join-Path $root "package.json") -Raw | ConvertFrom-Json
$identity = Get-Content -LiteralPath (Join-Path $root "installer\identity.json") -Raw | ConvertFrom-Json
$channel = if ($env:TUBMEDIA_UPDATE_CHANNEL -eq "beta") { "beta" } else { "stable" }
if ($channel -eq "stable" -and [string]$package.version -match "-") {
  throw "Kênh stable không nhận version prerelease '$($package.version)'. Dùng TUBMEDIA_UPDATE_CHANNEL=beta để test RC hoặc đổi version thành 1.0.0 khi phát hành chính thức."
}
if ([string]$package.build.appId -ne [string]$identity.appId) {
  throw "package.json build.appId must remain identical to installer/identity.json."
}
if ([string]$package.build.productName -ne [string]$identity.productName) {
  throw "package.json build.productName must remain identical to installer/identity.json."
}

Run-Step "Chuẩn bị Electron cho máy build" {
  & npm.cmd run prepare:electron
}

Run-Step "Bảo đảm bộ công cụ bắt buộc được đóng gói cùng installer" {
  & npm.cmd run tools:repair-required:windows
}

$requiredToolFiles = @('yt-dlp.exe', 'ffmpeg.exe', 'ffprobe.exe')
foreach ($toolFile in $requiredToolFiles) {
  $toolPath = Join-Path $root (Join-Path 'tool' $toolFile)
  if (-not (Test-Path -LiteralPath $toolPath -PathType Leaf)) {
    throw ("Thiếu công cụ bắt buộc trước khi build installer: " + $toolPath)
  }
  if ((Get-Item -LiteralPath $toolPath).Length -le 0) {
    throw ("Công cụ bắt buộc bị rỗng: " + $toolPath)
  }
}

Run-Step "Kiểm tra tài sản, kiến trúc release, TypeScript và toàn bộ test" {
  & npm.cmd run check
}

Write-Host ""
Write-Host "==> Tạo cấu hình phát hành có máy chủ cập nhật" -ForegroundColor Cyan
$configPath = (& node scripts/create-release-config.mjs | Select-Object -Last 1).Trim()
if (-not (Test-Path -LiteralPath $configPath)) {
  throw ("Không tạo được cấu hình phát hành: " + $configPath)
}

$releaseDir = Join-Path $root "release"
if (Test-Path -LiteralPath $releaseDir) {
  Remove-Item -LiteralPath $releaseDir -Recurse -Force
}
New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null

$builder = Join-Path $root "node_modules\.bin\electron-builder.cmd"
if (-not (Test-Path -LiteralPath $builder)) {
  throw "Không tìm thấy electron-builder local. Hãy chạy npm.cmd install trước."
}

if ([string]::IsNullOrWhiteSpace($env:CSC_LINK)) {
  Write-Host "CẢNH BÁO: Chưa cấu hình chứng thư ký mã (CSC_LINK). Installer test vẫn build được, nhưng bản phát hành công khai nên được ký số." -ForegroundColor Yellow
}

Run-Step "Đóng gói NSIS tương thích cập nhật vi sai" {
  & $builder --config $configPath --win nsis --x64 --publish never
}

$installer = Get-ChildItem -LiteralPath $releaseDir -Filter "*.exe" -File |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1
$metadataFiles = @(Get-ChildItem -LiteralPath $releaseDir -Filter "*.yml" -File |
  Sort-Object Name)
$blockmapFiles = @(Get-ChildItem -LiteralPath $releaseDir -Filter "*.blockmap" -File |
  Sort-Object Name)

if (-not $installer) { throw "Không tìm thấy installer EXE trong release." }
if ($metadataFiles.Count -eq 0) { throw "Không tìm thấy latest.yml/beta.yml. Bộ cập nhật sẽ không hoạt động." }
if ($blockmapFiles.Count -eq 0) { throw "Không tìm thấy blockmap. Cập nhật vi sai chưa được tạo." }

$files = @($installer) + $metadataFiles + $blockmapFiles
$manifest = foreach ($file in $files) {
  $hash = Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256
  [PSCustomObject]@{
    file = $file.Name
    sizeBytes = $file.Length
    sha256 = $hash.Hash
  }
}
$manifestPath = Join-Path $releaseDir "release-manifest.json"
$manifest | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $manifestPath -Encoding UTF8

Write-Host ""
Write-Host "============================================================" -ForegroundColor Green
Write-Host "  TUBMEDIA RELEASE PACKAGE READY" -ForegroundColor Green
Write-Host "============================================================" -ForegroundColor Green
Write-Host ("Installer : " + $installer.FullName)
Write-Host ("Metadata  : " + (($metadataFiles | ForEach-Object { $_.Name }) -join ", "))
Write-Host ("Blockmap  : " + (($blockmapFiles | ForEach-Object { $_.Name }) -join ", "))
Write-Host ("Manifest  : " + $manifestPath)
Write-Host ""
Write-Host "Tải cả installer, metadata và blockmap lên đúng TUBMEDIA_UPDATE_URL." -ForegroundColor Yellow
