#!/usr/bin/env bash
set -euo pipefail

# Linux/macOS twin of bootstrap.ps1: install the official Fabric binaries,
# Docker images, and fabric-samples into network/fabric-samples.
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FABRIC_VERSION="${JIXIN_FABRIC_VERSION:-2.5.16}"
FABRIC_CA_VERSION="${JIXIN_FABRIC_CA_VERSION:-1.5.15}"

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker was not found. Install Docker Engine (with the compose v2 plugin) first." >&2
  exit 1
fi
if ! docker info >/dev/null 2>&1; then
  echo "Docker Engine is not reachable; is the daemon running?" >&2
  exit 1
fi

# The official deployCC helper shells out to jq (see scripts/deployCC.sh).
if ! command -v jq >/dev/null 2>&1; then
  echo "jq was not found. Install it first, e.g. sudo apt install jq." >&2
  exit 1
fi

INSTALLER="${SCRIPT_DIR}/install-fabric.sh"
if [[ ! -f "${INSTALLER}" ]]; then
  echo "Downloading the official Hyperledger Fabric installer..."
  curl -fL -o "${INSTALLER}" "https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh"
fi

cd "${SCRIPT_DIR}"
./install-fabric.sh \
  --fabric-version "${FABRIC_VERSION}" \
  --ca-version "${FABRIC_CA_VERSION}" \
  docker binary samples

TEST_NETWORK_SCRIPT="${SCRIPT_DIR}/fabric-samples/test-network/network.sh"
PEER_BINARY="${SCRIPT_DIR}/fabric-samples/bin/peer"
if [[ ! -f "${TEST_NETWORK_SCRIPT}" || ! -x "${PEER_BINARY}" ]]; then
  echo "Fabric samples or CLI binaries are incomplete. Review the installer output and run pnpm fabric:bootstrap again." >&2
  exit 1
fi

if ! docker image inspect "hyperledger/fabric-peer:${FABRIC_VERSION}" >/dev/null 2>&1; then
  echo "The Fabric peer Docker image was not downloaded successfully." >&2
  exit 1
fi

GO_CHAINCODE_IMAGE="hyperledger/fabric-ccenv:${FABRIC_VERSION}"
if ! docker image inspect "${GO_CHAINCODE_IMAGE}" >/dev/null 2>&1; then
  echo "Downloading the Fabric Go chaincode build image ${GO_CHAINCODE_IMAGE}..."
  docker pull "${GO_CHAINCODE_IMAGE}"
fi

echo "Fabric ${FABRIC_VERSION}, Fabric CA ${FABRIC_CA_VERSION}, and fabric-samples are ready."
