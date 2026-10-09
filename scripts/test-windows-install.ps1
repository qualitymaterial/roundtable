#Requires -Version 5.1
$ErrorActionPreference = 'Stop'
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('Roundtable install test ' + [guid]::NewGuid().ToString('N'))
$installRoot = Join-Path $testRoot 'application'
$workspace = Join-Path $testRoot 'different project'
New-Item -ItemType Directory -Path $workspace -Force | Out-Null
& (Join-Path $PSScriptRoot 'install-windows.ps1') -InstallRoot $installRoot -NoUserIntegration
$launcher = Join-Path $installRoot 'bin\roundtable.cmd'
$manifest = Get-Content -LiteralPath (Join-Path $installRoot 'installation.json') -Raw | ConvertFrom-Json
if ((Get-Item -LiteralPath $manifest.release).Attributes -band [IO.FileAttributes]::ReparsePoint) { throw 'Release must not be a development link.' }
foreach ($excluded in @('.roundtable','.env','auth.json')) {
    if (Test-Path -LiteralPath (Join-Path $manifest.release $excluded)) { throw "Private data was copied: $excluded" }
}
$oldPath = $env:Path
$oldHome = $env:ROUNDTABLE_HOME
Push-Location $workspace
try {
    # Neither npm nor Node nor the source checkout is on PATH.
    $env:Path = "$env:SystemRoot\System32;$env:SystemRoot"
    $env:ROUNDTABLE_HOME = Join-Path $testRoot 'private data'
    $doctor = & $launcher doctor
    if ($LASTEXITCODE -ne 0) { throw 'Absolute launcher failed without npm/Node on PATH.' }
    $info = ($doctor -join "`n") | ConvertFrom-Json
    if ($info.sqlite -ne 'connected' -or $info.home -ne $env:ROUNDTABLE_HOME) { throw 'Doctor did not use the expected runtime.' }
    $version = & $launcher --version
    if ($LASTEXITCODE -ne 0 -or $version -ne $info.version) { throw 'Installed version command failed.' }
    $releases = ((& $launcher releases) -join "`n") | ConvertFrom-Json
    if ($LASTEXITCODE -ne 0 -or @($releases).Count -lt 1) { throw 'Release discovery failed.' }
    & $launcher rollback (Split-Path $manifest.release -Leaf)
    if ($LASTEXITCODE -ne 0) { throw 'Switching to a validated release failed.' }
    # Invalid installed candidates must not replace the known-working launcher.
    $beforeLauncher = [IO.File]::ReadAllText($launcher)
    $broken = Join-Path $installRoot 'releases\broken-fixture'
    New-Item -ItemType Directory -Path (Join-Path $broken 'dist') -Force | Out-Null
    [IO.File]::WriteAllText((Join-Path $broken 'package.json'), '{"version":"broken-fixture"}')
    [IO.File]::WriteAllText((Join-Path $broken 'dist\cli.js'), 'process.exit(42)')
    & $launcher rollback broken-fixture
    if ($LASTEXITCODE -eq 0 -or [IO.File]::ReadAllText($launcher) -ne $beforeLauncher) { throw 'Failed release validation changed launcher.' }
    & $launcher demo
    if ($LASTEXITCODE -ne 0) { throw 'Standalone demo failed.' }
    & $launcher session list
    if ($LASTEXITCODE -ne 0) { throw 'Fresh-process session recovery failed.' }
    if ((Get-Location).Path -ne $workspace) { throw 'Launcher changed the working folder.' }
} finally {
    Pop-Location
    $env:Path = $oldPath
    $env:ROUNDTABLE_HOME = $oldHome
}
Write-Host "PASS: independent install, private-data exclusion, launch without npm/Node PATH, version, release activation, rejected invalid release, demo, restart, caller cwd. Evidence retained: $testRoot"
