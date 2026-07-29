#!/usr/bin/env bash
set -euo pipefail

# Preserve the Linux Docker socket mount while still allowing MSYS to convert
# /c/... arguments for the native Windows Fabric CLI binaries.
export MSYS2_ENV_CONV_EXCL='DOCKER_SOCK'

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
TEST_NETWORK_DIR="${SCRIPT_DIR}/fabric-samples/test-network"
export PATH="${SCRIPT_DIR}/bin:${PATH}"
# Fabric's deployCC helper vendors dependencies from the chaincode module.
# Disable the repository-level workspace for that module-local operation.
export GOWORK=off
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
if ! ./network.sh down; then
  echo "清理命令返回非零状态；若网络尚未启动，这是可忽略的空环境提示。" >&2
fi

GENERATED_IDENTITY_PATHS=(
  "organizations/peerOrganizations"
  "organizations/ordererOrganizations"
  "organizations/fabric-ca/org1"
  "organizations/fabric-ca/org2"
  "organizations/fabric-ca/ordererOrg"
  "channel-artifacts"
)

generated_identity_artifacts_exist=false
for relative_path in "${GENERATED_IDENTITY_PATHS[@]}"; do
  if [[ -e "${TEST_NETWORK_DIR}/${relative_path}" ]]; then
    generated_identity_artifacts_exist=true
    break
  fi
done

org1_signcerts="${TEST_NETWORK_DIR}/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/signcerts"
org2_signcerts="${TEST_NETWORK_DIR}/organizations/peerOrganizations/org2.example.com/users/Admin@org2.example.com/msp/signcerts"
orderer_tls_cert="${TEST_NETWORK_DIR}/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/tls/server.crt"

identity_material_complete=true
if ! compgen -G "${org1_signcerts}/*" >/dev/null; then
  identity_material_complete=false
fi
if ! compgen -G "${org2_signcerts}/*" >/dev/null; then
  identity_material_complete=false
fi
if [[ ! -f "${orderer_tls_cert}" ]]; then
  identity_material_complete=false
fi

if [[ "${generated_identity_artifacts_exist}" == "true" && "${identity_material_complete}" != "true" ]]; then
  echo "检测到残缺的 Fabric 身份材料，正在重建可再生目录。"
  for relative_path in "${GENERATED_IDENTITY_PATHS[@]}"; do
    target="${TEST_NETWORK_DIR}/${relative_path}"
    case "${target}" in
      "${TEST_NETWORK_DIR}"/*)
        rm -rf -- "${target}"
        ;;
      *)
        echo "拒绝清理测试网络之外的路径：${target}" >&2
        exit 1
        ;;
    esac
  done
fi

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
  -ccl go \
  -ccv 1.0 \
  -ccs 1

docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
