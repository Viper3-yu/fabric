#!/usr/bin/env bash
# Linux/macOS twin of doctor.ps1: report the toolchain this project needs
# (Go, Node.js, pnpm, Git, and optionally Docker), exiting non-zero when a
# required tool is missing or too old.
set -u

version_ge() {
  [[ "$(printf '%s\n' "$2" "$1" | sort -V | head -n1)" == "$2" ]]
}

extract_version() {
  printf '%s\n' "$1" | grep -oE '[0-9]+(\.[0-9]+)+' | head -n1
}

failed=0

check_tool() { # name command version-flag minimum required
  local name="$1" command="$2" flag="$3" minimum="$4" required="$5"
  if ! command -v "${command}" >/dev/null 2>&1; then
    if [[ "${required}" == "required" ]]; then
      echo "[missing] ${name}"
      failed=1
    else
      echo "[optional missing] ${name}"
    fi
    return
  fi

  local raw version
  raw="$("${command}" "${flag}" 2>/dev/null | head -n1)"
  version="$(extract_version "${raw}")"
  if [[ -z "${version}" ]]; then
    echo "[error] ${name}: could not parse version from '${raw}'"
    if [[ "${required}" == "required" ]]; then failed=1; fi
  elif [[ -n "${minimum}" ]] && ! version_ge "${version}" "${minimum}"; then
    echo "[error] ${name}: found ${version}, need >= ${minimum}"
    if [[ "${required}" == "required" ]]; then failed=1; fi
  else
    echo "[ok] ${name}: ${version}"
  fi
}

check_tool "Go 1.23+" go version 1.23 required
check_tool "Node.js 20.12+" node --version 20.12 required
check_tool "pnpm 11+" pnpm --version 11.0 required
check_tool "Git" git --version '' required
check_tool "Docker" docker --version '' optional

if ! command -v docker >/dev/null 2>&1; then
  echo "Note: the API only runs against a real Fabric network, which requires Docker Engine."
fi

exit "${failed}"
