# Built with NEAR and its ecosystem

What Meridian uses from NEAR and its partners today, with the contract ids so anyone can check,
and what each remaining partner is for on the way to mainnet.

## Live on testnet now

| | What it does in Meridian | Check it |
| --- | --- | --- |
| **NEAR accounts and keys** | Every player is a named sub-account (`juno.game.efecode.testnet`). A play key limited to the town lets them act without wallet pop-ups; a full-access key from their 12 recovery words makes the account theirs. | any player on [testnet nearblocks](https://testnet.nearblocks.io) |
| **NEP-141, NEP-245, NEP-171** | MERI (coin), goods and shop deeds, in one contract. | `town.efecode.testnet` |
| **NEAR AI Cloud** | All six merchants decide through it (GLM 5.3 Flash); the town shows their words and reasoning. | the shop panels in the game |
| **SputnikDAO** | Guilds are Sputnik DAOs registered with the town: players pool MERI, propose, vote and share out. The game's registrar approves join requests. Tested end to end: join, pay in, propose a share-out, vote, paid out. | `meridian-hammer.sputnikv2.testnet`, `meridian-harvest.sputnikv2.testnet` |
| **Rhea** (Ref Finance's exchange) | A MERI/wNEAR pool gives MERI a market price. The game reads it every minute and every player's ledger shows what their holdings are worth in NEAR. | pool 2901 on `ref-finance-101.testnet` |

The pool was opened and seeded by the team (150 MERI and 1.5 wNEAR) with
[scripts/rhea-pool.ts](../scripts/rhea-pool.ts); the guilds with
[scripts/create-guilds.ts](../scripts/create-guilds.ts). On testnet the price is a working
demonstration, not a valuation.

## Next, on the way to mainnet

| Partner | Role in Meridian | Status |
| --- | --- | --- |
| **OutLayer** | Custody for the AI merchants: each agent's signing key moves into a TEE with spend limits and whitelists, instead of a function-call key on our server. | Works on testnet (`outlayer.testnet`); needs an OutLayer agent setup per merchant. |
| **NEAR Intents** | Cashing out: swap MERI earnings to USDC, or move them to another chain, in one signed intent. | Mainnet only (no testnet); needs MERI to be a mainnet asset that solvers quote. |
| **meme.cooking** | MERI's mainnet launch as a fair-launch memecoin with real mechanics (the weekly Festival mint and burn), graduating to a Rhea pool. | Mainnet; launch planned after the testnet season. |
| **Trezu** | A multisig treasury for the town's mainnet treasury and the mint and burn controls, so no single key can move it. | Mainnet product. |
| **Agent Market** | The agent arena: list Meridian's merchant seats so outside developers can bring their own agents and compete for a shop's profit. | Mainnet; waiting on its public API documentation. |

Not used, because they don't fit a single-chain game on NEAR: Aurora (EVM), HOT, SVRN,
GoMining, Gulf Labs, BRRRAIN, and HEX.
