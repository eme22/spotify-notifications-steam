$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rustDir = Join-Path $scriptDir "backend\mediadaemon-rust"
$outputExe = Join-Path $scriptDir "backend\mediadaemon.exe"
$devMarker = Join-Path $scriptDir "backend\.daemon-dev"
$logFile = Join-Path $scriptDir "backend\media-daemon.log"
$steamTarget = "C:\Program Files (x86)\Steam\millennium\plugins\spotify-notifications-steam"

Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Spotify Notifications - PROD DEPLOY" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan

# 1. Build Rust daemon (release mode)
Write-Host "`n[1/4] Building MediaDaemon (release)..." -ForegroundColor Green
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','User') + ';' + [System.Environment]::GetEnvironmentVariable('Path','Machine')

Push-Location -Path $rustDir
$buildOutput = cmd /c "cargo build --release 2>&1"
$buildResult = $LASTEXITCODE
Pop-Location

if ($buildResult -ne 0) {
    Write-Host "Rust daemon build FAILED!" -ForegroundColor Red
    Write-Host $buildOutput
    exit 1
}
Copy-Item (Join-Path $rustDir "target\release\mediadaemon.exe") $outputExe -Force
Write-Host "  -> backend\mediadaemon.exe (release, stripped)" -ForegroundColor Green

# 2. Remove .daemon-dev marker, clean old log
Write-Host "`n[2/4] Configuring prod mode..." -ForegroundColor Green
if (Test-Path $devMarker) { Remove-Item $devMarker -Force }
if (Test-Path $logFile) { Remove-Item $logFile -Force }
Write-Host "  -> .daemon-dev marker removed" -ForegroundColor Green

# 3. Build frontend (prod)
Write-Host "`n[3/4] Building frontend (prod)..." -ForegroundColor Green
Push-Location -Path $scriptDir
$frontendOutput = cmd /c "npm run build 2>&1"
$frontendResult = $LASTEXITCODE
Pop-Location

if ($frontendResult -ne 0) {
    Write-Host "Frontend build FAILED!" -ForegroundColor Red
    Write-Host $frontendOutput
    exit 1
}
Write-Host "  -> .millennium\Dist\index.js (prod)" -ForegroundColor Green

# 4. Copy to Steam plugins directory (clean, no source code)
Write-Host "`n[4/4] Deploying to Steam..." -ForegroundColor Green
if (Test-Path $steamTarget) { Remove-Item $steamTarget -Recurse -Force }
New-Item -ItemType Directory -Path $steamTarget -Force | Out-Null

# plugin.json
Copy-Item (Join-Path $scriptDir "plugin.json") $steamTarget -Force

# .millennium\Dist\index.js
$distDir = Join-Path $steamTarget ".millennium\Dist"
New-Item -ItemType Directory -Path $distDir -Force | Out-Null
Copy-Item (Join-Path $scriptDir ".millennium\Dist\index.js") $distDir -Force

# backend\ (only runtime files, no source)
$backendDir = Join-Path $steamTarget "backend"
New-Item -ItemType Directory -Path $backendDir -Force | Out-Null
Copy-Item (Join-Path $scriptDir "backend\main.lua") $backendDir -Force
Copy-Item $outputExe $backendDir -Force

Write-Host "  -> $steamTarget" -ForegroundColor Green
Write-Host "  -> plugin.json" -ForegroundColor Green
Write-Host "  -> .millennium\Dist\index.js" -ForegroundColor Green
Write-Host "  -> backend\main.lua + mediadaemon.exe" -ForegroundColor Green

# Done
Write-Host "`n========================================" -ForegroundColor Cyan
Write-Host "  PROD DEPLOY COMPLETE" -ForegroundColor Green
Write-Host "========================================" -ForegroundColor Cyan
Write-Host "  Target:  $steamTarget"
Write-Host "  Daemon:  release (sin log file)"
Write-Host "  Lua:     info+ logs via /logs endpoint"
Write-Host ""
