$ErrorActionPreference = "Stop"
$NetworkDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NetworkScript = Join-Path $NetworkDir "fabric-samples\test-network\network.sh"
. (Join-Path $NetworkDir "resolve-git-bash.ps1")

if (-not (Test-Path -LiteralPath $NetworkScript)) {
  Write-Host "fabric-samples is not installed; there is no Fabric network to stop."
  exit 0
}

$BashExe = Resolve-GitBash
$previousEnvConvExcl = $env:MSYS2_ENV_CONV_EXCL
$env:MSYS2_ENV_CONV_EXCL = "DOCKER_SOCK"

Push-Location (Split-Path -Parent $NetworkScript)
try {
  & $BashExe "--login" "./network.sh" "down"
  $downExitCode = $LASTEXITCODE
  if ($downExitCode -ne 0) {
    $remainingContainers = @(docker ps -aq --filter "label=service=hyperledger-fabric")
    if ($remainingContainers.Count -gt 0) {
      throw "Fabric network shutdown failed; one or more Fabric containers still exist."
    }
    Write-Host "The network was already empty; cleanup warnings were ignored."
  }
}
finally {
  Pop-Location
  if ($null -eq $previousEnvConvExcl) {
    Remove-Item Env:MSYS2_ENV_CONV_EXCL -ErrorAction SilentlyContinue
  } else {
    $env:MSYS2_ENV_CONV_EXCL = $previousEnvConvExcl
  }
}
