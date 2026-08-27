#!/usr/bin/env bash
set -euo pipefail

# Linux/macOS twin of scripts/test-fabric.ps1: run the Fabric closed-loop
# integration test against the local test network.
#
# Prerequisites:
#   pnpm fabric:bootstrap   (once)
#   pnpm fabric:up          (network running, chaincode deployed)
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE_PATH="${ROOT}/apps/api/.env.fabric"

if [[ -f "${ENV_FILE_PATH}" ]]; then
  export ENV_FILE="${ENV_FILE_PATH}"
  echo "[test-fabric] loading ${ENV_FILE}"
else
  echo "[test-fabric] apps/api/.env.fabric not found; run pnpm fabric:up first" >&2
fi
if [[ -z "${JWT_SECRET:-}" ]]; then
  # The integration test only needs config.Load to accept the environment;
  # the token itself is not exercised here.
  export JWT_SECRET='integration-test-only-secret-not-for-deployment'
fi
export FABRIC_INTEGRATION_TEST=1

cd "${ROOT}"
go test ./apps/api/internal/ledger -run TestFabricClosedLoopIntegration -count=1 -v
