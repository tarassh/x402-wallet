#!/usr/bin/env bash
# Build the Touch ID / password approver helper.
# Output: ~/.x402-wallet/bin/touchid-approver
set -euo pipefail

SRC="$(cd "$(dirname "$0")" && pwd)/touchid-approver.swift"
OUT_DIR="${HOME}/.x402-wallet/bin"
OUT="${OUT_DIR}/touchid-approver"

mkdir -p "${OUT_DIR}"

if ! command -v swiftc >/dev/null 2>&1; then
  echo "swiftc not found. Install Xcode Command Line Tools: xcode-select --install" >&2
  exit 1
fi

swiftc -O -o "${OUT}" "${SRC}"
chmod +x "${OUT}"
echo "Built: ${OUT}"
