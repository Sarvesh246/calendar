param([switch]$TestBuild)
$ErrorActionPreference = 'Stop'
$watchRoot = Split-Path $PSScriptRoot -Parent
$sdkRoot = (Get-Content -LiteralPath (Join-Path $env:APPDATA 'Garmin\ConnectIQ\current-sdk.cfg') -Raw).Trim()
Push-Location $watchRoot
try {
    node tools/bootstrap.mjs
    if ($LASTEXITCODE -ne 0) { throw 'Watch configuration failed.' }
    $outputName = if ($TestBuild) { 'datebook-test.prg' } else { 'datebook.prg' }
    $buildArgs = @('-jar', (Join-Path $sdkRoot 'bin\monkeybrains.jar'), '-o', "bin/$outputName", '-f', 'monkey.jungle', '-y', 'developer_key.der', '-d', 'fr165m', '-w')
    if ($TestBuild) { $buildArgs += '--unit-test' } else { $buildArgs += '-r' }
    & java @buildArgs
    if ($LASTEXITCODE -ne 0) { throw 'Garmin compilation failed.' }
    Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $watchRoot "bin/$outputName")
} finally { Pop-Location }
