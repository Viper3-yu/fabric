#!/usr/bin/env bash
set -euo pipefail
export NO_PROXY="localhost,127.0.0.1${NO_PROXY:+,$NO_PROXY}"
export no_proxy="$NO_PROXY"

PROJECT_ROOT="${JIXIN_PROJECT_ROOT:-/home/beetles/integrated-jixin}"
LIANYUN_ROOT="${LIANYUN_PROJECT_ROOT:-/home/beetles/lianyun}"
FABRIC_ROOT="${FABRIC_ROOT:-/home/beetles/hyperledger/fabric-samples}"
NETWORK_ROOT="$FABRIC_ROOT/test-network"
ENV_FILE="$PROJECT_ROOT/apps/api/.env"
WEB_ROOT="/var/www/jixin-integrated"

command -v go >/dev/null
command -v pnpm >/dev/null
command -v openssl >/dev/null
command -v rsync >/dev/null
[[ -d "$NETWORK_ROOT/organizations" ]] || { echo "Fabric test-network 未运行" >&2; exit 1; }
[[ -f "$LIANYUN_ROOT/backend-go/.env" ]] || { echo "原控制塔服务配置不存在" >&2; exit 1; }

org1_root="$NETWORK_ROOT/organizations/peerOrganizations/org1.example.com"
org2_root="$NETWORK_ROOT/organizations/peerOrganizations/org2.example.com"
org1_key="$(find "$org1_root/users/User1@org1.example.com/msp/keystore" -maxdepth 1 -type f | head -n 1)"
org2_key="$(find "$org2_root/users/User1@org2.example.com/msp/keystore" -maxdepth 1 -type f | head -n 1)"
[[ -n "$org1_key" && -n "$org2_key" ]] || { echo "未找到 Fabric 用户私钥" >&2; exit 1; }

jwt_secret="$(openssl rand -hex 32)"
if [[ -f "$ENV_FILE" ]]; then
  existing="$(sed -n 's/^JWT_SECRET=//p' "$ENV_FILE" | head -n 1)"
  [[ -n "$existing" ]] && jwt_secret="$existing"
fi

cat > "$ENV_FILE" <<EOF
PORT=3001
HOST=127.0.0.1
NODE_ENV=development
JWT_SECRET=$jwt_secret
JWT_EXPIRES_IN=8h
CORS_ORIGIN=http://localhost:8181,http://127.0.0.1:8181
PUBLIC_RATE_LIMIT_PER_MINUTE=120
TRUST_PROXY=false
APP_PASSWORD_SHIPPER=shipper123
APP_PASSWORD_CARRIER=carrier123
APP_PASSWORD_RECEIVER=receiver123
APP_PASSWORD_AUDITOR=auditor123
FABRIC_CHANNEL_NAME=logisticschannel
FABRIC_CHAINCODE_NAME=jixin
FABRIC_ORG1_MSP_ID=Org1MSP
FABRIC_ORG1_CERT_PATH=$org1_root/users/User1@org1.example.com/msp/signcerts/cert.pem
FABRIC_ORG1_KEY_PATH=$org1_key
FABRIC_ORG1_PEER_ENDPOINT=localhost:21051
FABRIC_ORG1_PEER_HOST_ALIAS=peer0.org1.example.com
FABRIC_ORG1_TLS_CERT_PATH=$org1_root/peers/peer0.org1.example.com/tls/ca.crt
FABRIC_ORG2_MSP_ID=Org2MSP
FABRIC_ORG2_CERT_PATH=$org2_root/users/User1@org2.example.com/msp/signcerts/cert.pem
FABRIC_ORG2_KEY_PATH=$org2_key
FABRIC_ORG2_PEER_ENDPOINT=localhost:22051
FABRIC_ORG2_PEER_HOST_ALIAS=peer0.org2.example.com
FABRIC_ORG2_TLS_CERT_PATH=$org2_root/peers/peer0.org2.example.com/tls/ca.crt
EOF
chmod 0600 "$ENV_FILE"

cd "$PROJECT_ROOT"
pnpm install --frozen-lockfile
pnpm build
mkdir -p "$PROJECT_ROOT/bin"
go build -o "$PROJECT_ROOT/bin/jixin-api" ./apps/api/cmd/server

# 原控制塔链码支持真实的双边交接。主服务继续以 Org1 发起，新增的
# 8082 内部服务使用 Org2 身份确认；两边共享只读查询和 MySQL 数据。
mysql_dsn="$(sed -n 's/^MYSQL_DSN=//p' "$LIANYUN_ROOT/backend-go/.env" | head -n 1)"
lianyun_chaincode="$(sed -n 's/^FABRIC_CHAINCODE=//p' "$LIANYUN_ROOT/backend-go/.env" | head -n 1)"
[[ -n "$mysql_dsn" && -n "$lianyun_chaincode" ]] || { echo "原控制塔环境缺少 MySQL/Fabric 配置" >&2; exit 1; }

cd "$LIANYUN_ROOT/backend-go"
go test ./...
go build -o "$LIANYUN_ROOT/bin/lianyun-backend" ./cmd/server

cat > "$LIANYUN_ROOT/backend-go/.env.org2" <<EOF
PORT=8082
HOST=127.0.0.1
GIN_MODE=release
LEDGER_MODE=fabric
MYSQL_DSN=$mysql_dsn
FABRIC_MSP_ID=Org2MSP
FABRIC_CHANNEL=logisticschannel
FABRIC_CHAINCODE=$lianyun_chaincode
FABRIC_PEER_ENDPOINT=localhost:22051
FABRIC_PEER_HOST_ALIAS=peer0.org2.example.com
FABRIC_CERT_PATH=$org2_root/users/User1@org2.example.com/msp/signcerts/cert.pem
FABRIC_KEY_PATH=$org2_key
FABRIC_TLS_CERT_PATH=$org2_root/peers/peer0.org2.example.com/tls/ca.crt
EOF
chmod 0600 "$LIANYUN_ROOT/backend-go/.env.org2"

sudo tee /etc/systemd/system/lianyun-org2-backend.service >/dev/null <<EOF
[Unit]
Description=Lianyun Org2 handover confirmation API
After=network.target mysql.service docker.service
Requires=mysql.service docker.service

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$LIANYUN_ROOT/backend-go
EnvironmentFile=$LIANYUN_ROOT/backend-go/.env.org2
ExecStart=$LIANYUN_ROOT/bin/lianyun-backend
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo install -d -m 0755 "$WEB_ROOT"
# Keep old chunks for open tabs; publish the HTML entry atomically after assets.
sudo rsync -a --exclude=index.html "$PROJECT_ROOT/apps/web/dist/" "$WEB_ROOT/"
sudo install -m 0644 "$PROJECT_ROOT/apps/web/dist/index.html" "$WEB_ROOT/index.html.next"
sudo mv "$WEB_ROOT/index.html.next" "$WEB_ROOT/index.html"
sudo chown -R www-data:www-data "$WEB_ROOT"
sudo install -m 0644 "$PROJECT_ROOT/deploy/wsl/apache-integrated.conf" /etc/apache2/sites-available/jixin-integrated.conf
grep -q '^Listen 8181$' /etc/apache2/ports.conf || echo 'Listen 8181' | sudo tee -a /etc/apache2/ports.conf >/dev/null
sudo a2enmod proxy proxy_http headers >/dev/null
sudo a2ensite jixin-integrated >/dev/null

sudo tee /etc/systemd/system/jixin-integrated-api.service >/dev/null <<EOF
[Unit]
Description=Jixin integrated Fabric logistics API
After=network.target docker.service lianyun-backend.service
Requires=docker.service

[Service]
Type=simple
User=$(id -un)
WorkingDirectory=$PROJECT_ROOT
EnvironmentFile=$ENV_FILE
ExecStart=$PROJECT_ROOT/bin/jixin-api
Restart=on-failure
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl restart lianyun-backend.service
sudo systemctl enable --now lianyun-org2-backend.service
sudo systemctl enable --now jixin-integrated-api.service
sudo systemctl restart lianyun-org2-backend.service jixin-integrated-api.service
sudo apache2ctl configtest
sudo systemctl reload apache2

cd "$PROJECT_ROOT"
ENV_FILE="$ENV_FILE" go run ./apps/api/cmd/seed

curl --fail --silent http://127.0.0.1:3001/api/health >/dev/null
curl --fail --silent http://127.0.0.1:8181/ >/dev/null
curl --fail --silent http://127.0.0.1:8181/lianyun-api/health >/dev/null
curl --fail --silent http://127.0.0.1:8181/lianyun-org2-api/health >/dev/null
echo "集成版已部署：http://localhost:8181"
