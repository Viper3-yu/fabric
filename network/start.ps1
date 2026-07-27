param(
  [string]$FabricVersion = "2.5.16",
  [string]$FabricCaVersion = "1.5.15",
  [string]$ChannelName = "logisticschannel",
  [string]$ChaincodeName = "logistics"
)

$ErrorActionPreference = "Stop"
$NetworkDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$ProjectDir = Split-Path -Parent $NetworkDir
. (Join-Path $NetworkDir "resolve-git-bash.ps1")

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
  throw "Docker was not found. Install and start Docker Desktop."
}

docker info *> $null
if ($LASTEXITCODE -ne 0) {
  throw "Docker Desktop is not running, or the current user cannot access Docker Engine."
}

$TestNetworkDir = Join-Path $NetworkDir "fabric-samples\test-network"
if (-not (Test-Path -LiteralPath (Join-Path $TestNetworkDir "network.sh"))) {
  throw "fabric-samples was not found. Run pnpm fabric:bootstrap first."
}

$Pnpm = Get-Command pnpm -ErrorAction SilentlyContinue
if (-not $Pnpm) {
  throw "pnpm was not found. Install dependencies and make sure pnpm is on PATH."
}

Write-Host "Building the TypeScript chaincode..."
Push-Location $ProjectDir
try {
  pnpm --filter @jixin/chaincode build
  if ($LASTEXITCODE -ne 0) { throw "Chaincode build failed." }
}
finally {
  Pop-Location
}

$BashExe = Resolve-GitBash
$env:JIXIN_FABRIC_VERSION = $FabricVersion
$env:JIXIN_FABRIC_CA_VERSION = $FabricCaVersion
$env:JIXIN_CHANNEL_NAME = $ChannelName
$env:JIXIN_CHAINCODE_NAME = $ChaincodeName

Push-Location $NetworkDir
try {
  & $BashExe "./start-fabric.sh"
  if ($LASTEXITCODE -ne 0) {
    throw "Fabric network startup or chaincode deployment failed with exit code $LASTEXITCODE."
  }
}
finally {
  Pop-Location
}

& (Join-Path $NetworkDir "write-env.ps1") -ChannelName $ChannelName -ChaincodeName $ChaincodeName
Write-Host "The Fabric network and logistics chaincode are ready. Start the API with apps/api/.env.fabric."
