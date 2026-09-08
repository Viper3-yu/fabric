#!/usr/bin/env bash
set -euo pipefail
export NO_PROXY="localhost,127.0.0.1${NO_PROXY:+,$NO_PROXY}"
export no_proxy="$NO_PROXY"

base="${JIXIN_BASE_URL:-http://127.0.0.1:8181}"
cookie="$(mktemp)"
trap 'rm -f "$cookie"' EXIT

health="$(curl --fail --silent "$base/api/health")"
[[ "$(jq -r '.data.status' <<<"$health")" == "ok" ]]
[[ "$(jq -r '.data.ledger.mode' <<<"$health")" == "fabric" ]]

curl --fail --silent -c "$cookie" -H 'Content-Type: application/json' \
  -d '{"username":"shipper","password":"shipper123"}' "$base/api/auth/login" >/dev/null
summary="$(curl --fail --silent -b "$cookie" "$base/api/dashboard/summary")"
[[ "$(jq -r '.success' <<<"$summary")" == "true" ]]

tower="$(curl --fail --silent "$base/lianyun-api/shipments/YT20260001/control-tower")"
[[ "$(jq -r '.ok' <<<"$tower")" == "true" ]]
[[ "$(jq -r '.data.shipment.events | length' <<<"$tower")" -gt 0 ]]

handover_id="HO-VERIFY-$(date +%s)"
initiated="$(curl --fail --silent -H 'Content-Type: application/json' \
  -d "{\"handoverId\":\"$handover_id\",\"fromHub\":\"HZ-HUB-01\",\"toHub\":\"WH-HUB-01\",\"carrierOrg\":\"Org2MSP\"}" \
  "$base/lianyun-api/shipments/YT20260001/handovers")"
[[ "$(jq -r '.data.initiatorOrg' <<<"$initiated")" == "Org1MSP" ]]
same_org_status="$(curl --silent -o /dev/null -w '%{http_code}' -X POST "$base/lianyun-api/handovers/$handover_id/confirm")"
[[ "$same_org_status" == "400" ]]
confirmed="$(curl --fail --silent -X POST "$base/lianyun-org2-api/handovers/$handover_id/confirm")"
[[ "$(jq -r '.data.status' <<<"$confirmed")" == "CONFIRMED" ]]
[[ "$(jq -r '.data.confirmOrg' <<<"$confirmed")" == "Org2MSP" ]]
duplicate_status="$(curl --silent -o /dev/null -w '%{http_code}' -X POST "$base/lianyun-org2-api/handovers/$handover_id/confirm")"
[[ "$duplicate_status" == "400" ]]

echo "API=Fabric，登录=通过，控制塔=Fabric/MySQL 聚合，双边交接=Org1→Org2，同方确认=拒绝，重复确认=拒绝，验收通过"
