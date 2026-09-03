#!/usr/bin/env bash
set -euo pipefail

echo "== systemd =="
systemctl is-active docker mysql apache2 lianyun-backend
echo "== containers =="
docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
echo "== API =="
curl --fail-with-body --silent http://127.0.0.1:8080/api/health
echo
echo "== demo shipment =="
curl --fail-with-body --silent http://127.0.0.1:8080/api/shipments/YT20260001/control-tower
echo
