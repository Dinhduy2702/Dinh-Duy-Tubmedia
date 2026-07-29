$ErrorActionPreference = 'Stop'

function Invoke-Step {
  param(
    [Parameter(Mandatory = $true)][string]$Name,
    [Parameter(Mandatory = $true)][scriptblock]$Action
  )

  Write-Host $Name -ForegroundColor Cyan
  & $Action
  if ($LASTEXITCODE -ne 0) {
    throw "Step failed with exit code ${LASTEXITCODE}: $Name"
  }
}

Invoke-Step '[0/7] Checking Node.js and node:sqlite...' {
  & powershell.exe -NoProfile -ExecutionPolicy Bypass -File scripts/doctor-windows.ps1
}

Write-Host '[1/7] Installing dependencies...' -ForegroundColor Cyan
if (Test-Path 'package-lock.json') {
  & npm.cmd ci
} else {
  Write-Warning 'package-lock.json is missing. Running npm install to create it.'
  & npm.cmd install
}
if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }

Invoke-Step '[2/7] Checking database runtime...' {
  & npm.cmd run rebuild
}

Invoke-Step '[3/7] Running typecheck...' {
  & npm.cmd run typecheck
}

Invoke-Step '[4/7] Running lint and tests...' {
  & npm.cmd run lint
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npm.cmd run test
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & npm.cmd run test:integration
}

Invoke-Step '[5/7] Building production assets...' {
  & npm.cmd run build
}

Invoke-Step '[6/7] Building Windows installer...' {
  & npm.cmd run dist
}

Write-Host '[7/7] Completed. Installer files are in the release folder.' -ForegroundColor Green
exit 0
