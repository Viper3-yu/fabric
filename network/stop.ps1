$ErrorActionPreference = "Stop"
$NetworkDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$NetworkScript = Join-Path $NetworkDir "fabric-samples\test-network\network.sh"
. (Join-Path $NetworkDir "resolve-git-bash.ps1")

if (-not (Test-Path -LiteralPath $NetworkScript)) {
  Write-Host "fabric-samples is not installed; there is no Fabric network to stop."
  exit 0
}

$BashExe = Resolve-GitBash

Push-Location (Split-Path -Parent $NetworkScript)
try {
  & $BashExe "./network.sh" "down"
  if ($LASTEXITCODE -ne 0) { throw "Fabric network shutdown failed." }
}
finally {
  Pop-Location
}
