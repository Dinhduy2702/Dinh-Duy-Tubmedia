[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$RequestPath,

    [Parameter(Mandatory = $true)]
    [string]$StatusPath,

    [Parameter(Mandatory = $true)]
    [string]$CancelPath
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

$Request = Get-Content -LiteralPath $RequestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$AllowedCategories = @(
    "userTemp",
    "thumbnailCache",
    "crashReports",
    "browserCache",
    "capcutCache",
    "zaloCache",
    "recycleBin",
    "windowsTemp",
    "windowsUpdate",
    "deliveryOptimization",
    "componentStore",
    "disableHibernate"
)

$Selected = @($Request.categories | ForEach-Object { [string]$_ })

foreach ($Category in $Selected) {
    if ($AllowedCategories -notcontains $Category) {
        throw "Hạng mục không được phép: $Category"
    }
}

if ($Request.mode -notin @("estimate", "clean")) {
    throw "Chế độ không hợp lệ."
}

$Scope = if (
    $Request.PSObject.Properties.Name -contains "scope"
) {
    [string]$Request.scope
}
else {
    "currentUser"
}

if ($Scope -notin @("currentUser", "wholeMachine")) {
    throw "Phạm vi quét không hợp lệ."
}

$Status = Get-Content -LiteralPath $StatusPath -Raw -Encoding UTF8 | ConvertFrom-Json
$Results = New-Object System.Collections.ArrayList
$GlobalErrors = New-Object System.Collections.ArrayList

function Save-Status {
    param(
        [string]$Phase,
        [int]$Progress,
        [string]$Message,
        [AllowNull()][string]$CurrentCategory
    )

    $Status.phase = $Phase
    $Status.progress = [Math]::Max(0, [Math]::Min(100, $Progress))
    $Status.message = $Message
    $Status.currentCategory = $CurrentCategory
    $Status.results = @($Results)
    $Status.errors = @($GlobalErrors)

    $estimated = 0L
    $removed = 0L
    $removedItems = 0
    $skippedItems = 0

    foreach ($Result in @($Results)) {
        $estimated += [int64]$Result.estimatedBytes
        $removed += [int64]$Result.removedBytes
        $removedItems += [int]$Result.removedItems
        $skippedItems += [int]$Result.skippedItems
    }

    $Status.estimatedBytes = $estimated
    $Status.removedBytes = $removed
    $Status.removedItems = $removedItems
    $Status.skippedItems = $skippedItems

    $Json = $Status | ConvertTo-Json -Depth 10
    [System.IO.File]::WriteAllText(
        $StatusPath,
        $Json,
        (New-Object System.Text.UTF8Encoding($false))
    )
}

function Test-Cancelled {
    if (Test-Path -LiteralPath $CancelPath) {
        Save-Status -Phase "cancelled" -Progress $Status.progress -Message "Đã dừng theo yêu cầu của người dùng." -CurrentCategory $null
        $Status.completedAt = [DateTime]::UtcNow.ToString("o")
        Save-Status -Phase "cancelled" -Progress $Status.progress -Message "Đã dừng theo yêu cầu của người dùng." -CurrentCategory $null
        exit 0
    }
}

function Get-DriveState {
    $Drive = Get-PSDrive -Name C -ErrorAction SilentlyContinue

    if ($null -eq $Drive) {
        return $null
    }

    return @{
        freeBytes = [int64]$Drive.Free
        totalBytes = [int64]($Drive.Free + $Drive.Used)
    }
}

function Normalize-Path {
    param([string]$Path)

    if ([string]::IsNullOrWhiteSpace($Path)) {
        return $null
    }

    try {
        return [System.IO.Path]::GetFullPath(
            [Environment]::ExpandEnvironmentVariables($Path)
        ).TrimEnd("\")
    }
    catch {
        return $null
    }
}

function Assert-SafeTarget {
    param([string]$Path)

    $Resolved = Normalize-Path -Path $Path

    if ([string]::IsNullOrWhiteSpace($Resolved)) {
        throw "Đường dẫn dọn dẹp không hợp lệ."
    }

    $Blocked = @(
        (Normalize-Path $env:SystemDrive),
        (Normalize-Path $env:WINDIR),
        (Normalize-Path (Join-Path $env:SystemDrive "Users")),
        (Normalize-Path $env:USERPROFILE),
        (Normalize-Path $env:LOCALAPPDATA),
        (Normalize-Path $env:APPDATA),
        (Normalize-Path $env:ProgramData),
        (Normalize-Path $env:ProgramFiles),
        (Normalize-Path ${env:ProgramFiles(x86)})
    ) | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }

    foreach ($BlockedPath in $Blocked) {
        if ($Resolved.Equals($BlockedPath, [StringComparison]::OrdinalIgnoreCase)) {
            throw "Đã chặn đường dẫn quá rộng/nguy hiểm: $Resolved"
        }
    }

    if ($Resolved -match "(?i)Zalo Received Files") {
        throw "Đã chặn Zalo Received Files."
    }

    return $Resolved
}

function Get-UserProfileRoots {
    if ($Scope -ne "wholeMachine") {
        return @($env:USERPROFILE)
    }

    $UsersRoot = Join-Path $env:SystemDrive "Users"

    if (-not (Test-Path -LiteralPath $UsersRoot -PathType Container)) {
        return @($env:USERPROFILE)
    }

    $BlockedNames = @(
        "All Users",
        "Default",
        "Default User",
        "Public",
        "defaultuser0",
        "WDAGUtilityAccount"
    )

    $Profiles = @(
        Get-ChildItem `
            -LiteralPath $UsersRoot `
            -Directory `
            -Force `
            -ErrorAction SilentlyContinue |
            Where-Object {
                $BlockedNames -notcontains $_.Name -and
                (Test-Path -LiteralPath (Join-Path $_.FullName "AppData") -PathType Container)
            } |
            ForEach-Object {
                $_.FullName
            }
    )

    if ($Profiles.Count -eq 0) {
        return @($env:USERPROFILE)
    }

    return $Profiles
}

function Get-FixedDriveRoots {
    $Roots = @(
        Get-CimInstance `
            -ClassName Win32_LogicalDisk `
            -Filter "DriveType=3" `
            -ErrorAction SilentlyContinue |
            ForEach-Object {
                ([string]$_.DeviceID).TrimEnd("\") + "\"
            }
    )

    if ($Roots.Count -eq 0) {
        return @($env:SystemDrive + "\")
    }

    return $Roots
}

function New-CleanupTarget {
    param(
        [string]$Path,
        [string[]]$Patterns = @("*"),
        [bool]$DeleteSubdirectories = $true
    )

    return [pscustomobject]@{
        Path = $Path
        Patterns = $Patterns
        DeleteSubdirectories = $DeleteSubdirectories
    }
}

function Get-WholeMachineCacheTargets {
    param([string]$Category)

    if ($Scope -ne "wholeMachine") {
        return @()
    }

    $Targets = @()

    foreach ($ProfileRoot in @(Get-UserProfileRoots)) {
        $LocalRoot = Join-Path $ProfileRoot "AppData\Local"
        $RoamingRoot = Join-Path $ProfileRoot "AppData\Roaming"

        switch ($Category) {
            "userTemp" {
                $Targets += New-CleanupTarget -Path (Join-Path $LocalRoot "Temp")
            }

            "thumbnailCache" {
                $Targets += New-CleanupTarget `
                    -Path (Join-Path $LocalRoot "Microsoft\Windows\Explorer") `
                    -Patterns @("thumbcache_*.db", "iconcache_*.db") `
                    -DeleteSubdirectories $false
            }

            "crashReports" {
                $Targets += New-CleanupTarget -Path (Join-Path $LocalRoot "CrashDumps")
            }

            "browserCache" {
                foreach ($BrowserRoot in @(
                    (Join-Path $LocalRoot "Google\Chrome\User Data"),
                    (Join-Path $LocalRoot "Microsoft\Edge\User Data")
                )) {
                    if (-not (Test-Path -LiteralPath $BrowserRoot -PathType Container)) {
                        continue
                    }

                    foreach ($BrowserProfile in @(
                        Get-ChildItem `
                            -LiteralPath $BrowserRoot `
                            -Directory `
                            -Force `
                            -ErrorAction SilentlyContinue |
                            Where-Object {
                                $_.Name -eq "Default" -or
                                $_.Name -like "Profile *"
                            }
                    )) {
                        foreach ($Relative in @(
                            "Cache",
                            "Code Cache",
                            "GPUCache",
                            "DawnCache",
                            "GrShaderCache"
                        )) {
                            $Targets += New-CleanupTarget `
                                -Path (Join-Path $BrowserProfile.FullName $Relative)
                        }
                    }
                }
            }

            "capcutCache" {
                foreach ($Candidate in @(
                    (Join-Path $LocalRoot "CapCut\User Data\Cache"),
                    (Join-Path $LocalRoot "CapCut\User Data\Code Cache"),
                    (Join-Path $LocalRoot "CapCut\User Data\GPUCache"),
                    (Join-Path $LocalRoot "CapCut\User Data\ShaderCache"),
                    (Join-Path $LocalRoot "CapCut\Cache"),
                    (Join-Path $LocalRoot "CapCut\Temp"),
                    (Join-Path $LocalRoot "CapCut\Logs"),
                    (Join-Path $LocalRoot "CapCut\Crashpad"),
                    (Join-Path $RoamingRoot "CapCut\Cache"),
                    (Join-Path $RoamingRoot "CapCut\Temp"),
                    (Join-Path $RoamingRoot "CapCut\Logs"),
                    (Join-Path $LocalRoot "ByteDance\Cache"),
                    (Join-Path $LocalRoot "ByteDance\Temp"),
                    (Join-Path $LocalRoot "ByteDance\Logs"),
                    (Join-Path $LocalRoot "Temp\CapCut"),
                    (Join-Path $LocalRoot "Temp\ByteDance")
                )) {
                    $Targets += New-CleanupTarget -Path $Candidate
                }
            }

            "zaloCache" {
                foreach ($Candidate in @(
                    (Join-Path $LocalRoot "Zalo\Cache"),
                    (Join-Path $LocalRoot "Zalo\Temp"),
                    (Join-Path $LocalRoot "Zalo\Logs"),
                    (Join-Path $RoamingRoot "Zalo\Cache"),
                    (Join-Path $RoamingRoot "Zalo\Temp"),
                    (Join-Path $RoamingRoot "Zalo\Logs"),
                    (Join-Path $LocalRoot "Programs\Zalo\temp"),
                    (Join-Path $LocalRoot "Programs\Zalo\logs"),
                    (Join-Path $LocalRoot "ZaloPC\Cache"),
                    (Join-Path $LocalRoot "ZaloPC\temp"),
                    (Join-Path $LocalRoot "ZaloPC\logs"),
                    (Join-Path $RoamingRoot "ZaloPC\Cache"),
                    (Join-Path $RoamingRoot "ZaloPC\temp"),
                    (Join-Path $RoamingRoot "ZaloPC\logs")
                )) {
                    $Targets += New-CleanupTarget -Path $Candidate
                }
            }
        }
    }

    if ($Category -eq "crashReports") {
        foreach ($SystemCrashPath in @(
            (Join-Path $env:WINDIR "Minidump"),
            (Join-Path $env:ProgramData "Microsoft\Windows\WER\ReportArchive"),
            (Join-Path $env:ProgramData "Microsoft\Windows\WER\ReportQueue"),
            (Join-Path $env:ProgramData "Microsoft\Windows\WER\Temp")
        )) {
            $Targets += New-CleanupTarget -Path $SystemCrashPath
        }
    }

    return @(
        $Targets |
            Group-Object Path |
            ForEach-Object {
                $_.Group[0]
            }
    )
}

function Get-CategoryTargets {
    param([string]$Category)

    $ProfileCategories = @(
        "userTemp",
        "thumbnailCache",
        "crashReports",
        "browserCache",
        "capcutCache",
        "zaloCache"
    )

    if (
        $Scope -eq "wholeMachine" -and
        $ProfileCategories -contains $Category
    ) {
        return @(Get-WholeMachineCacheTargets -Category $Category)
    }

    return @(Get-CacheTargets -Category $Category)
}

function Get-CacheTargets {
    param([string]$Category)

    $Targets = New-Object System.Collections.ArrayList

    function Add-Target {
        param(
            [string]$Path,
            [string[]]$Patterns = @("*"),
            [bool]$DeleteSubdirectories = $true
        )

        if (-not [string]::IsNullOrWhiteSpace($Path)) {
            [void]$Targets.Add([pscustomobject]@{
                Path = $Path
                Patterns = $Patterns
                DeleteSubdirectories = $DeleteSubdirectories
            })
        }
    }

    switch ($Category) {
        "userTemp" {
            Add-Target -Path $env:TEMP
            Add-Target -Path (Join-Path $env:LOCALAPPDATA "Temp")
        }

        "thumbnailCache" {
            Add-Target `
                -Path (Join-Path $env:LOCALAPPDATA "Microsoft\Windows\Explorer") `
                -Patterns @("thumbcache_*.db", "iconcache_*.db") `
                -DeleteSubdirectories $false
        }

        "crashReports" {
            Add-Target -Path (Join-Path $env:LOCALAPPDATA "CrashDumps")
            Add-Target -Path (Join-Path $env:WINDIR "Minidump")
            Add-Target -Path (Join-Path $env:ProgramData "Microsoft\Windows\WER\ReportArchive")
            Add-Target -Path (Join-Path $env:ProgramData "Microsoft\Windows\WER\ReportQueue")
            Add-Target -Path (Join-Path $env:ProgramData "Microsoft\Windows\WER\Temp")
        }

        "browserCache" {
            foreach ($BrowserRoot in @(
                (Join-Path $env:LOCALAPPDATA "Google\Chrome\User Data"),
                (Join-Path $env:LOCALAPPDATA "Microsoft\Edge\User Data")
            )) {
                if (-not (Test-Path -LiteralPath $BrowserRoot)) {
                    continue
                }

                $Profiles = Get-ChildItem -LiteralPath $BrowserRoot -Directory -Force -ErrorAction SilentlyContinue |
                    Where-Object { $_.Name -eq "Default" -or $_.Name -like "Profile *" }

                foreach ($Profile in $Profiles) {
                    foreach ($Relative in @(
                        "Cache",
                        "Code Cache",
                        "GPUCache",
                        "DawnCache",
                        "GrShaderCache"
                    )) {
                        Add-Target -Path (Join-Path $Profile.FullName $Relative)
                    }
                }
            }
        }

        "capcutCache" {
            foreach ($Path in @(
                (Join-Path $env:LOCALAPPDATA "CapCut\User Data\Cache"),
                (Join-Path $env:LOCALAPPDATA "CapCut\User Data\Code Cache"),
                (Join-Path $env:LOCALAPPDATA "CapCut\User Data\GPUCache"),
                (Join-Path $env:LOCALAPPDATA "CapCut\User Data\ShaderCache"),
                (Join-Path $env:LOCALAPPDATA "CapCut\Cache"),
                (Join-Path $env:LOCALAPPDATA "CapCut\Temp"),
                (Join-Path $env:LOCALAPPDATA "CapCut\Logs"),
                (Join-Path $env:LOCALAPPDATA "CapCut\Crashpad"),
                (Join-Path $env:APPDATA "CapCut\Cache"),
                (Join-Path $env:APPDATA "CapCut\Temp"),
                (Join-Path $env:APPDATA "CapCut\Logs"),
                (Join-Path $env:LOCALAPPDATA "ByteDance\Cache"),
                (Join-Path $env:LOCALAPPDATA "ByteDance\Temp"),
                (Join-Path $env:LOCALAPPDATA "ByteDance\Logs"),
                (Join-Path $env:TEMP "CapCut"),
                (Join-Path $env:TEMP "ByteDance")
            )) {
                Add-Target -Path $Path
            }
        }

        "zaloCache" {
            foreach ($Path in @(
                (Join-Path $env:LOCALAPPDATA "Zalo\Cache"),
                (Join-Path $env:LOCALAPPDATA "Zalo\Temp"),
                (Join-Path $env:LOCALAPPDATA "Zalo\Logs"),
                (Join-Path $env:APPDATA "Zalo\Cache"),
                (Join-Path $env:APPDATA "Zalo\Temp"),
                (Join-Path $env:APPDATA "Zalo\Logs"),
                (Join-Path $env:LOCALAPPDATA "Programs\Zalo\temp"),
                (Join-Path $env:LOCALAPPDATA "Programs\Zalo\logs"),
                (Join-Path $env:LOCALAPPDATA "ZaloPC\Cache"),
                (Join-Path $env:LOCALAPPDATA "ZaloPC\temp"),
                (Join-Path $env:LOCALAPPDATA "ZaloPC\logs"),
                (Join-Path $env:APPDATA "ZaloPC\Cache"),
                (Join-Path $env:APPDATA "ZaloPC\temp"),
                (Join-Path $env:APPDATA "ZaloPC\logs")
            )) {
                Add-Target -Path $Path
            }
        }

        "windowsTemp" {
            Add-Target -Path (Join-Path $env:WINDIR "Temp")
        }

        "windowsUpdate" {
            Add-Target -Path (Join-Path $env:WINDIR "SoftwareDistribution\Download")
        }

        "deliveryOptimization" {
            Add-Target -Path (
                Join-Path $env:WINDIR `
                    "ServiceProfiles\NetworkService\AppData\Local\Microsoft\Windows\DeliveryOptimization\Cache"
            )
        }
    }

    return @($Targets)
}

function Process-Target {
    param(
        [Parameter(Mandatory = $true)]
        $Target,

        [Parameter(Mandatory = $true)]
        [bool]$Delete
    )

    $SafePath = Assert-SafeTarget -Path ([string]$Target.Path)

    if (-not (Test-Path -LiteralPath $SafePath)) {
        return @{
            estimatedBytes = 0L
            removedBytes = 0L
            removedItems = 0
            skippedItems = 0
            errors = @()
        }
    }

    $Patterns = @($Target.Patterns)
    $DeleteSubdirectories = [bool]$Target.DeleteSubdirectories
    $Files = New-Object System.Collections.ArrayList
    $Directories = New-Object System.Collections.ArrayList
    $Errors = New-Object System.Collections.ArrayList

    if ($Patterns.Count -eq 1 -and $Patterns[0] -eq "*") {
        foreach ($File in @(Get-ChildItem -LiteralPath $SafePath -Force -File -Recurse -ErrorAction SilentlyContinue)) {
            [void]$Files.Add($File)
        }

        if ($DeleteSubdirectories) {
            foreach ($Directory in @(
                Get-ChildItem -LiteralPath $SafePath -Force -Directory -Recurse -ErrorAction SilentlyContinue |
                    Sort-Object FullName -Descending
            )) {
                [void]$Directories.Add($Directory)
            }
        }
    }
    else {
        foreach ($Pattern in $Patterns) {
            foreach ($File in @(
                Get-ChildItem -LiteralPath $SafePath -Force -File -Filter $Pattern -ErrorAction SilentlyContinue
            )) {
                [void]$Files.Add($File)
            }
        }
    }

    $EstimatedBytes = 0L
    $RemovedBytes = 0L
    $RemovedItems = 0
    $SkippedItems = 0
    $Index = 0

    foreach ($File in @($Files)) {
        $Index++

        if (($Index % 100) -eq 0) {
            Test-Cancelled
        }

        $Length = 0L

        try {
            $Length = [int64]$File.Length
        }
        catch {}

        $EstimatedBytes += $Length

        if (-not $Delete) {
            continue
        }

        try {
            Remove-Item -LiteralPath $File.FullName -Force -ErrorAction Stop
            $RemovedBytes += $Length
            $RemovedItems++
        }
        catch {
            $SkippedItems++
        }
    }

    if ($Delete -and $DeleteSubdirectories) {
        foreach ($Directory in @($Directories)) {
            try {
                Remove-Item -LiteralPath $Directory.FullName -Force -Recurse -ErrorAction Stop
                $RemovedItems++
            }
            catch {
                $SkippedItems++
            }
        }
    }

    return @{
        estimatedBytes = $EstimatedBytes
        removedBytes = $RemovedBytes
        removedItems = $RemovedItems
        skippedItems = $SkippedItems
        errors = @($Errors)
    }
}

function Invoke-CacheCategory {
    param(
        [string]$Category,
        [bool]$Delete
    )

    $Summary = @{
        estimatedBytes = 0L
        removedBytes = 0L
        removedItems = 0
        skippedItems = 0
        errors = New-Object System.Collections.ArrayList
    }

    foreach ($Target in @(Get-CategoryTargets -Category $Category)) {
        Test-Cancelled

        try {
            $Result = Process-Target -Target $Target -Delete $Delete
            $Summary.estimatedBytes += [int64]$Result.estimatedBytes
            $Summary.removedBytes += [int64]$Result.removedBytes
            $Summary.removedItems += [int]$Result.removedItems
            $Summary.skippedItems += [int]$Result.skippedItems

            foreach ($ErrorText in @($Result.errors)) {
                [void]$Summary.errors.Add([string]$ErrorText)
            }
        }
        catch {
            [void]$Summary.errors.Add($_.Exception.Message)
        }
    }

    return $Summary
}

function Invoke-RecycleBinCleanup {
    param([bool]$Delete)

    $Summary = @{
        estimatedBytes = 0L
        removedBytes = 0L
        removedItems = 0
        skippedItems = 0
        errors = New-Object System.Collections.ArrayList
    }

    $DriveRoots = if ($Scope -eq "wholeMachine") {
        @(Get-FixedDriveRoots)
    }
    else {
        @($env:SystemDrive + "\")
    }

    foreach ($DriveRoot in $DriveRoots) {
        $RecyclePath = Join-Path $DriveRoot '$Recycle.Bin'
        $Target = New-CleanupTarget -Path $RecyclePath

        try {
            $Result = Process-Target -Target $Target -Delete $false
            $Summary.estimatedBytes += [int64]$Result.estimatedBytes
        }
        catch {
            [void]$Summary.errors.Add($_.Exception.Message)
        }
    }

    if ($Delete) {
        try {
            Clear-RecycleBin -Force -ErrorAction Stop
            $Summary.removedBytes = [int64]$Summary.estimatedBytes
            $Summary.removedItems = 1
        }
        catch {
            [void]$Summary.errors.Add($_.Exception.Message)
        }
    }

    return $Summary
}

function Invoke-WindowsUpdateCleanup {
    param([bool]$Delete)

    if (-not $Delete) {
        return Invoke-CacheCategory -Category "windowsUpdate" -Delete $false
    }

    $Services = @("wuauserv", "bits", "dosvc")
    $WasRunning = @{}

    try {
        foreach ($ServiceName in $Services) {
            $Service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

            if ($null -eq $Service) {
                continue
            }

            $WasRunning[$ServiceName] = $Service.Status -eq "Running"

            if ($Service.Status -eq "Running") {
                Stop-Service -Name $ServiceName -Force -ErrorAction SilentlyContinue
            }
        }

        return Invoke-CacheCategory -Category "windowsUpdate" -Delete $true
    }
    finally {
        foreach ($ServiceName in $Services) {
            if ($WasRunning[$ServiceName]) {
                Start-Service -Name $ServiceName -ErrorAction SilentlyContinue
            }
        }
    }
}

function New-CategoryResult {
    param(
        [string]$Id,
        $Summary
    )

    return [pscustomobject]@{
        id = $Id
        estimatedBytes = [int64]$Summary.estimatedBytes
        removedBytes = [int64]$Summary.removedBytes
        removedItems = [int]$Summary.removedItems
        skippedItems = [int]$Summary.skippedItems
        errors = @($Summary.errors)
    }
}

try {
    $Status.driveBefore = Get-DriveState
    $Phase = if ($Request.mode -eq "clean") { "cleaning" } else { "scanning" }
    Save-Status -Phase $Phase -Progress 1 -Message "Đang bắt đầu quét hệ thống." -CurrentCategory $null

    $Total = [Math]::Max(1, $Selected.Count)
    $Processed = 0

    foreach ($Category in $Selected) {
        Test-Cancelled

        $Progress = [int](($Processed / $Total) * 100)
        $ActionText = if ($Request.mode -eq "clean") { "Đang dọn" } else { "Đang quét" }

        Save-Status `
            -Phase $Phase `
            -Progress $Progress `
            -Message "${ActionText}: $Category" `
            -CurrentCategory $Category

        $Delete = $Request.mode -eq "clean"

        switch ($Category) {
            "windowsUpdate" {
                $Summary = Invoke-WindowsUpdateCleanup -Delete $Delete
            }

            "recycleBin" {
                $Summary = Invoke-RecycleBinCleanup -Delete $Delete
            }

            "componentStore" {
                $Summary = @{
                    estimatedBytes = 0L
                    removedBytes = 0L
                    removedItems = 0
                    skippedItems = 0
                    errors = @()
                }

                if ($Delete) {
                    $Process = Start-Process `
                        -FilePath (Join-Path $env:WINDIR "System32\dism.exe") `
                        -ArgumentList @(
                            "/Online",
                            "/Cleanup-Image",
                            "/StartComponentCleanup"
                        ) `
                        -Wait `
                        -PassThru `
                        -WindowStyle Hidden

                    if ($Process.ExitCode -ne 0) {
                        $Summary.errors = @("DISM trả mã $($Process.ExitCode).")
                    }
                    else {
                        $Summary.removedItems = 1
                    }
                }
            }

            "disableHibernate" {
                $Summary = @{
                    estimatedBytes = 0L
                    removedBytes = 0L
                    removedItems = 0
                    skippedItems = 0
                    errors = @()
                }

                if ($Delete) {
                    $Process = Start-Process `
                        -FilePath (Join-Path $env:WINDIR "System32\powercfg.exe") `
                        -ArgumentList @("-h", "off") `
                        -Wait `
                        -PassThru `
                        -WindowStyle Hidden

                    if ($Process.ExitCode -ne 0) {
                        $Summary.errors = @("powercfg trả mã $($Process.ExitCode).")
                    }
                    else {
                        $Summary.removedItems = 1
                    }
                }
            }

            default {
                $Summary = Invoke-CacheCategory -Category $Category -Delete $Delete
            }
        }

        $Result = New-CategoryResult -Id $Category -Summary $Summary
        [void]$Results.Add($Result)

        foreach ($ErrorText in @($Result.errors)) {
            [void]$GlobalErrors.Add("${Category}: $ErrorText")
        }

        $Processed++
        $Status.processedCategories = $Processed

        Save-Status `
            -Phase $Phase `
            -Progress ([int](($Processed / $Total) * 100)) `
            -Message "Đã xử lý $Processed/$Total hạng mục." `
            -CurrentCategory $Category
    }

    $Status.driveAfter = Get-DriveState
    $Status.completedAt = [DateTime]::UtcNow.ToString("o")

    $FinalMessage = if ($Request.mode -eq "clean") {
        "Đã hoàn tất dọn dẹp hệ thống."
    }
    else {
        "Đã hoàn tất quét dung lượng."
    }

    Save-Status -Phase "completed" -Progress 100 -Message $FinalMessage -CurrentCategory $null
    exit 0
}
catch {
    [void]$GlobalErrors.Add($_.Exception.Message)
    $Status.completedAt = [DateTime]::UtcNow.ToString("o")
    Save-Status -Phase "failed" -Progress $Status.progress -Message $_.Exception.Message -CurrentCategory $null
    exit 1
}
