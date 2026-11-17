$ErrorActionPreference = 'Stop'
$watchRoot = Split-Path $PSScriptRoot -Parent
$program = (Resolve-Path -LiteralPath (Join-Path $watchRoot 'bin\datebook.prg')).Path
$shell = New-Object -ComObject Shell.Application
$devices = @($shell.Namespace(17).Items() | Where-Object Name -eq 'Forerunner 165 Music')
if ($devices.Count -ne 1) { throw 'Connect exactly one Forerunner 165 Music over USB in MTP mode.' }
$internal = $devices[0].GetFolder.Items() | Where-Object Name -eq 'Internal Storage'
$garmin = $internal.GetFolder.Items() | Where-Object Name -eq 'GARMIN'
$apps = $garmin.GetFolder.Items() | Where-Object Name -eq 'APPS'
if ($null -eq $apps) { throw 'The watch GARMIN/APPS folder was not found.' }
# Copy only this app; never delete or replace another watch application.
$apps.GetFolder.CopyHere($program, 16 + 512 + 1024)
$checkRoot = Join-Path $watchRoot 'bin\device-check'
New-Item -ItemType Directory -Path $checkRoot -Force | Out-Null
$deadline = [DateTime]::UtcNow.AddSeconds(45)
do {
    Start-Sleep -Milliseconds 500
    $installed = $apps.GetFolder.Items() | Where-Object Name -eq 'datebook.prg'
} until ($null -ne $installed -or [DateTime]::UtcNow -gt $deadline)
if ($null -eq $installed) { throw 'Copy did not finish. Leave the watch connected and retry.' }
$shell.Namespace($checkRoot).CopyHere($installed, 16 + 512 + 1024)
$readback = Join-Path $checkRoot 'datebook.prg'
do { Start-Sleep -Milliseconds 500 } until ((Test-Path -LiteralPath $readback) -or [DateTime]::UtcNow -gt $deadline)
if (-not (Test-Path -LiteralPath $readback)) { throw 'Unable to read the installed file back for verification.' }
$expected = (Get-FileHash -Algorithm SHA256 -LiteralPath $program).Hash
$actual = (Get-FileHash -Algorithm SHA256 -LiteralPath $readback).Hash
if ($expected -ne $actual) { throw 'The installed binary does not match the release. Retry the copy.' }
Write-Output "Verified Datebook on Forerunner 165 Music: GARMIN/APPS/datebook.prg ($((Get-Item -LiteralPath $program).Length) bytes, SHA256 $actual)"
