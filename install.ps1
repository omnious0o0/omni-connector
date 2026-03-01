#Requires -Version 5.1
$ErrorActionPreference = "Stop"
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12

$repo = if ($env:OMNI_CONNECTOR_REPO) { $env:OMNI_CONNECTOR_REPO } else { "omnious0o0/omni-connector" }
$ref = if ($env:OMNI_CONNECTOR_REF) { $env:OMNI_CONNECTOR_REF } else { "main" }
$defaultArchiveUrl = "https://codeload.github.com/$repo/tar.gz/$ref"
$archiveUrl = if ($env:OMNI_CONNECTOR_ARCHIVE_URL) { $env:OMNI_CONNECTOR_ARCHIVE_URL } else { $defaultArchiveUrl }
$archiveSha256 = if ($env:OMNI_CONNECTOR_ARCHIVE_SHA256) { $env:OMNI_CONNECTOR_ARCHIVE_SHA256 } else { "" }
$installTarget = if ($env:OMNI_CONNECTOR_INSTALL_TARGET) { $env:OMNI_CONNECTOR_INSTALL_TARGET } else { "" }
$autoStart = if ($env:OMNI_CONNECTOR_AUTO_START) { $env:OMNI_CONNECTOR_AUTO_START } else { "1" }
$startUrl = if ($env:OMNI_CONNECTOR_START_URL) { $env:OMNI_CONNECTOR_START_URL } else { "http://localhost:38471" }

if (-not $archiveUrl.StartsWith("https://")) {
    Write-Error "OMNI_CONNECTOR_ARCHIVE_URL must use HTTPS."
    exit 1
}

if ($archiveUrl -ne $defaultArchiveUrl -and [string]::IsNullOrWhiteSpace($archiveSha256)) {
    Write-Error "custom OMNI_CONNECTOR_ARCHIVE_URL requires OMNI_CONNECTOR_ARCHIVE_SHA256"
    exit 1
}

function Refresh-ProcessPath {
    $machinePath = [Environment]::GetEnvironmentVariable("Path", "Machine")
    $userPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $paths = @()
    if (-not [string]::IsNullOrWhiteSpace($machinePath)) { $paths += $machinePath }
    if (-not [string]::IsNullOrWhiteSpace($userPath)) { $paths += $userPath }
    if ($paths.Count -gt 0) {
        $env:Path = ($paths -join ";")
    }
}

function Ensure-NodeAndNpm {
    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if ($node -and $npm) {
        return
    }

    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $winget) {
        Write-Error "Node.js and npm are required. Install Node.js LTS and rerun the installer."
        exit 1
    }

    Write-Host "Node.js not found. Installing Node.js LTS with winget..."
    & winget install --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    Refresh-ProcessPath

    $node = Get-Command node -ErrorAction SilentlyContinue
    $npm = Get-Command npm -ErrorAction SilentlyContinue
    if (-not $node -or -not $npm) {
        Write-Error "Node.js installation did not complete successfully."
        exit 1
    }
}

function Resolve-OmniConnectorCommand {
    $command = Get-Command omni-connector -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $prefix = (& npm prefix -g).Trim()
    if (-not [string]::IsNullOrWhiteSpace($prefix)) {
        $cmdPath = Join-Path $prefix "omni-connector.cmd"
        if (Test-Path $cmdPath) {
            return $cmdPath
        }

        $ps1Path = Join-Path $prefix "omni-connector.ps1"
        if (Test-Path $ps1Path) {
            return $ps1Path
        }
    }

    throw "Could not locate omni-connector after installation."
}

function Install-FromArchive {
    $tempDir = Join-Path $env:TEMP ("omni-connector-install-" + [Guid]::NewGuid().ToString("N"))
    New-Item -Path $tempDir -ItemType Directory -Force | Out-Null

    try {
        $archivePath = Join-Path $tempDir "omni-connector.tar.gz"
        Write-Host "Downloading source archive..."
        Invoke-WebRequest -Uri $archiveUrl -OutFile $archivePath

        if (-not [string]::IsNullOrWhiteSpace($archiveSha256)) {
            $expected = $archiveSha256.Trim().ToLowerInvariant()
            if ($expected -notmatch "^[0-9a-f]{64}$") {
                throw "OMNI_CONNECTOR_ARCHIVE_SHA256 must be a 64-character hex string"
            }

            $actual = (Get-FileHash -Path $archivePath -Algorithm SHA256).Hash.ToLowerInvariant()
            if ($actual -ne $expected) {
                throw "Archive checksum mismatch. Expected: $expected Actual: $actual"
            }
        }

        & npm install -g --ignore-scripts $archivePath
    } finally {
        Remove-Item -Path $tempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}

Ensure-NodeAndNpm

if (-not [string]::IsNullOrWhiteSpace($installTarget)) {
    Write-Host "Installing omni-connector from target: $installTarget"
    & npm install -g --ignore-scripts $installTarget
} else {
    Write-Host "Installing omni-connector from source archive"
    Install-FromArchive
}

$omniCommand = Resolve-OmniConnectorCommand
& $omniCommand --init-only
if ($LASTEXITCODE -ne 0) {
    throw "Runtime initialization failed with exit code $LASTEXITCODE"
}

Write-Host "Install complete."
Write-Host "Run now: omni-connector"
Write-Host "Manual update: omni-connector --update"

if ($autoStart -eq "1") {
    Start-Process -FilePath $omniCommand | Out-Null
    Start-Process -FilePath $startUrl | Out-Null
}
