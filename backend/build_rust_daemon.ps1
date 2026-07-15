param(
    [switch]$Release = $true
)

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$rustDir = Join-Path $scriptDir "mediadaemon-rust"
$outputExe = Join-Path $scriptDir "mediadaemon.exe"

Write-Host "Building MediaDaemon (Rust)..." -ForegroundColor Cyan

$config = if ($Release) { "--release" } else { "" }
$env:Path = [System.Environment]::GetEnvironmentVariable('Path','User') + ';' + [System.Environment]::GetEnvironmentVariable('Path','Machine')

Set-Location -Path $rustDir
cargo build $config 2>&1

if ($LASTEXITCODE -eq 0) {
    $source = if ($Release) { "target\release\mediadaemon.exe" } else { "target\debug\mediadaemon.exe" }
    Copy-Item (Join-Path $rustDir $source) $outputExe -Force
    Write-Host "MediaDaemon built and copied to backend/mediadaemon.exe" -ForegroundColor Green
} else {
    Write-Host "Build failed!" -ForegroundColor Red
    exit 1
}