#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

if [[ -n "$(gofmt -d "$PROJECT_ROOT/backend-go" "$PROJECT_ROOT/chaincode-go")" ]]; then
  echo "Go 源码尚未格式化" >&2
  exit 1
fi

(cd "$PROJECT_ROOT/backend-go" && go test ./...)
(cd "$PROJECT_ROOT/chaincode-go" && go test ./...)
(cd "$PROJECT_ROOT/mock-demo" && npm test)
bash -n "$PROJECT_ROOT"/scripts/wsl/*.sh
node --check "$PROJECT_ROOT/mock-demo/server.js"

echo "静态检查与自动化测试全部通过"
