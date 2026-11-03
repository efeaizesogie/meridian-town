# Meridian Town contract

One contract holds the whole town, so a trade moves coin and goods in a single atomic step:

| Part | Standard | Module |
| --- | --- | --- |
| MERI coin | NEP-141 + NEP-145 | `ft.rs` |
| Goods: wood, ore, wheat, bread, tool | NEP-245 | `mt.rs` |
| Shops, prices, buy/sell, gathering | — | `market.rs`, `pricing.rs` |
| Delivery contracts (escrow, Proof-to-Pay) | — | `jobs.rs` |
| Shop deeds, auctions, agent appointment | NEP-171 (+ enumeration, metadata) | `deeds.rs` |
| Town clock: production, upkeep, the Festival | — | `days.rs` |

A shop's cash and stock are real token balances held by `<shop>.<town>`. The treasury is
the contract account itself; escrow sits in `escrow.<town>`, Festival mints in
`festival.<town>`, outside traders in `outside.<town>`.

## Roles

- **owner**: can rotate the minter, appoint agents and auction deeds **for shops the town
  still holds**. It can't touch a player's shop, and can't change any rule or parameter
  after `new`.
- **deed holder**: appoints and replaces the shop's agent, and receives its dividends.
- **minter**: the game server. It can only credit gathered goods, and only as much as
  the grounds have regrown.
- **shop agent**: can move its shop's target stock within ±30% and post delivery
  contracts within the price and escrow caps.
- **anyone**: can call `advance` to run the town clock, and `expire_job` after a deadline.

## Build and test

Linux or WSL. Requires Rust with the `wasm32-unknown-unknown` target, plus
[cargo-near](https://github.com/near/cargo-near).

```bash
cd contracts
cargo test                                          # 27 tests, incl. price parity with the TS engine
cd town && cargo near build non-reproducible-wasm   # target/near/meridian_town/meridian_town.wasm
```

`tests/fixtures/prices.json` comes from `node sim/export-fixtures.ts`. Regenerate it
whenever the TypeScript prices change; the Rust tests fail if the two disagree.

## Not built yet

Resident demand, the caravan's sealed bids, starter coins, NFT approvals (so marketplace
listings don't work yet), and `mt_transfer_call`.
