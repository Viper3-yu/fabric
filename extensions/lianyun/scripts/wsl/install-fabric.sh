#!/usr/bin/env bash
set -euo pipefail

FABRIC_VERSION="${FABRIC_VERSION:-2.5.16}"
CA_VERSION="${CA_VERSION:-1.5.17}"
LIANYUN_FABRIC_HOME="${LIANYUN_FABRIC_HOME:-$HOME/hyperledger}"
SAMPLES_COMMIT="${LIANYUN_SAMPLES_COMMIT:-05edea01d4cf24dd4087bd3750c36e690dc4d6ff}"
SAMPLES_DIR="$LIANYUN_FABRIC_HOME/fabric-samples"

mkdir -p "$LIANYUN_FABRIC_HOME"
if [[ ! -d "$SAMPLES_DIR/.git" ]]; then
  git clone https://github.com/hyperledger/fabric-samples.git "$SAMPLES_DIR"
fi
git -C "$SAMPLES_DIR" fetch --depth 1 origin "$SAMPLES_COMMIT"
git -C "$SAMPLES_DIR" checkout --detach "$SAMPLES_COMMIT"

curl --fail --silent --show-error --location \
  https://raw.githubusercontent.com/hyperledger/fabric/main/scripts/install-fabric.sh \
  --output "$LIANYUN_FABRIC_HOME/install-fabric.sh"
chmod +x "$LIANYUN_FABRIC_HOME/install-fabric.sh"
(
  cd "$LIANYUN_FABRIC_HOME"
  ./install-fabric.sh --fabric-version "$FABRIC_VERSION" --ca-version "$CA_VERSION" binary docker
)

echo "Fabric $FABRIC_VERSION / Fabric CA $CA_VERSION 已安装到 $SAMPLES_DIR"
