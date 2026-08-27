#!/usr/bin/env bash
set -euo pipefail

# Linux/macOS twin of write-env.ps1: regenerate apps/api/.env.fabric after a
# network start. APP_PASSWORD* lines from an existing file are preserved, so
# rebuilding the network no longer wipes configured sign-in credentials.
CHANNEL_NAME="${JIXIN_CHANNEL_NAME:-logisticschannel}"
CHAINCODE_NAME="${JIXIN_CHAINCODE_NAME:-logistics}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_NETWORK="${SCRIPT_DIR}/fabric-samples/test-network"
OUTPUT_PATH="${PROJECT_DIR}/apps/api/.env.fabric"

ORG1_BASE="${TEST_NETWORK}/organizations/peerOrganizations/org1.example.com"
ORG2_BASE="${TEST_NETWORK}/organizations/peerOrganizations/org2.example.com"

ORG1_KEY="$(find "${ORG1_BASE}/users/User1@org1.example.com/msp/keystore" -type f 2>/dev/null | head -n 1 || true)"
ORG2_KEY="$(find "${ORG2_BASE}/users/User1@org2.example.com/msp/keystore" -type f 2>/dev/null | head -n 1 || true)"

if [[ -z "${ORG1_KEY}" || -z "${ORG2_KEY}" ]]; then
  echo "The Org1 or Org2 Gateway private key was not found. Confirm that the Fabric network started successfully." >&2
  exit 1
fi

# A per-machine random JWT secret so the generated env file boots the API
# without sharing one secret across machines; regeneration invalidates old
# sessions, which is desired after a network rebuild.
JWT_SECRET="$(openssl rand -hex 32)"

PRESERVED_PASSWORD_LINES=""
if [[ -f "${OUTPUT_PATH}" ]]; then
  PRESERVED_PASSWORD_LINES="$(grep -E '^APP_PASSWORD' "${OUTPUT_PATH}" || true)"
fi

{
  echo "JWT_SECRET=${JWT_SECRET}"
  echo "FABRIC_CHANNEL_NAME=${CHANNEL_NAME}"
  echo "FABRIC_CHAINCODE_NAME=${CHAINCODE_NAME}"
  echo "FABRIC_ORG1_MSP_ID=Org1MSP"
  echo "FABRIC_ORG1_PEER_ENDPOINT=localhost:7051"
  echo "FABRIC_ORG1_PEER_HOST_ALIAS=peer0.org1.example.com"
  echo "FABRIC_ORG1_TLS_CERT_PATH=${ORG1_BASE}/peers/peer0.org1.example.com/tls/ca.crt"
  echo "FABRIC_ORG1_CERT_PATH=${ORG1_BASE}/users/User1@org1.example.com/msp/signcerts/cert.pem"
  echo "FABRIC_ORG1_KEY_PATH=${ORG1_KEY}"
  echo "FABRIC_ORG2_MSP_ID=Org2MSP"
  echo "FABRIC_ORG2_PEER_ENDPOINT=localhost:9051"
  echo "FABRIC_ORG2_PEER_HOST_ALIAS=peer0.org2.example.com"
  echo "FABRIC_ORG2_TLS_CERT_PATH=${ORG2_BASE}/peers/peer0.org2.example.com/tls/ca.crt"
  echo "FABRIC_ORG2_CERT_PATH=${ORG2_BASE}/users/User1@org2.example.com/msp/signcerts/cert.pem"
  echo "FABRIC_ORG2_KEY_PATH=${ORG2_KEY}"
  echo ""
} >"${OUTPUT_PATH}"

if [[ -n "${PRESERVED_PASSWORD_LINES}" ]]; then
  printf '%s\n' "${PRESERVED_PASSWORD_LINES}" >>"${OUTPUT_PATH}"
  echo "Preserved $(printf '%s\n' "${PRESERVED_PASSWORD_LINES}" | wc -l) APP_PASSWORD* line(s) from the previous env file."
else
  cat >>"${OUTPUT_PATH}" <<'EOF'
# Sign-in credentials are not generated: set APP_PASSWORD_<USER> or
# APP_PASSWORD_HASH_<USER> for the accounts that need workbench access.
# APP_PASSWORD_SHIPPER=
# APP_PASSWORD_CARRIER=
# APP_PASSWORD_RECEIVER=
# APP_PASSWORD_AUDITOR=
EOF
fi

echo "Generated ${OUTPUT_PATH}. It contains machine-local certificate paths and is excluded by .gitignore."
