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
  & $BashExe "--login" "./install-fabric.sh" `
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

$TestNetworkScript = Join-Path $NetworkDir "fabric-samples\test-network\network.sh"
$FabricBinDir = Join-Path $NetworkDir "fabric-samples\bin"
$PeerBinary = @(
  (Join-Path $FabricBinDir "peer.exe"),
  (Join-Path $FabricBinDir "peer")
) | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1

if (-not (Test-Path -LiteralPath $TestNetworkScript -PathType Leaf) -or -not $PeerBinary) {
  throw "Fabric samples or CLI binaries are incomplete. Review the installer output and run pnpm fabric:bootstrap again."
}

docker image inspect "hyperledger/fabric-peer:$FabricVersion" *> $null
if ($LASTEXITCODE -ne 0) {
  throw "The Fabric peer Docker image was not downloaded successfully."
}

$FabricVersionParts = $FabricVersion.Split(".")
if ($FabricVersionParts.Count -lt 2) {
  throw "FabricVersion must include at least a major and minor version."
}
$NodeEnvTag = "$($FabricVersionParts[0]).$($FabricVersionParts[1])"
$NodeEnvImage = "hyperledger/fabric-nodeenv:$NodeEnvTag"
docker image inspect $NodeEnvImage *> $null
if ($LASTEXITCODE -ne 0) {
  Write-Host "Downloading the Fabric Node chaincode build image $NodeEnvImage..."
  docker pull $NodeEnvImage
  if ($LASTEXITCODE -ne 0) {
    throw "The Fabric Node chaincode build image was not downloaded successfully."
  }
}

$JqExe = & (Join-Path $NetworkDir "ensure-jq.ps1")
Write-Host "Fabric $FabricVersion, Fabric CA $FabricCaVersion, fabric-samples, and $JqExe are ready."
