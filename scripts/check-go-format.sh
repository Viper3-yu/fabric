#!/usr/bin/env bash
set -euo pipefail

# Linux/macOS twin of scripts/check-go-format.ps1.
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "${ROOT}"

UNFORMATTED="$(
  find apps/api chaincode/logistics \
    \( -name vendor -o -name .go-cache -o -name .go-mod \) -prune \
    -o -name '*.go' -type f -print0 |
    xargs -0 gofmt -l
)"
if [[ -n "${UNFORMATTED}" ]]; then
  echo "The following Go files are not formatted:"
  echo "${UNFORMATTED}"
  exit 1
fi

echo "[ok] Go source is formatted."
