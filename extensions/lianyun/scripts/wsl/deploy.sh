#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
LIANYUN_FABRIC_HOME="${LIANYUN_FABRIC_HOME:-$HOME/hyperledger}"
SAMPLES_DIR="$LIANYUN_FABRIC_HOME/fabric-samples"
NETWORK_DIR="$SAMPLES_DIR/test-network"
CHANNEL_NAME="${FABRIC_CHANNEL:-logisticschannel}"
CHAINCODE_NAME="${FABRIC_CHAINCODE:-lianyun}"
SAMPLES_COMMIT="${LIANYUN_SAMPLES_COMMIT:-05edea01d4cf24dd4087bd3750c36e690dc4d6ff}"
ORDERER_PORT="${LIANYUN_ORDERER_PORT:-21050}"
ORG1_PEER_PORT="${LIANYUN_ORG1_PEER_PORT:-21051}"
ORG2_PEER_PORT="${LIANYUN_ORG2_PEER_PORT:-22051}"
ORG1_CA_PORT="${LIANYUN_ORG1_CA_PORT:-21054}"
ORG2_CA_PORT="${LIANYUN_ORG2_CA_PORT:-22054}"
ORDERER_CA_PORT="${LIANYUN_ORDERER_CA_PORT:-23054}"

for command in go mysql php apache2ctl docker; do
  command -v "$command" >/dev/null || { echo "缺少命令: $command" >&2; exit 1; }
done
[[ -x "$NETWORK_DIR/network.sh" ]] || { echo "未找到 Fabric test-network，请先运行 scripts/wsl/install-fabric.sh" >&2; exit 1; }

# Some Fabric 2.5 sample scripts still call the legacy docker-compose command.
# Provide a Linux wrapper when only the Compose v2 plugin is available.
if ! docker-compose version >/dev/null 2>&1; then
  docker compose version >/dev/null
  printf '#!/usr/bin/env bash\nexec docker compose "$@"\n' | sudo tee /usr/local/bin/docker-compose >/dev/null
  sudo chmod 0755 /usr/local/bin/docker-compose
fi

sudo systemctl enable --now docker mysql apache2
sudo mysql < "$PROJECT_ROOT/database/schema.sql"
sudo mysql < "$PROJECT_ROOT/database/demo.sql"

export PATH="$SAMPLES_DIR/bin:$PATH"
cd "$NETWORK_DIR"
./network.sh down

# Restore tracked sample files, then remap host/listen ports away from Windows
# exclusions and currently active desktop proxy connections.
git -C "$SAMPLES_DIR" checkout "$SAMPLES_COMMIT" -- test-network
git -C "$SAMPLES_DIR" grep -Il -E '7050|7051|7054|8054|9051|9054' -- test-network | while IFS= read -r relative_path; do
  perl -pi -e "s/(?<!\\d)7050(?!\\d)/$ORDERER_PORT/g; s/(?<!\\d)7051(?!\\d)/$ORG1_PEER_PORT/g; s/(?<!\\d)7054(?!\\d)/$ORG1_CA_PORT/g; s/(?<!\\d)8054(?!\\d)/$ORG2_CA_PORT/g; s/(?<!\\d)9051(?!\\d)/$ORG2_PEER_PORT/g; s/(?<!\\d)9054(?!\\d)/$ORDERER_CA_PORT/g" "$SAMPLES_DIR/$relative_path"
done
cd "$NETWORK_DIR"
./network.sh up createChannel -ca -c "$CHANNEL_NAME"
./network.sh deployCC -c "$CHANNEL_NAME" -ccn "$CHAINCODE_NAME" -ccp "$PROJECT_ROOT/chaincode-go" -ccl go -ccv 1.0 -ccs 1

export FABRIC_CFG_PATH="$SAMPLES_DIR/config"
export CORE_PEER_TLS_ENABLED=true
export CORE_PEER_LOCALMSPID=Org1MSP
export CORE_PEER_TLS_ROOTCERT_FILE="$NETWORK_DIR/organizations/peerOrganizations/org1.example.com/peers/peer0.org1.example.com/tls/ca.crt"
export CORE_PEER_MSPCONFIGPATH="$NETWORK_DIR/organizations/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp"
export CORE_PEER_ADDRESS="localhost:$ORG1_PEER_PORT"
peer chaincode invoke -o "localhost:$ORDERER_PORT" --ordererTLSHostnameOverride orderer.example.com --tls \
  --cafile "$NETWORK_DIR/organizations/ordererOrganizations/example.com/orderers/orderer.example.com/msp/tlscacerts/tlsca.example.com-cert.pem" \
  -C "$CHANNEL_NAME" -n "$CHAINCODE_NAME" \
  --peerAddresses "localhost:$ORG1_PEER_PORT" --tlsRootCertFiles "$CORE_PEER_TLS_ROOTCERT_FILE" \
  --peerAddresses "localhost:$ORG2_PEER_PORT" --tlsRootCertFiles "$NETWORK_DIR/organizations/peerOrganizations/org2.example.com/peers/peer0.org2.example.com/tls/ca.crt" \
  -c '{"function":"InitLedger","Args":[]}' --waitForEvent

CERT_PATH="$NETWORK_DIR/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/signcerts/cert.pem"
KEY_PATH="$(find "$NETWORK_DIR/organizations/peerOrganizations/org1.example.com/users/User1@org1.example.com/msp/keystore" -maxdepth 1 -type f | head -n 1)"
TLS_PATH="$CORE_PEER_TLS_ROOTCERT_FILE"
cat > "$PROJECT_ROOT/backend-go/.env" <<EOF
PORT=8080
GIN_MODE=release
LEDGER_MODE=fabric
MYSQL_DSN=lianyun_app:lianyun_dev@tcp(127.0.0.1:3306)/lianyun?parseTime=true&loc=UTC
FABRIC_MSP_ID=Org1MSP
FABRIC_CHANNEL=$CHANNEL_NAME
FABRIC_CHAINCODE=$CHAINCODE_NAME
FABRIC_PEER_ENDPOINT=localhost:$ORG1_PEER_PORT
FABRIC_PEER_HOST_ALIAS=peer0.org1.example.com
FABRIC_CERT_PATH=$CERT_PATH
FABRIC_KEY_PATH=$KEY_PATH
FABRIC_TLS_CERT_PATH=$TLS_PATH
EOF

cd "$PROJECT_ROOT/backend-go"
go mod download
mkdir -p "$PROJECT_ROOT/bin"
go build -o "$PROJECT_ROOT/bin/lianyun-backend" ./cmd/server

sudo install -d -m 0755 /var/www/lianyun
sudo cp -a "$PROJECT_ROOT/frontend-php/public/." /var/www/lianyun/
sudo chown -R www-data:www-data /var/www/lianyun
sudo install -m 0644 "$PROJECT_ROOT/frontend-php/apache-vhost.conf" /etc/apache2/sites-available/lianyun.conf
grep -q '^Listen 8081$' /etc/apache2/ports.conf || echo 'Listen 8081' | sudo tee -a /etc/apache2/ports.conf >/dev/null
sudo a2enmod proxy proxy_http >/dev/null
sudo a2ensite lianyun >/dev/null

sudo tee /etc/systemd/system/lianyun-backend.service >/dev/null <<EOF
[Unit]
Description=Lianyun trusted logistics control tower API
After=network.target mysql.service
Requires=mysql.service

[Service]
Type=simple
User=$USER
WorkingDirectory=$PROJECT_ROOT/backend-go
EnvironmentFile=$PROJECT_ROOT/backend-go/.env
ExecStart=$PROJECT_ROOT/bin/lianyun-backend
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable lianyun-backend
sudo systemctl restart lianyun-backend
sudo systemctl reload apache2

# Keep the Fabric network available if Docker or WSL restarts.
mapfile -t fabric_containers < <(docker ps -aq --filter network=fabric_test)
if ((${#fabric_containers[@]})); then
  docker update --restart unless-stopped "${fabric_containers[@]}" >/dev/null
fi

echo "部署完成：前端 http://localhost:8081，API http://localhost:8080/api/health"
