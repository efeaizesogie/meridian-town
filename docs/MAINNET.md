# Mainnet preview

A small Meridian town on NEAR mainnet, run beside the testnet demo, so "live on mainnet" is true
and MERI, goods and deeds are real tokens. Everything here spends real NEAR and every step is
signed by you. The testnet town stays the main demo.

## What it costs

| Item | NEAR | Notes |
| --- | --- | --- |
| Town contract storage | about 6 | The contract is ~480 KB; storage costs 1 NEAR per 100 KB, plus headroom as state grows. |
| Game account | 5 to start | Pays 0.1 NEAR per new player, the keeper's daily `advance`, and gas top-ups. Top it up as players join; the server warns below 1 NEAR. |
| House merchants, suppliers, townsfolk | about 2 | 12 accounts created by the server with 0.15 to 0.2 NEAR each for gas. Set `AGENTS=off` to start without them. |
| MERI/wNEAR pool on Rhea (optional) | your choice | `scripts/rhea-pool.ts` with mainnet ids (`v2.ref-finance.near`, `wrap.near`); the pool sets MERI's price. |
| Guilds on Sputnik (optional) | about 6 each | `scripts/create-guilds.ts` with `SPUTNIK_FACTORY=sputnik-dao.near`. |

A minimal preview (town, game account, no agents, no pool) is about **11 NEAR**.

## Steps

1. **Build the contract** (WSL): `cd contracts/town && cargo near build non-reproducible-wasm`,
   then copy the wasm to `contracts/town/build/meridian_town.wasm`. Run the tests first
   (`cargo test`, 43 pass).
2. **Have a mainnet account** with the NEAR above, its key in `~/.near-credentials/mainnet/`
   (for example `near account import-account` with your seed phrase).
3. **Deploy:** `PARENT=yourname.near ./scripts/deploy-mainnet.sh`. It creates `town.yourname.near`
   and `game.yourname.near`, deploys the contract with one-hour market days, and asks you to type
   `yes` before spending anything.
4. **Run a mainnet game server:** a second Railway service from the same repo, with these
   variables and its own volume at `/data`:

   ```
   NEAR_NETWORK=mainnet
   TOWN_CONTRACT=town.yourname.near
   GAME_ACCOUNT=game.yourname.near
   GAME_PRIVATE_KEY=<private_key from ~/.near-credentials/mainnet/game.yourname.near.json>
   NEARAI_API_KEY=<same as testnet>
   ```

   Give it its own domain (for example `mainnet.` on a domain you own) and link it from the
   welcome page as the mainnet preview.
5. **Optional:** open the Rhea pool and charter the guilds with the scripts above, pointed at
   mainnet ids.

## Before inviting the public

- MERI is a real token the moment it's on mainnet. Say plainly that this is a preview, that
  earnings depend on how the town trades, and that nothing is promised.
- Get legal advice for the countries you'll market to before adding liquidity or prizes.
- Keep the owner key offline: it can only rotate the minter and set the Festival floor
  (100 to 1,000 MERI), but it's still the town's admin.
- Fund the game account in small steps and watch `/api/health` (`gameNear`, `lowFunds`).
