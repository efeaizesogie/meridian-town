# Meridian Town contract

One contract holds the whole town, so a trade moves coin and goods in a single atomic step:

| Part | Standard | Module |
| --- | --- | --- |
| MERI coin | NEP-141 + NEP-145 | `ft.rs` |
| Goods: wood, ore, wheat, bread, tool | NEP-245 | `mt.rs` |
| Shops, prices, buy/sell, gathering | — | `market.rs`, `pricing.rs` |
| Delivery contracts (escrow, Proof-to-Pay) | — | `jobs.rs` |
| Shop deeds, auctions, agent appointment | NEP-171 (+ enumeration, metadata) | `deeds.rs` |
| Town clock: production, resident demand, upkeep, dividends, the Festival | — | `days.rs` |
| The caravan (sealed-bid supply rounds) and guild registration | — | `caravan.rs` |
| Tips, burn-to-boost, the Festival prediction pool, shop coins, the weekly tournament, Festival badges, soulbound marks, crafted tool NFTs | NEP-141 / NEP-171 | `extras.rs` |
| Upgrades from earlier layouts (V2 to V3, V3 to V4) | — | `migrate.rs` |

A shop's cash and stock are real token balances held by `<shop>.<town>`. The treasury is
the contract account itself; escrow sits in `escrow.<town>`, Festival mints in
`festival.<town>`, outside traders in `outside.<town>`, bets in `bets.<town>`, shop-coin reserves in
`coins.<town>` and the tournament pot in `tourney.<town>`. A test checks that every coin sits in one
of these known accounts.

## Roles

- **owner**: can rotate the minter, appoint agents and auction deeds **for shops the town
  still holds**, register guilds, and set the Festival's target floor (bounded to 100 to
  1,000 MERI). It can't touch a player's shop.
- **deed holder**: appoints and replaces the shop's agent, and receives its dividends.
- **minter**: the game server. It can only credit gathered goods (only as much as the
  grounds have regrown) and mint a player's soulbound marks.
- **shop agent**: can move its shop's target stock within ±30% and post delivery
  contracts within the price and escrow caps.
- **anyone**: can call `advance` to run the town clock, and `expire_job` after a deadline.

## Build and test

Linux or WSL. Requires Rust with the `wasm32-unknown-unknown` target, plus
[cargo-near](https://github.com/near/cargo-near).

```bash
cd contracts
cargo test                                          # 62 tests, incl. price parity with the TS engine and the V3-to-V4 migration
cd town && cargo near build non-reproducible-wasm   # target/near/meridian_town/meridian_town.wasm
```

`tests/fixtures/prices.json` comes from `node sim/export-fixtures.ts`. Regenerate it
whenever the TypeScript prices change; the Rust tests fail if the two disagree.

## Not built yet

NFT approvals (so marketplace listings don't work yet) and `mt_transfer_call`.
