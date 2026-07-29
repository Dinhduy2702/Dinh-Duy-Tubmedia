param(
    [ValidateSet('check','repair','repair-required','update')]
    [string]$Mode = 'check',
    [switch]$SoftFail
)

$ErrorActionPreference = 'Stop'
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$ProjectRoot = Split-Path -Parent $PSScriptRoot
$ProjectParent = Split-Path -Parent $ProjectRoot
$ToolDir = Join-Path $ProjectRoot 'tool'
$CacheRoot = if ($env:LOCALAPPDATA) {
    Join-Path $env:LOCALAPPDATA 'Tubmedia\ToolCache'
} else {
    Join-Path $env:TEMP 'Tubmedia-ToolCache'
}
$TempDir = Join-Path $CacheRoot ('session-' + [guid]::NewGuid().ToString('N'))
$BackupDir = Join-Path $ToolDir ('.backups\powershell-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))

function Write-Title([string]$Text) {
    Write-Host ''
    Write-Host ('=' * 68) -ForegroundColor Cyan
    Write-Host ('  ' + $Text) -ForegroundColor White
    Write-Host ('=' * 68) -ForegroundColor Cyan
}

function Clear-InternetMark([string]$Path) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    try { Unblock-File -LiteralPath $Path -ErrorAction SilentlyContinue } catch { }
    try { Remove-Item -LiteralPath ($Path + ':Zone.Identifier') -Force -ErrorAction SilentlyContinue } catch { }
}

function Clear-InternetMarksInTree([string]$Root) {
    if (-not (Test-Path -LiteralPath $Root -PathType Container)) { return }
    Get-ChildItem -LiteralPath $Root -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object { Clear-InternetMark $_.FullName }
}

function Invoke-ToolProbe([string]$Path, [string[]]$Arguments) {
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        return [pscustomobject]@{ Ok = $false; Version = ''; Error = 'File not found' }
    }
    Clear-InternetMark $Path
    try {
        $Output = & $Path @Arguments 2>&1 | Out-String
        $Code = $LASTEXITCODE
        $Line = ($Output -split "`r?`n" | Where-Object { $_.Trim() } | Select-Object -First 1)
        $ErrorText = if ($Code -eq 0) { '' } else { 'Exit ' + $Code + ': ' + $Line }
        return [pscustomobject]@{ Ok = ($Code -eq 0); Version = $Line; Error = $ErrorText }
    } catch {
        return [pscustomobject]@{ Ok = $false; Version = ''; Error = $_.Exception.Message }
    }
}

function Test-Tool([string]$Name, [string[]]$Arguments) {
    $Path = Join-Path $ToolDir ($Name + '.exe')
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        $Command = Get-Command ($Name + '.exe') -ErrorAction SilentlyContinue
        if (-not $Command) { $Command = Get-Command $Name -ErrorAction SilentlyContinue }
        if ($Command) { $Path = $Command.Source }
    }
    $Probe = Invoke-ToolProbe $Path $Arguments
    return [pscustomobject]@{
        Name = $Name
        Path = $Path
        Ok = $Probe.Ok
        Version = $Probe.Version
        Error = $Probe.Error
    }
}

function Test-BundledTool([string]$Name, [string[]]$Arguments) {
    $Path = Join-Path $ToolDir ($Name + '.exe')
    $Probe = Invoke-ToolProbe $Path $Arguments
    return [pscustomobject]@{
        Name = $Name
        Path = $Path
        Ok = $Probe.Ok
        Version = $Probe.Version
        Error = $Probe.Error
    }
}

function Get-BundledHealth {
    return @(
        Test-BundledTool 'yt-dlp' @('--version')
        Test-BundledTool 'ffmpeg' @('-version')
        Test-BundledTool 'ffprobe' @('-version')
        Test-BundledTool 'ffplay' @('-version')
        Test-BundledTool 'aria2c' @('-v')
    )
}

function Show-Health {
    $Rows = @(
        Test-Tool 'yt-dlp' @('--version')
        Test-Tool 'ffmpeg' @('-version')
        Test-Tool 'ffprobe' @('-version')
        Test-Tool 'ffplay' @('-version')
        Test-Tool 'aria2c' @('-v')
    )
    $Rows | Select-Object Name, Ok, Version, Path, Error | Format-Table -AutoSize | Out-Host
    return $Rows
}

function Backup-File([string]$Path) {
    if (Test-Path -LiteralPath $Path -PathType Leaf) {
        New-Item -ItemType Directory -Path $BackupDir -Force | Out-Null
        Copy-Item -LiteralPath $Path -Destination (Join-Path $BackupDir (Split-Path $Path -Leaf)) -Force
    }
}

function Restore-BackupFile([string]$Name) {
    $Destination = Join-Path $ToolDir $Name
    $Backup = Join-Path $BackupDir $Name
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        Remove-Item -LiteralPath $Destination -Force -ErrorAction SilentlyContinue
    }
    if (Test-Path -LiteralPath $Backup -PathType Leaf) {
        Copy-Item -LiteralPath $Backup -Destination $Destination -Force
        Clear-InternetMark $Destination
    }
}

function Install-File([string]$Source, [string]$Name) {
    $Destination = Join-Path $ToolDir $Name
    Backup-File $Destination
    $Pending = $Destination + '.new'
    Copy-Item -LiteralPath $Source -Destination $Pending -Force
    Clear-InternetMark $Pending
    if (Test-Path -LiteralPath $Destination) { Remove-Item -LiteralPath $Destination -Force }
    Move-Item -LiteralPath $Pending -Destination $Destination -Force
    Clear-InternetMark $Destination
    return $Destination
}

function Download-File([string]$Url, [string]$OutFile) {
    Write-Host ('Download: ' + $Url) -ForegroundColor DarkCyan
    New-Item -ItemType Directory -Path (Split-Path -Parent $OutFile) -Force | Out-Null
    Invoke-WebRequest -Uri $Url -OutFile $OutFile -UseBasicParsing -Headers @{ 'User-Agent' = 'Download-video-Tubmedia' }
    if (-not (Test-Path -LiteralPath $OutFile) -or (Get-Item -LiteralPath $OutFile).Length -le 0) {
        throw ('Download failed: ' + $Url)
    }
    Clear-InternetMark $OutFile
}

function Add-Candidate([System.Collections.Generic.List[string]]$List, [string]$Path) {
    if ([string]::IsNullOrWhiteSpace($Path)) { return }
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { return }
    if ($Path -ieq (Join-Path $ToolDir (Split-Path $Path -Leaf))) { return }
    if (-not $List.Contains($Path)) { $List.Add($Path) }
}

function Get-ExistingToolCandidates([string]$Name) {
    $Exe = $Name + '.exe'
    $Candidates = New-Object 'System.Collections.Generic.List[string]'

    $Command = Get-Command $Exe -ErrorAction SilentlyContinue
    if (-not $Command) { $Command = Get-Command $Name -ErrorAction SilentlyContinue }
    if ($Command) { Add-Candidate $Candidates $Command.Source }

    $SiblingRoots = @()
    if (Test-Path -LiteralPath $ProjectParent -PathType Container) {
        $SiblingRoots += Get-ChildItem -LiteralPath $ProjectParent -Directory -ErrorAction SilentlyContinue |
            Where-Object { $_.Name -like 'Tubmedia*' -or $_.Name -like 'Video*Studio*' }
    }
    foreach ($Root in $SiblingRoots) {
        foreach ($Relative in @(
            ('tool\' + $Exe),
            ('tools\' + $Exe),
            ('resources\tool\' + $Exe),
            ('resources\tools\' + $Exe),
            ('release\win-unpacked\resources\tool\' + $Exe),
            ('release\win-unpacked\resources\tools\' + $Exe)
        )) {
            Add-Candidate $Candidates (Join-Path $Root.FullName $Relative)
        }
    }

    if ($env:LOCALAPPDATA) {
        $WingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft\WinGet\Packages'
        if (Test-Path -LiteralPath $WingetRoot -PathType Container) {
            $PackagePatterns = if ($Name -in @('ffmpeg','ffprobe','ffplay')) {
                @('Gyan.FFmpeg*', 'BtbN.FFmpeg*')
            } elseif ($Name -eq 'yt-dlp') {
                @('yt-dlp.yt-dlp*')
            } elseif ($Name -eq 'aria2c') {
                @('aria2.aria2*')
            } else { @() }
            foreach ($Pattern in $PackagePatterns) {
                Get-ChildItem -LiteralPath $WingetRoot -Directory -Filter $Pattern -ErrorAction SilentlyContinue |
                    ForEach-Object {
                        Get-ChildItem -LiteralPath $_.FullName -Recurse -File -Filter $Exe -ErrorAction SilentlyContinue |
                            ForEach-Object { Add-Candidate $Candidates $_.FullName }
                    }
            }
        }
    }

    return $Candidates
}

function Import-ExistingTool([string]$Name, [string[]]$Arguments) {
    foreach ($Candidate in (Get-ExistingToolCandidates $Name)) {
        $Probe = Invoke-ToolProbe $Candidate $Arguments
        if (-not $Probe.Ok) { continue }
        Write-Host ('Reuse trusted existing tool: ' + $Candidate) -ForegroundColor DarkGreen
        $Destination = Install-File $Candidate ($Name + '.exe')
        $InstalledProbe = Invoke-ToolProbe $Destination $Arguments
        if ($InstalledProbe.Ok) { return $true }
        Restore-BackupFile ($Name + '.exe')
    }
    return $false
}

function Import-ExistingFfmpegSuite {
    foreach ($Candidate in (Get-ExistingToolCandidates 'ffmpeg')) {
        $Folder = Split-Path -Parent $Candidate
        $Ffmpeg = Join-Path $Folder 'ffmpeg.exe'
        $Ffprobe = Join-Path $Folder 'ffprobe.exe'
        $Ffplay = Join-Path $Folder 'ffplay.exe'
        if (-not (Test-Path -LiteralPath $Ffprobe -PathType Leaf)) { continue }
        if (-not (Invoke-ToolProbe $Ffmpeg @('-version')).Ok) { continue }
        if (-not (Invoke-ToolProbe $Ffprobe @('-version')).Ok) { continue }

        Write-Host ('Reuse trusted existing FFmpeg suite: ' + $Folder) -ForegroundColor DarkGreen
        try {
            $InstalledFfmpeg = Install-File $Ffmpeg 'ffmpeg.exe'
            $InstalledFfprobe = Install-File $Ffprobe 'ffprobe.exe'
            if (Test-Path -LiteralPath $Ffplay -PathType Leaf) { Install-File $Ffplay 'ffplay.exe' | Out-Null }
            if (-not (Invoke-ToolProbe $InstalledFfmpeg @('-version')).Ok) { throw 'ffmpeg copied but cannot run.' }
            if (-not (Invoke-ToolProbe $InstalledFfprobe @('-version')).Ok) { throw 'ffprobe copied but cannot run.' }
            return $true
        } catch {
            Restore-BackupFile 'ffmpeg.exe'
            Restore-BackupFile 'ffprobe.exe'
            Restore-BackupFile 'ffplay.exe'
        }
    }
    return $false
}

function Invoke-WingetInstall([string]$PackageId) {
    $Winget = Get-Command winget.exe -ErrorAction SilentlyContinue
    if (-not $Winget) { return $false }

    Write-Host ('Fallback WinGet: ' + $PackageId) -ForegroundColor Yellow
    $Common = @(
        'install', '--id', $PackageId, '--exact', '--silent',
        '--accept-package-agreements', '--accept-source-agreements', '--disable-interactivity'
    )
    try {
        & $Winget.Source @Common
        if ($LASTEXITCODE -eq 0) { return $true }
    } catch { }
    return $false
}

function Update-YtDlp {
    if (Import-ExistingTool 'yt-dlp' @('--version')) { return }

    $Out = Join-Path $TempDir 'yt-dlp.exe'
    try {
        Download-File 'https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp.exe' $Out
        $Destination = Install-File $Out 'yt-dlp.exe'
        $Probe = Invoke-ToolProbe $Destination @('--version')
        if (-not $Probe.Ok) { throw ('yt-dlp failed after install: ' + $Probe.Error) }
        return
    } catch {
        Restore-BackupFile 'yt-dlp.exe'
        Write-Warning ('Direct yt-dlp install failed: ' + $_.Exception.Message)
    }

    if (Invoke-WingetInstall 'yt-dlp.yt-dlp') {
        if (Import-ExistingTool 'yt-dlp' @('--version')) { return }
    }
    throw 'Could not install a runnable yt-dlp.exe. Windows Application Control may be blocking unsigned downloaded binaries.'
}

function Update-FfmpegSuite {
    if (Import-ExistingFfmpegSuite) { return }

    $Zip = Join-Path $TempDir 'ffmpeg.zip'
    $Extracted = Join-Path $TempDir 'ffmpeg-extracted'
    try {
        Download-File 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip' $Zip
        Expand-Archive -LiteralPath $Zip -DestinationPath $Extracted -Force
        Clear-InternetMarksInTree $Extracted

        $Installed = @()
        foreach ($Exe in @('ffmpeg.exe','ffprobe.exe','ffplay.exe')) {
            $Candidate = Get-ChildItem -LiteralPath $Extracted -Recurse -File -Filter $Exe | Select-Object -First 1
            if (-not $Candidate) { throw ('FFmpeg package missing ' + $Exe) }
            $Installed += Install-File $Candidate.FullName $Exe
        }

        $FfmpegProbe = Invoke-ToolProbe (Join-Path $ToolDir 'ffmpeg.exe') @('-version')
        $FfprobeProbe = Invoke-ToolProbe (Join-Path $ToolDir 'ffprobe.exe') @('-version')
        if (-not $FfmpegProbe.Ok) { throw ('ffmpeg blocked after install: ' + $FfmpegProbe.Error) }
        if (-not $FfprobeProbe.Ok) { throw ('ffprobe blocked after install: ' + $FfprobeProbe.Error) }
        return
    } catch {
        Restore-BackupFile 'ffmpeg.exe'
        Restore-BackupFile 'ffprobe.exe'
        Restore-BackupFile 'ffplay.exe'
        Write-Warning ('Direct FFmpeg install failed: ' + $_.Exception.Message)
    }

    if (Invoke-WingetInstall 'Gyan.FFmpeg') {
        if (Import-ExistingFfmpegSuite) { return }
    }

    throw @"
Windows Application Control blocked FFmpeg.
Tubmedia tried: an existing trusted copy, a downloaded package with the Internet mark removed, and WinGet.
Open Windows Security or the organization policy log to allow a trusted FFmpeg build, or configure an already-approved ffmpeg.exe/ffprobe.exe in Tool Center.
"@
}

function Update-Aria2 {
    if (Import-ExistingTool 'aria2c' @('-v')) { return }
    $Release = Invoke-RestMethod -Uri 'https://api.github.com/repos/aria2/aria2/releases/latest' -Headers @{ 'User-Agent' = 'Download-video-Tubmedia' }
    $Asset = $Release.assets | Where-Object { $_.name -match '^aria2-.*-win-64bit-build\d+\.zip$' } | Select-Object -First 1
    if (-not $Asset) { throw 'Could not find aria2 Windows x64 asset.' }
    $Zip = Join-Path $TempDir 'aria2.zip'
    $Extracted = Join-Path $TempDir 'aria2-extracted'
    Download-File $Asset.browser_download_url $Zip
    Expand-Archive -LiteralPath $Zip -DestinationPath $Extracted -Force
    Clear-InternetMarksInTree $Extracted
    $Candidate = Get-ChildItem -LiteralPath $Extracted -Recurse -File -Filter 'aria2c.exe' | Select-Object -First 1
    if (-not $Candidate) { throw 'aria2 package missing aria2c.exe.' }
    $Destination = Install-File $Candidate.FullName 'aria2c.exe'
    $Probe = Invoke-ToolProbe $Destination @('-v')
    if (-not $Probe.Ok) { throw ('aria2c failed after install: ' + $Probe.Error) }
}

function Run-Main {
    Write-Title 'TUBMEDIA - TOOL CHECK / REPAIR'
    Write-Host ('Project : ' + $ProjectRoot)
    Write-Host ('Tool dir : ' + $ToolDir)
    Write-Host ('Cache    : ' + $CacheRoot)
    Write-Host ('Mode     : ' + $Mode)
    New-Item -ItemType Directory -Path $ToolDir -Force | Out-Null

    $Before = Show-Health
    $BundledBefore = Get-BundledHealth
    if ($Mode -eq 'check') {
        $RequiredBroken = $Before | Where-Object { $_.Name -in @('yt-dlp','ffmpeg','ffprobe') -and -not $_.Ok }
        if ($RequiredBroken) { throw 'Required tools are missing or blocked.' }
        return
    }

    New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
    $RequiredOnly = $Mode -eq 'repair-required'

    # Building an installer requires physical copies inside ProjectRoot\tool.
    # A runnable ffmpeg from PATH/WinGet is not enough because electron-builder
    # only packages files that actually exist in the project tool directory.
    $NeedYt = $Mode -eq 'update' -or -not (($BundledBefore | Where-Object Name -eq 'yt-dlp').Ok)
    $NeedFfmpeg = $Mode -eq 'update' -or -not (($BundledBefore | Where-Object Name -eq 'ffmpeg').Ok) -or -not (($BundledBefore | Where-Object Name -eq 'ffprobe').Ok) -or ((-not $RequiredOnly) -and -not (($BundledBefore | Where-Object Name -eq 'ffplay').Ok))
    $NeedAria = (-not $RequiredOnly) -and ($Mode -eq 'update' -or -not (($BundledBefore | Where-Object Name -eq 'aria2c').Ok))

    if ($NeedYt) { Write-Title 'UPDATE YT-DLP'; Update-YtDlp }
    if ($NeedFfmpeg) { Write-Title 'UPDATE FFMPEG / FFPROBE / FFPLAY'; Update-FfmpegSuite }
    if ($NeedAria) { Write-Title 'UPDATE ARIA2C'; Update-Aria2 }

    Write-Title 'FINAL HEALTH CHECK'
    $After = Show-Health
    $RequiredBroken = $After | Where-Object { $_.Name -in @('yt-dlp','ffmpeg','ffprobe') -and -not $_.Ok }
    if ($RequiredBroken) { throw 'Required tools are still missing or blocked after repair.' }

    $BundledAfter = Get-BundledHealth
    $BundledRequiredBroken = $BundledAfter | Where-Object { $_.Name -in @('yt-dlp','ffmpeg','ffprobe') -and -not $_.Ok }
    if ($BundledRequiredBroken) {
        $MissingNames = ($BundledRequiredBroken | ForEach-Object { $_.Name }) -join ', '
        throw ('Required tools are available on this computer but were not copied into the installer payload: ' + $MissingNames)
    }

    Write-Host 'Bundled payload tools:' -ForegroundColor Cyan
    $BundledAfter | Where-Object { $_.Name -in @('yt-dlp','ffmpeg','ffprobe') } |
        Select-Object Name, Ok, Version, Path | Format-Table -AutoSize | Out-Host
    Write-Host 'Tools are ready.' -ForegroundColor Green
    if (Test-Path -LiteralPath $BackupDir) { Write-Host ('Backup: ' + $BackupDir) -ForegroundColor Yellow }
}

try {
    Run-Main
} catch {
    Write-Host ''
    Write-Host ('TOOL PREPARATION FAILED: ' + $_.Exception.Message) -ForegroundColor Red
    if ($SoftFail) {
        Write-Host 'Dev mode will continue so Tool Center can be opened. Download/merge remains paused until required tools are approved.' -ForegroundColor Yellow
        exit 0
    }
    throw
} finally {
    if (Test-Path -LiteralPath $TempDir) {
        Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
