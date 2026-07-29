$ErrorActionPreference = 'Stop'

Write-Host 'VIDEO STUDIO PRO - WINDOWS DOCTOR'
Write-Host '=================================='

$nodeOk = $false
$npmOk = $false
$sqliteOk = $false
$nodeVersion = ''
$npmVersion = ''

try {
  $nodeVersion = (& node --version 2>$null)
  $nodeOk = ($LASTEXITCODE -eq 0) -and [bool]$nodeVersion
} catch {
  Write-Host ('Cannot run Node.js: ' + $_.Exception.Message) -ForegroundColor DarkYellow
}

try {
  $npmVersion = (& npm.cmd --version 2>$null)
  $npmOk = ($LASTEXITCODE -eq 0) -and [bool]$npmVersion
} catch {
  Write-Host ('Cannot run npm.cmd: ' + $_.Exception.Message) -ForegroundColor DarkYellow
}

try {
  & node -e "const { DatabaseSync } = require('node:sqlite'); const db = new DatabaseSync(':memory:'); db.exec('CREATE TABLE t(x)'); db.close();" 2>$null
  $sqliteOk = ($LASTEXITCODE -eq 0)
} catch {
  Write-Host ('Cannot initialize node:sqlite: ' + $_.Exception.Message) -ForegroundColor DarkYellow
}

$nodeText = if ($nodeOk) { 'OK ' + $nodeVersion } else { 'MISSING' }
$npmText = if ($npmOk) { 'OK ' + $npmVersion } else { 'MISSING' }
$sqliteText = if ($sqliteOk) { 'OK' } else { 'NOT SUPPORTED' }

Write-Host ('Node.js     : ' + $nodeText)
Write-Host ('npm.cmd     : ' + $npmText)
Write-Host ('node:sqlite : ' + $sqliteText)
Write-Host ''

if (-not ($nodeOk -and $npmOk -and $sqliteOk)) {
  Write-Host 'Machine is not ready. Install Node.js 24 LTS and reopen PowerShell.' -ForegroundColor Red
  exit 1
}

Write-Host 'Machine is ready. Database uses built-in node:sqlite.' -ForegroundColor Green
Write-Host 'Python and Visual C++ Build Tools are not required for SQLite.' -ForegroundColor Green
exit 0
