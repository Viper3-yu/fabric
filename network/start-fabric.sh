#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_NETWORK_DIR="${SCRIPT_DIR}/fabric-samples/test-network"
FABRIC_VERSION="${JIXIN_FABRIC_VERSION:-2.5.16}"
FABRIC_CA_VERSION="${JIXIN_FABRIC_CA_VERSION:-1.5.15}"
CHANNEL_NAME="${JIXIN_CHANNEL_NAME:-logisticschannel}"
CHAINCODE_NAME="${JIXIN_CHAINCODE_NAME:-logistics}"
CHAINCODE_DIR="${PROJECT_DIR}/chaincode/logistics"

if [[ ! -f "${TEST_NETWORK_DIR}/network.sh" ]]; then
  echo "未找到 fabric-samples/test-network/network.sh，请先运行 bootstrap。" >&2
  exit 1
fi

cd "${TEST_NETWORK_DIR}"
./network.sh down
./network.sh up createChannel \
  -ca \
  -c "${CHANNEL_NAME}" \
  -s couchdb \
  -i "${FABRIC_VERSION}" \
  -cai "${FABRIC_CA_VERSION}"

./network.sh deployCC \
  -c "${CHANNEL_NAME}" \
  -ccn "${CHAINCODE_NAME}" \
  -ccp "${CHAINCODE_DIR}" \
  -ccl typescript \
  -ccv 1.0 \
  -ccs 1

docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
