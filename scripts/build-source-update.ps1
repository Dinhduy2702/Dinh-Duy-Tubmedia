$ErrorActionPreference = "Stop"
Set-StrictMode -Version 2.0

$projectRoot = Split-Path -Parent $PSScriptRoot
Set-Location -LiteralPath $projectRoot

$packagePath = Join-Path $projectRoot "package.json"
if (-not (Test-Path -LiteralPath $packagePath)) {
  throw ("package.json was not found in " + $projectRoot)
}

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
$version = [string]$package.version
$releaseDir = Join-Path $projectRoot "release"
$stageDir = Join-Path $env:TEMP ("Tubmedia-source-update-" + [guid]::NewGuid().ToString("N"))
$zipPath = Join-Path $releaseDir ("Tubmedia_SOURCE_UPDATE_OVERWRITE_v" + $version + ".zip")
$checksumPath = Join-Path $releaseDir ("Tubmedia_SOURCE_UPDATE_OVERWRITE_v" + $version + "-SHA256.txt")

$excludedDirectories = @(
  ".git",
  "node_modules",
  "out",
  "release",
  "coverage",
  "test-results",
  "playwright-report",
  "tmp",
  "tool"
)
$excludedFiles = @(
  "installer\generated-config.nsh",
  "tsconfig.node.tsbuildinfo",
  "tsconfig.web.tsbuildinfo"
)

New-Item -ItemType Directory -Force -Path $releaseDir | Out-Null
New-Item -ItemType Directory -Force -Path $stageDir | Out-Null

try {
  $robocopyArguments = @(
    $projectRoot,
    $stageDir,
    "/E",
    "/R:2",
    "/W:1",
    "/NFL",
    "/NDL",
    "/NJH",
    "/NJS",
    "/NP",
    "/XD"
  ) + ($excludedDirectories | ForEach-Object { Join-Path $projectRoot $_ }) + @(
    "/XF"
  ) + ($excludedFiles | ForEach-Object { Join-Path $projectRoot $_ }) + @(
    "*.log",
    "*.sqlite",
    "*.sqlite-shm",
    "*.sqlite-wal"
  )

  & robocopy @robocopyArguments | Out-Null
  $copyCode = $LASTEXITCODE
  if ($copyCode -gt 7) {
    throw ("robocopy failed with exit code " + $copyCode)
  }

  if (-not (Test-Path -LiteralPath (Join-Path $stageDir "package.json"))) {
    throw "Source update staging did not contain package.json."
  }
  if (-not (Test-Path -LiteralPath (Join-Path $stageDir "src"))) {
    throw "Source update staging did not contain src."
  }

  Add-Type -AssemblyName System.IO.Compression.FileSystem
  if (Test-Path -LiteralPath $zipPath) {
    Remove-Item -LiteralPath $zipPath -Force
  }
  [System.IO.Compression.ZipFile]::CreateFromDirectory(
    $stageDir,
    $zipPath,
    [System.IO.Compression.CompressionLevel]::Optimal,
    $false
  )

  $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
  try {
    $entryNames = @($archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
    if ($entryNames -notcontains "package.json") {
      throw "Update ZIP is invalid: package.json is not at archive root."
    }
    if (-not ($entryNames | Where-Object { $_ -like "src/*" } | Select-Object -First 1)) {
      throw "Update ZIP is invalid: src is missing."
    }
    if ($entryNames | Where-Object { $_ -like "*/package.json" -and $_ -ne "package.json" } | Select-Object -First 1) {
      throw "Update ZIP unexpectedly contains a version-named wrapper folder."
    }
    if ($entryNames | Where-Object { $_ -match "(^|/)(node_modules|out|release|tmp|test-results|tool)/" } | Select-Object -First 1) {
      throw "Update ZIP contains generated or temporary directories."
    }
  }
  finally {
    $archive.Dispose()
  }

  $hash = Get-FileHash -LiteralPath $zipPath -Algorithm SHA256
  [System.IO.File]::WriteAllText(
    $checksumPath,
    ($hash.Hash + "  " + [System.IO.Path]::GetFileName($zipPath) + "`r`n"),
    (New-Object System.Text.UTF8Encoding($true))
  )

  Write-Host ""
  Write-Host "============================================================" -ForegroundColor Green
  Write-Host "  SOURCE UPDATE PACKAGE READY" -ForegroundColor Green
  Write-Host "============================================================" -ForegroundColor Green
  Write-Host ("ZIP       : " + $zipPath)
  Write-Host ("SHA-256   : " + $hash.Hash)
  Write-Host "Archive root contains package.json/src directly."
  Write-Host "Extract into the existing source folder and choose Replace all."
}
finally {
  if (Test-Path -LiteralPath $stageDir) {
    Remove-Item -LiteralPath $stageDir -Recurse -Force
  }
}
