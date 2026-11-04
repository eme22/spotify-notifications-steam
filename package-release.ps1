# Builds release.zip containing only the runtime files Millennium loads.
# Mirrors the file list in deploy-prod.ps1. CI and the release workflow both call this,
# so the artifact a user downloads is the same one that gets deployed.
#
# Assumes the frontend and daemon have already been built:
#   pnpm build
#   cargo build --release --manifest-path mediadaemon-rust/Cargo.toml
#   Copy-Item mediadaemon-rust/target/release/mediadaemon.exe backend/

$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$zipPath = Join-Path $scriptDir "release.zip"

$requiredFiles = @(
    "plugin.json",
    "LICENSE",
    ".millennium\Dist\index.js",
    "backend\main.lua",
    "backend\mediadaemon.exe"
)

foreach ($file in $requiredFiles) {
    $full = Join-Path $scriptDir $file
    if (-not (Test-Path $full)) {
        throw "Missing file required for release.zip: $file (build it first)"
    }
}

$stage = Join-Path ([System.IO.Path]::GetTempPath()) ("spotify-notifications-" + [guid]::NewGuid().ToString("N"))

try {
    New-Item -ItemType Directory -Path (Join-Path $stage ".millennium\Dist") -Force | Out-Null
    New-Item -ItemType Directory -Path (Join-Path $stage "backend") -Force | Out-Null

    foreach ($file in $requiredFiles) {
        Copy-Item (Join-Path $scriptDir $file) (Join-Path $stage $file) -Force
    }

    if (Test-Path $zipPath) { Remove-Item $zipPath -Force }
    Compress-Archive -Path (Join-Path $stage "*") -DestinationPath $zipPath -CompressionLevel Optimal

    # A zip missing backend\mediadaemon.exe would install a plugin that can never play anything.
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $archive = [System.IO.Compression.ZipFile]::OpenRead($zipPath)
    try {
        $entries = @($archive.Entries | ForEach-Object { $_.FullName })
    }
    finally {
        $archive.Dispose()
    }

    $expected = $requiredFiles | ForEach-Object { $_.Replace("\", "/") }
    $missing = @($expected | Where-Object { $entries -notcontains $_ })
    if ($missing.Count -gt 0) {
        throw "release.zip is missing: $($missing -join ', ')"
    }
}
finally {
    if (Test-Path $stage) { Remove-Item $stage -Recurse -Force }
}

Write-Host "Created $zipPath"
