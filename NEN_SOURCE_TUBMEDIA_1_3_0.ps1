[CmdletBinding()]
param(
    [string]$ProjectPath = $PSScriptRoot,
    [string]$OutputDirectory = "",
    [string]$ArchiveName = "Tubmedia_Source_Upgraded_1.3.0.zip"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ProjectPath = (Resolve-Path -LiteralPath $ProjectPath).Path
$PackagePath = Join-Path $ProjectPath "package.json"
if (-not (Test-Path -LiteralPath $PackagePath -PathType Leaf)) {
    throw "Không tìm thấy package.json: $PackagePath"
}

$Package = Get-Content -LiteralPath $PackagePath -Raw | ConvertFrom-Json
if ([string]$Package.version -ne "1.3.0") {
    throw "Chỉ được nén source Tubmedia 1.3.0. Hiện tại: $($Package.version)"
}

if ([string]::IsNullOrWhiteSpace($OutputDirectory)) {
    $OutputDirectory = Join-Path (Split-Path -Parent $ProjectPath) "TUBMEDIA_UPLOAD"
}

$OutputDirectory = [System.IO.Path]::GetFullPath($OutputDirectory)
$StageRoot = Join-Path $env:TEMP ("Tubmedia_Source_Upgraded_1.3.0_" + (Get-Date -Format "yyyyMMdd-HHmmss"))
$StageProject = Join-Path $StageRoot "Tubmedia_Source_Upgraded_1.3.0"
$ArchivePath = Join-Path $OutputDirectory $ArchiveName

$ExcludedDirectories = @(
    ".git", "node_modules", "out", "release", "coverage", "test-results",
    "verification", "verification-logs", "playwright-report", ".cache", ".vite",
    ".tubmedia-patches"
)
$ForbiddenExtensions = @(
    ".exe", ".msi", ".pdb", ".dmp", ".mp4", ".mkv", ".webm", ".mov",
    ".avi", ".zip", ".7z", ".rar", ".tsbuildinfo"
)

function Test-ExcludedRelativePath {
    param([string]$RelativePath)

    $Segments = $RelativePath -split "[\\/]"
    foreach ($Segment in $Segments) {
        if ($ExcludedDirectories -contains $Segment) { return $true }
    }

    $Leaf = [System.IO.Path]::GetFileName($RelativePath)
    if ($Leaf -match "(?i)^\.env(?:\.|$)") { return $true }
    if ($Leaf -match "(?i)^(?:cookies?|credentials?|secrets?)\.(?:txt|json)$") { return $true }
    if ($Leaf -match "(?i)\.(?:pem|key|pfx|p12|log)$") { return $true }
    if ($ForbiddenExtensions -contains ([System.IO.Path]::GetExtension($Leaf).ToLowerInvariant())) { return $true }
    return $false
}

try {
    New-Item -ItemType Directory -Path $StageProject -Force | Out-Null
    New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

    $Files = Get-ChildItem -LiteralPath $ProjectPath -Recurse -File -Force
    foreach ($File in $Files) {
        $RelativePath = $File.FullName.Substring($ProjectPath.Length).TrimStart("\\", "/")
        if (Test-ExcludedRelativePath -RelativePath $RelativePath) { continue }

        $Destination = Join-Path $StageProject $RelativePath
        New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
        Copy-Item -LiteralPath $File.FullName -Destination $Destination -Force
    }

    & node (Join-Path $StageProject "scripts\generate-source-inventory.mjs") --root $StageProject
    if ($LASTEXITCODE -ne 0) { throw "Không tạo được source inventory." }

    & node (Join-Path $StageProject "scripts\verify-source-completeness.mjs") --root $StageProject
    if ($LASTEXITCODE -ne 0) { throw "Source staging không đạt kiểm tra completeness." }

    if (Test-Path -LiteralPath $ArchivePath) {
        Remove-Item -LiteralPath $ArchivePath -Force
    }

    Compress-Archive -LiteralPath $StageProject -DestinationPath $ArchivePath -CompressionLevel Optimal
    $ArchiveHash = (Get-FileHash -LiteralPath $ArchivePath -Algorithm SHA256).Hash

    Write-Host ""
    Write-Host "NÉN SOURCE TUBMEDIA 1.3.0 : PASS" -ForegroundColor Green
    Write-Host ("ZIP      : " + $ArchivePath) -ForegroundColor Green
    Write-Host ("Dung lượng: " + [Math]::Round((Get-Item $ArchivePath).Length / 1MB, 2) + " MB") -ForegroundColor Green
    Write-Host ("SHA-256  : " + $ArchiveHash) -ForegroundColor Green
    Write-Host "Đã giữ nguyên installer/ và src/main/download/." -ForegroundColor Yellow
}
finally {
    Remove-Item -LiteralPath $StageRoot -Recurse -Force -ErrorAction SilentlyContinue
}
