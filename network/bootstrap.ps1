param(
  [string]$FabricVersion = "2.5.16",
  [string]$FabricCaVersion = "1.5.15"
)

$ErrorActionPreference = "Stop"
$NetworkDir = Split-Path -Parent $MyInvocation.MyCommand.Path
. (Join-Path $NetworkDir "resolve-git-bash.ps1")

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install and start Docker Desktop, then run pnpm fabric:bootstrap."
}

$BashExe = Resolve-GitBash
$Installer = Join-Path $NetworkDir "install-fabric.sh"

if (-not (Test-Path -LiteralPath $Installer)) {
  Write-Host "Downloading the official Hyperledger Fabric installer..."
  Invoke-WebRequest `
    -Uri "https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh" `
    -OutFile $Installer
}

Push-Location $NetworkDir
try {
  & $BashExe "./install-fabric.sh" `
    "--fabric-version" $FabricVersion `
    "--ca-version" $FabricCaVersion `
    "docker" "binary" "samples"
  if ($LASTEXITCODE -ne 0) {
    throw "The Fabric installer failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

Write-Host "Fabric $FabricVersion, Fabric CA $FabricCaVersion, and fabric-samples are ready."
