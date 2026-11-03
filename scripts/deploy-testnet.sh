#!/usr/bin/env bash
# Deploy a fresh town to testnet with near-cli-rs (0.30+).
#   PARENT=efecode.testnet WASM=path/to/meridian_town.wasm ./scripts/deploy-testnet.sh
# Build the wasm first: (cd contracts/town && cargo near build non-reproducible-wasm)
# The parent's key must be in the legacy keychain (~/.near-credentials/testnet/).
set -euo pipefail

PARENT="${PARENT:?set PARENT, e.g. efecode.testnet}"
TOWN="${TOWN:-town.$PARENT}"
WASM="${WASM:-contracts/target/near/meridian_town/meridian_town.wasm}"
DAY_MS="${DAY_MS:-900000}"   # 15-minute market days for demos
FUND="${FUND:-6 NEAR}"

near account create-account fund-myself "$TOWN" "$FUND" \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as "$PARENT" network-config testnet sign-with-legacy-keychain send

near contract deploy "$TOWN" use-file "$WASM" \
  with-init-call new json-args "{\"owner\":\"$PARENT\",\"minter\":\"$PARENT\",\"day_ms\":$DAY_MS}" \
  prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' \
  network-config testnet sign-with-legacy-keychain send

node scripts/town.ts "$TOWN" testnet
