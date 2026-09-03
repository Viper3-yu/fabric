#!/usr/bin/env bash
set -euo pipefail

# Add jixin to the existing channel. Never tear down the network or reset data.
PROJECT_ROOT="${JIXIN_PROJECT_ROOT:-/home/beetles/integrated-jixin}"
FABRIC_ROOT="${FABRIC_ROOT:-/home/beetles/hyperledger/fabric-samples}"
NETWORK_ROOT="$FABRIC_ROOT/test-network"
export PATH="$FABRIC_ROOT/bin:$PATH"
export FABRIC_CFG_PATH="$FABRIC_ROOT/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_ADDRESS=localhost:21051
export CORE_PEER_TLS_ROOTCERT_FILE="$NETWORK_ROOT/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$NETWORK_ROOT/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"

committed="$(peer lifecycle chaincode querycommitted --channelID logisticschannel --output json)"
if jq -e '.chaincode_definitions[]? | select(.name == "jixin")' <<<"$committed" >/dev/null; then
  echo 'jixin 已存在，保留当前链码与账本；升级需单独指定版本和 sequence。'
  exit 0
fi
cd "$NETWORK_ROOT"
GOWORK=off ./network.sh deployCC -c logisticschannel -ccn jixin \
  -ccp "$PROJECT_ROOT/chaincode/logistics" -ccl go -ccv 1.0 -ccs 1
