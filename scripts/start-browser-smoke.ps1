#Requires -Version 5.1
[CmdletBinding()]
param([string]$Chromium = (Join-Path $env:LOCALAPPDATA 'ms-playwright\chromium-1234\chrome-win64\chrome.exe'))
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
if (-not (Test-Path -LiteralPath $Chromium)) { throw 'Pass -Chromium with an existing Chromium or Chrome for Testing executable. This script downloads nothing.' }
$node = (Get-Command node.exe -ErrorAction Stop).Source
$parent = Join-Path $root 'artifacts\verification\browser-companion-2026-11-02'
New-Item -ItemType Directory -Path $parent -Force | Out-Null
$attempt = Join-Path $parent ('assisted-' + [guid]::NewGuid().ToString('N'))
$log = $attempt + '.stdout.log'
$scriptPath = Join-Path $PSScriptRoot 'browser-companion-smoke.mjs'
$smoke = Start-Process -FilePath $node -ArgumentList ('"' + $scriptPath + '"'),'--run-live-browser',('"' + $attempt + '"') -WindowStyle Hidden -PassThru -RedirectStandardOutput $log -RedirectStandardError ($attempt + '.stderr.log')
$registryPath = 'HKCU:\Software\Chromium\NativeMessagingHosts\com.roundtable.companion'
$previous = if (Test-Path $registryPath) { (Get-Item $registryPath).GetValue('') } else { $null }
$expectedManifest = Join-Path $attempt 'native-host\chromium\com.roundtable.companion.json'
try {
    $reportPath = Join-Path $attempt 'report.json'
    $deadline = (Get-Date).AddSeconds(20)
    while (-not (Test-Path -LiteralPath $reportPath)) { if ($smoke.HasExited -or (Get-Date) -gt $deadline) { throw 'The local smoke fixture did not start. Inspect the retained logs.' }; Start-Sleep -Milliseconds 100 }
    $report = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    & (Join-Path $PSScriptRoot 'install-browser-native-host.ps1') -Browser Chromium -RoundtableHome $report.home -HostRoot (Join-Path $attempt 'native-host')
    $extension = Join-Path $root 'companion'
    $profile = Join-Path $attempt 'browser-profile'
    Start-Process -FilePath $Chromium -ArgumentList ('--user-data-dir="' + $profile + '"'),('--load-extension="' + $extension + '"'),'--no-first-run','--no-default-browser-check',$report.fixtureUrl -WindowStyle Normal
    Write-Host 'In the isolated test browser: open Extensions, choose Roundtable Companion, Connect, then Share selected page.'
    Write-Host "Evidence: $attempt"
    if (-not $smoke.WaitForExit(600000)) { throw 'Browser acceptance is still pending; close the fixture process when finished.' }
    $result = Get-Content -LiteralPath $reportPath -Raw | ConvertFrom-Json
    Write-Output $result
    if (-not $result.passed) { throw 'Browser capture did not pass. The original report is retained.' }
} finally {
    if ((Test-Path $registryPath) -and (Get-Item $registryPath).GetValue('') -eq $expectedManifest) {
        if ($previous) { Set-Item -LiteralPath $registryPath -Value $previous }
        else { Remove-Item -LiteralPath $registryPath }
    }
}
