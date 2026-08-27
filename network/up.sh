#!/usr/bin/env bash
set -euo pipefail

# Linux/macOS twin of start.ps1: bring up the Fabric test network, deploy the
# logistics chaincode, and regenerate apps/api/.env.fabric (write-env.sh
# preserves existing APP_PASSWORD* lines).
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! docker info >/dev/null 2>&1; then
  echo "Docker Engine is not reachable; is the daemon running?" >&2
  exit 1
fi

FABRIC_VERSION="${JIXIN_FABRIC_VERSION:-2.5.16}"
GO_CHAINCODE_IMAGE="hyperledger/fabric-ccenv:${FABRIC_VERSION}"
if ! docker image inspect "${GO_CHAINCODE_IMAGE}" >/dev/null 2>&1; then
  echo "Downloading the Fabric Go chaincode build image ${GO_CHAINCODE_IMAGE}..."
  docker pull "${GO_CHAINCODE_IMAGE}"
fi

"${SCRIPT_DIR}/start-fabric.sh"
"${SCRIPT_DIR}/write-env.sh"
echo "The Fabric network and logistics chaincode are ready. Start the API with apps/api/.env.fabric."
