#!/usr/bin/env bash
set -euo pipefail

# Linux/macOS twin of stop.ps1: tear down the Fabric test network, tolerating
# an already-empty environment the same way the PowerShell wrapper does.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEST_NETWORK_DIR="${SCRIPT_DIR}/fabric-samples/test-network"

if [[ ! -f "${TEST_NETWORK_DIR}/network.sh" ]]; then
  echo "fabric-samples is not installed; there is no Fabric network to stop."
  exit 0
fi

cd "${TEST_NETWORK_DIR}"
if ! ./network.sh down; then
  REMAINING_CONTAINERS="$(docker ps -aq --filter 'label=service=hyperledger-fabric')"
  if [[ -n "${REMAINING_CONTAINERS}" ]]; then
    echo "Fabric network shutdown failed; one or more Fabric containers still exist." >&2
    exit 1
  fi
  echo "The network was already empty; cleanup warnings were ignored."
fi
