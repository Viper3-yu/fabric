#!/usr/bin/env bash
set -euo pipefail

LIANYUN_FABRIC_HOME="${LIANYUN_FABRIC_HOME:-$HOME/hyperledger}"
sudo systemctl stop lianyun-backend || true
if [[ -x "$LIANYUN_FABRIC_HOME/fabric-samples/test-network/network.sh" ]]; then
  (cd "$LIANYUN_FABRIC_HOME/fabric-samples/test-network" && ./network.sh down)
fi
