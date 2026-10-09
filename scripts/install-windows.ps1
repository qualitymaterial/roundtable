#Requires -Version 5.1
[CmdletBinding()]
param(
    [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\Roundtable'),
    [switch]$NoUserIntegration,
    [switch]$Launch
)
$ErrorActionPreference = 'Stop'
$sourceRoot = Split-Path $PSScriptRoot -Parent
$node = (Get-Command node.exe -ErrorAction Stop).Source
$npm = (Get-Command npm.cmd -ErrorAction Stop).Source
$nodeVersion = & $node --version
if ($LASTEXITCODE -ne 0 -or $nodeVersion -notmatch '^v(\d+)\.' -or [int]$Matches[1] -lt 24) { throw 'Install Node.js 24 or later, then retry.' }
if (-not (Test-Path -LiteralPath (Join-Path $sourceRoot 'dist\cli.js'))) {
    throw 'Build the checkout first: npm ci, then npm run build.'
}
$root = [IO.Path]::GetFullPath($InstallRoot)
# Each installation is independent of the checkout. Retain old releases for recovery.
$release = Join-Path $root ('releases\' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$bin = Join-Path $root 'bin'
New-Item -ItemType Directory -Force -Path $release, $bin | Out-Null
foreach ($entry in @('dist','docs','examples','LICENSE','package.json','package-lock.json')) {
    Copy-Item -LiteralPath (Join-Path $sourceRoot $entry) -Destination $release -Recurse
}
Get-ChildItem -LiteralPath $sourceRoot -Filter '*.md' -File | Copy-Item -Destination $release
Push-Location $release
try {
    & $npm ci --omit=dev --ignore-scripts --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { throw 'Runtime dependency installation failed. Existing launcher was not changed.' }
} finally { Pop-Location }
# Validate the copied application with isolated temporary data before switching launchers.
$checkHome = Join-Path $release 'install-check'
$oldHome = $env:ROUNDTABLE_HOME
try {
    $env:ROUNDTABLE_HOME = $checkHome
    & $node (Join-Path $release 'dist\cli.js') doctor
    if ($LASTEXITCODE -ne 0) { throw 'Installed application check failed. Existing launcher was not changed.' }
} finally { $env:ROUNDTABLE_HOME = $oldHome }
$launcher = Join-Path $bin 'roundtable.cmd'
# Escape cmd percent expansion in absolute paths; preserve caller cwd and exit status.
$nodeCmd = $node.Replace('%','%%')
$cliCmd = (Join-Path $release 'dist\cli.js').Replace('%','%%')
$launcherText = "@echo off`r`n`"$nodeCmd`" `"$cliCmd`" %*`r`nexit /b %errorlevel%`r`n"
$utf8 = New-Object Text.UTF8Encoding($false)
[IO.File]::WriteAllText(($launcher + '.new'), $launcherText, $utf8)
Move-Item -LiteralPath ($launcher + '.new') -Destination $launcher -Force
@{ release = $release; node = $node; installedAt = (Get-Date).ToString('o'); launcher = $launcher } |
    ConvertTo-Json | Set-Content -LiteralPath (Join-Path $root 'installation.json') -Encoding UTF8
if (-not $NoUserIntegration) {
    $userPath = [Environment]::GetEnvironmentVariable('Path','User')
    $parts = @($userPath -split ';' | Where-Object { $_ -and $_.TrimEnd('\') -ine $bin.TrimEnd('\') })
    [Environment]::SetEnvironmentVariable('Path', (($parts + $bin) -join ';'), 'User')
    $env:Path = $bin + ';' + $env:Path
    # Update only Roundtable's managed block. Preserve all other profile content.
    $documents = [Environment]::GetFolderPath('MyDocuments')
    $escapedLauncher = $launcher.Replace("'", "''")
    $block = "# BEGIN ROUNDTABLE LAUNCHER`r`nfunction global:roundtable { & '$escapedLauncher' @args }`r`n# END ROUNDTABLE LAUNCHER"
    foreach ($folder in @('WindowsPowerShell','PowerShell')) {
        $profileDir = Join-Path $documents $folder
        New-Item -ItemType Directory -Force -Path $profileDir | Out-Null
        $profileFile = Join-Path $profileDir 'profile.ps1'
        $content = if (Test-Path -LiteralPath $profileFile) { [IO.File]::ReadAllText($profileFile) } else { '' }
        if (Test-Path -LiteralPath $profileFile) {
            Copy-Item -LiteralPath $profileFile -Destination ($profileFile + '.roundtable-' + [guid]::NewGuid().ToString('N') + '.bak')
        }
        if ($content.Contains('# BEGIN ROUNDTABLE LAUNCHER')) {
            if (-not $content.Contains('# END ROUNDTABLE LAUNCHER')) { throw "Incomplete managed block in $profileFile; repair it before retrying." }
            $content = [regex]::Replace($content, '(?ms)^# BEGIN ROUNDTABLE LAUNCHER\r?\n.*?^# END ROUNDTABLE LAUNCHER', [Text.RegularExpressions.MatchEvaluator]{ param($match) $block })
        } else { $content = $content.TrimEnd() + "`r`n`r`n" + $block + "`r`n" }
        # UTF-8 BOM is needed for Windows PowerShell 5.1 to read non-ASCII paths.
        [IO.File]::WriteAllText($profileFile, $content, (New-Object Text.UTF8Encoding($true)))
    }
    Set-Item -Path Function:global:roundtable -Value ([scriptblock]::Create("& '$escapedLauncher' @args"))
}
Write-Host "Installed Roundtable: $launcher"
Write-Host 'Existing credentials, configuration and sessions were preserved.'
Write-Host 'Open a new PowerShell window and type roundtable from your project folder.'
if ($Launch) { & $launcher }
