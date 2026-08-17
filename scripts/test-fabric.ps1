# Runs the Fabric closed-loop integration test against the local test network.
#
# Prerequisites:
#   pnpm fabric:bootstrap   (once)
#   pnpm fabric:up          (network running, chaincode deployed)
#
# The Fabric credentials written by the bootstrap scripts live in
# apps/api/.env.fabric; when present they are loaded automatically. The test
# is skipped in the normal `go test ./...` run, so CI without Docker stays green.
$ErrorActionPreference = 'Stop'

$root = Split-Path -Parent $PSScriptRoot
$envFile = Join-Path $root 'appsapi.env.fabric'
if (Test-Path $envFile) {
  $env:ENV_FILE = $envFile
  Write-Host "[test-fabric] loading $envFile"
} else {
  Write-Warning "[test-fabric] apps/api/.env.fabric not found; run pnpm fabric:up first"
}
if (-not $env:LEDGER_MODE) { $env:LEDGER_MODE = 'fabric' }
if (-not $env:JWT_SECRET) {
  # The integration test only needs config.Load to accept the environment;
  # the token itself is not exercised here.
  $env:JWT_SECRET = 'integration-test-only-secret-not-for-deployment'
}
$env:FABRIC_INTEGRATION_TEST = '1'

Push-Location $root
try {
  go test ./apps/api/internal/ledger -run TestFabricClosedLoopIntegration -count=1 -v
} finally {
  Pop-Location
}
