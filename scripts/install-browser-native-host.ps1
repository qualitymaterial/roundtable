#Requires -Version 5.1
[CmdletBinding()]
param(
    [ValidateSet('Chrome','Edge','Chromium')][string]$Browser = 'Chrome',
    [string]$RoundtableHome,
    [string]$ExtensionId = 'egkfedophfeojpgaoifcemhapmfohnhk',
    [string]$HostRoot = (Join-Path $env:LOCALAPPDATA 'Programs\RoundtableBrowserHost')
)
$ErrorActionPreference = 'Stop'
if ($ExtensionId -notmatch '^[a-p]{32}$') { throw 'Supply the exact 32-character unpacked extension ID.' }
$sourceRoot = Split-Path $PSScriptRoot -Parent
$hostScript = Join-Path $sourceRoot 'dist\browser-native-host.js'
if (-not (Test-Path -LiteralPath $hostScript)) { throw 'Build this checkout before installing the native host.' }
if (-not $RoundtableHome) {
    $RoundtableHome = Join-Path $env:USERPROFILE '.roundtable'
    $configPath = Join-Path $RoundtableHome 'config.json'
    if ($env:ROUNDTABLE_HOME) { $RoundtableHome = $env:ROUNDTABLE_HOME }
    elseif (Test-Path -LiteralPath $configPath) { $RoundtableHome = (Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json).dataDir }
}
$RoundtableHome = [IO.Path]::GetFullPath($RoundtableHome)
$hostDirectory = Join-Path ([IO.Path]::GetFullPath($HostRoot)) $Browser.ToLowerInvariant()
New-Item -ItemType Directory -Path $hostDirectory -Force | Out-Null
$launcher = Join-Path $hostDirectory 'roundtable-browser-host.cmd'
$nodePath = (Get-Command node.exe -ErrorAction Stop).Source
foreach ($part in @($nodePath,$hostScript,$RoundtableHome)) { if ($part.Contains('"') -or $part.Contains("`r") -or $part.Contains("`n")) { throw 'Invalid native host path.' } }
$nodeCmd = $nodePath.Replace('%','%%')
$scriptCmd = $hostScript.Replace('%','%%')
$homeCmd = $RoundtableHome.Replace('%','%%')
$utf8 = New-Object Text.UTF8Encoding($false)
if (Test-Path -LiteralPath $launcher) { Copy-Item -LiteralPath $launcher -Destination ($launcher + '.before-' + [guid]::NewGuid().ToString('N')) }
[IO.File]::WriteAllText($launcher, "@echo off`r`n`"$nodeCmd`" `"$scriptCmd`" `"$homeCmd`" %*`r`nexit /b %errorlevel%`r`n", $utf8)
$manifestPath = Join-Path $hostDirectory 'com.roundtable.companion.json'
$manifest = @{ name='com.roundtable.companion'; description='Roundtable read-only local browser companion'; path=$launcher; type='stdio'; allowed_origins=@("chrome-extension://$ExtensionId/") }
if (Test-Path -LiteralPath $manifestPath) { Copy-Item -LiteralPath $manifestPath -Destination ($manifestPath + '.before-' + [guid]::NewGuid().ToString('N')) }
[IO.File]::WriteAllText($manifestPath, ($manifest | ConvertTo-Json -Depth 4), $utf8)
$vendor = if ($Browser -eq 'Chrome') { 'Google\Chrome' } elseif ($Browser -eq 'Edge') { 'Microsoft\Edge' } else { 'Chromium' }
$registryPath = "HKCU:\Software\$vendor\NativeMessagingHosts\com.roundtable.companion"
$previous = if (Test-Path $registryPath) { (Get-Item $registryPath).GetValue('') } else { $null }
@{ browser=$Browser; previousManifest=$previous; manifest=$manifestPath; home=$RoundtableHome; extensionId=$ExtensionId } | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $hostDirectory ('registration-' + [guid]::NewGuid().ToString('N') + '.json')) -Encoding utf8
New-Item -Path $registryPath -Force | Out-Null
Set-Item -LiteralPath $registryPath -Value $manifestPath
Write-Output "Native host registered for $Browser. Load the companion folder as an unpacked extension, then run roundtable browser."
Write-Output "Manifest: $manifestPath"
Write-Output "Extension ID: $ExtensionId"
