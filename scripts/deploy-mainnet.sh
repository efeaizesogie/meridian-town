#!/usr/bin/env bash
# Deploy a Meridian town to NEAR mainnet with near-cli-rs (0.30+). Real NEAR: read docs/MAINNET.md first.
#   PARENT=yourname.near GAME=game.yourname.near ./scripts/deploy-mainnet.sh
# Build the wasm first:  (cd contracts/town && cargo near build non-reproducible-wasm)
# Every step signs with keys in the legacy keychain (~/.near-credentials/mainnet/) and asks
# nothing more: run it only once you've checked the variables below.
set -euo pipefail

PARENT="${PARENT:?set PARENT, the mainnet account that will own the town, e.g. yourname.near}"
TOWN="${TOWN:-town.$PARENT}"
GAME="${GAME:-game.$PARENT}"
WASM="${WASM:-contracts/town/build/meridian_town.wasm}"
DAY_MS="${DAY_MS:-3600000}"       # one-hour market days for the preview (a real day is 86400000)
TOWN_FUND="${TOWN_FUND:-6 NEAR}"  # the contract's storage (~4.9 NEAR at launch) plus headroom
GAME_FUND="${GAME_FUND:-5 NEAR}"  # sign-ups (0.1 each), the keeper, and agents' gas

echo "About to create $TOWN ($TOWN_FUND) and $GAME ($GAME_FUND) from $PARENT on MAINNET, and deploy $WASM."
read -r -p "Type yes to continue: " ok
[ "$ok" = "yes" ] || { echo "Stopped."; exit 1; }

near account create-account fund-myself "$GAME" "$GAME_FUND" \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as "$PARENT" network-config mainnet sign-with-legacy-keychain send

near account create-account fund-myself "$TOWN" "$TOWN_FUND" \
  autogenerate-new-keypair save-to-legacy-keychain \
  sign-as "$PARENT" network-config mainnet sign-with-legacy-keychain send

near contract deploy "$TOWN" use-file "$WASM" \
  with-init-call new json-args "{\"owner\":\"$PARENT\",\"minter\":\"$GAME\",\"day_ms\":$DAY_MS}" \
  prepaid-gas '300.0 Tgas' attached-deposit '0 NEAR' \
  network-config mainnet sign-with-legacy-keychain send

echo
echo "Deployed. Next: run a second game server with"
echo "  NEAR_NETWORK=mainnet TOWN_CONTRACT=$TOWN GAME_ACCOUNT=$GAME GAME_PRIVATE_KEY=<from ~/.near-credentials/mainnet/$GAME.json>"
echo "(see docs/MAINNET.md, step 4)."
