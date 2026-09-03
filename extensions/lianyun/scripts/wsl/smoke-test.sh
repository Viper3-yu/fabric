#!/usr/bin/env bash
set -euo pipefail

API="${LIANYUN_API:-http://127.0.0.1:8080/api}"

health="$(curl --fail-with-body --max-time 10 --silent "$API/health")"
jq -e '.ok == true and .mode == "fabric"' <<<"$health" >/dev/null

before="$(curl --fail-with-body --max-time 10 --silent "$API/shipments/YT20260001/control-tower")"
before_count="$(jq '.data.shipment.events | length' <<<"$before")"

written="$(curl --fail-with-body --max-time 30 --silent \
  -H 'Content-Type: application/json' \
  -d '{"type":"IN_TRANSIT","hubCode":"WH-HUB-01","actorName":"部署验收","remark":"WSL Fabric 端到端写入验收通过"}' \
  "$API/shipments/YT20260001/events")"
jq -e '.ok == true and .data.actorOrg == "Org1MSP"' <<<"$written" >/dev/null

after="$(curl --fail-with-body --max-time 10 --silent "$API/shipments/YT20260001/control-tower")"
after_count="$(jq '.data.shipment.events | length' <<<"$after")"
[[ "$after_count" -eq $((before_count + 1)) ]]

jq -n \
  --argjson before "$before_count" \
  --argjson after "$after_count" \
  --arg txId "$(jq -r '.data.txId' <<<"$written")" \
  '{ok:true, mode:"fabric", eventsBefore:$before, eventsAfter:$after, txId:$txId}'
