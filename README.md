# Meridian Town

**The problem.** In most game economies a developer sets the prices by hand and rewards are coins
printed from nothing, so the economy needs constant patches and inflates once players stop
arriving. **Meridian** is a market town where the economy runs itself: six AI shopkeepers, each
with its own NEAR account and purse, set prices from their own stock and post paid delivery
jobs; players gather, trade and can end up owning the shops; and the town coin, MERI, is only
minted when the whole town hits a weekly trading target (and burns when it misses).

Built at NEAR HACKATHON (November 2026). Tracks: Games With Real Economies, Agent Economy,
NFTs That Do Something, Memecoins With Mechanics, Social Money, AI Swarms.

**Play it now:** https://meridian-town-production.up.railway.app (no wallet needed; you get 12
recovery words that make the account yours). **For judges:** https://meridian-town-production.up.railway.app/judge.
Built with NEAR AI, SputnikDAO and Rhea; see [docs/PARTNERS.md](docs/PARTNERS.md). How players
earn, and where that money comes from: [docs/ECONOMY.md](docs/ECONOMY.md).

### Try it in three minutes

| Do | See |
| --- | --- |
| Open the play link and type a name | A real NEAR account `<name>.game.efecode.testnet` is created for you, and 12 recovery words that own it |
| Click **The Fields**, then **Swing ×4** (tap again on the gold notch) | 4 wheat minted to your account on chain; the purse and pack update |
| Click **Walk to Oswin's Bakery**, then **sell** | MERI paid by the shop's own account; the shopkeeper's NEAR AI reasoning and its transactions show on the shop card |
| Open **Menu → Town books** | Where every MERI sits, what each week minted or burned, and the town crier feed |
| On the **Festival Stage**, press **Bet it's hit** or **Ring it** | A stake in the prediction pool, or MERI burned to lift a price for an hour, both on chain |
| Open **/judge** | Every action as one button with a link to its transaction, and *What if…?* stress tests in fast-forward |

| NEAR piece | Where in Meridian |
| --- | --- |
| Smart contract (Rust, near-sdk 5.30) | `town.efecode.testnet`: MERI (NEP-141), goods (NEP-245), shop deeds, Festival badges, soulbound marks and crafted tools (NEP-171) |
| Named sub-accounts and function-call keys | Every player and each AI shopkeeper; agent keys can call only `set_target`, `post_job`, `expire_job` |
| NEAR AI Cloud | The shopkeepers' decisions (GLM 5.3 Flash), checked against the limits the contract enforces |
| SputnikDAO | Two guilds that pool MERI, vote on deed bids and share out weekly bounties |
| Rhea | A MERI/wNEAR pool that prices MERI; players can cash out through it |

### For judges: the Inspector’s Desk, five minutes

Open **[/judge](https://meridian-town-production.up.railway.app/judge)**. One click makes you a
real NEAR account, then every game action (gather, sell, buy and eat, fill a contract, bid for a
deed, claim a Festival share) is a button that sends a real testnet transaction and links to it.
The same page lets you ask *what if?* in fast-forward (a grain barge docks, drought takes the
Fields, Oswin’s till runs dry, jump to Festival night), shows the AI shopkeepers' accounts and their
latest transactions, and opens the town's books: where every MERI sits and what each week minted
or burned. Prefer to look before signing up? *Look around the town first* on the sign-in screen
opens the live 3D town read-only.

What's new for players: a **swing meter** on every swing (stop your tool on the gold notch for bonus XP),
a **weekly town event** that moves real demand (the shopkeepers raise their targets for one good,
so it pays more and the townsfolk go after it), **twelve marks of the trade** to collect (the
full set raises your stamina cap), and **town records** checked against on-chain transactions.
Also: a **daily chest** with a streak, **market shocks** with a live **town crier**, **guild bounties**
shared out by DAO vote, and **deed perks** (rename and decorate your shop, vote on next week's event).

Contract V4 adds **social money and NFT utility**: tips, **shop coins** on a bonding curve whose
holders share each shop's profit, a **Festival prediction pool**, a **weekly tournament**,
**burn-to-boost** (fireworks, a market bell, a banner), a deed holder's cut of trade tax, and NFTs
that do something: Festival badges, **soulbound marks**, and **crafted tools** with on-chain
durability. Every sink burns MERI. See [docs/ECONOMY.md](docs/ECONOMY.md).

> Status: the game design, economy rules, simulator and core contract are done and
> deployed to testnet (coin, goods, shops, trading, gathering, delivery contracts,
> Festival, deeds), the game is playable in the browser, and six merchant agents run the
> shops on chain, a sealed-bid caravan with supplier agents runs every market day, guilds
> are Sputnik DAOs, and fast-forward replays a week in a minute.

## Try it

Requires Node 22.18+ (TypeScript runs natively, no build step for the server or simulator).

```bash
node sim/run.ts            # 60 days of the town under five scenarios
node sim/run.ts --sweep    # same, sweeping the Festival parameters
node sim/trace.ts 30       # where the money sits every 6 days, 30 players
node --test packages/economy/test/*.test.ts
(cd contracts && cargo test)   # Linux/WSL; see contracts/README.md
```

## Play it

```bash
npm install
npm run build -w apps/web
node --env-file-if-exists=.env apps/server/src/main.ts   # http://localhost:8787
```

Pick a name and you're in: the server creates `<name>.game.efecode.testnet` with a key that
lives in your browser and can only call the town contract. The town is a 3D island that
follows the market clock (add `?time=day`, `dusk` or `night` to preview); click a place and
the camera flies there. When a contract is delivered or the caravan fills an order, a porter
carries the goods to the shop; when the town hits its Festival, fireworks go up over the stage
(preview with `?porters=1` and `?fireworks=1`). The soundtrack, "Market Day", is composed and
synthesized in the browser, with a softer night version (🎵 to toggle). 🗺️ switches to a 2D map. A quest scroll walks you through the first session (gather →
sell to the best buyer → eat → deliver a contract → build your cottage → join a guild →
bid for a deed), with XP, levels and titles for work verified on chain. See
[docs/HOW-TO-PLAY.md](docs/HOW-TO-PLAY.md).

**Fast-forward.** Press *Fast-forward a week* above the market square to replay the next
seven market days in a minute (or 15 seconds) on a copy of the live town, with 5, 30 or 100
simulated players: prices, tills, contracts, caravans, closures, auctions and the Festival,
on the same rules the contract enforces (`packages/economy`, whose prices the contract
tests are pinned to). Nothing is sent to the chain.

**The caravan.** Each market day, shops short of raw goods pool their orders and outside
suppliers bid for them in a sealed-bid round run by the contract: seal a hash of your price
in the first half of the day, reveal it in the second, lowest price fills. Three supplier
agents (`varga`, `sable`, `longroad`) bid with different temperaments; anyone else can bid
with `caravan_commit` / `caravan_reveal`. See docs/RULES.md §6.

**Guilds.** Sputnik DAOs chartered by the town (`node scripts/create-guilds.ts`, about
6 NEAR each). Players join by proposal, pay MERI into the treasury and vote to bid for
deeds, share out earnings or appoint a shop's agent; the DAO executes the winning
proposals against the town. See docs/RULES.md §8.

**Merchant agents.** Each shop is run by an agent with its own account
(`hilde.game.efecode.testnet` and so on) whose only key can call `set_target`, `post_job` and
`expire_job` on the town. Every minute each agent reads its shop, decides, acts on chain and
says why on the shop card, with links to its transactions. Decisions come from a fixed
strategy; put `NEARAI_API_KEY` in `.env` (see `.env.example`; NEAR AI Cloud, model `AGENT_LLM_MODEL`, default
`z-ai/glm-5.3-flash`) and an LLM decides in character instead, inside the same limits,
which the server checks and the contract enforces. With low reasoning effort a decision
takes about 3 seconds and ~700 tokens (about $0.00015); six merchants cost roughly a cent
an hour. `node --env-file-if-exists=.env scripts/agent-dry-run.ts` shows what each merchant
would do right now without sending anything. Appoint them once with
`node scripts/appoint-agents.ts` (signed by the town owner).

Free public RPCs rate-limit hard. The server reads the town once every 5 seconds for all
players, rotates across several endpoints, and benches any that return 429. For a busy demo,
put a keyed endpoint first in `NEAR_RPCS`.

The server needs the game account's key: by default it reads
`~/.near-credentials/testnet/game.efecode.testnet.json`, or set `GAME_PRIVATE_KEY`.
Development with hot reload: `npm run server` and `npm run web` (Vite on :5173).

## Live on testnet

The town runs at [`town.efecode.testnet`](https://testnet.nearblocks.io/address/town.efecode.testnet)
with 15-minute market days (a Festival every 105 minutes). Guilds:
`meridian-hammer.sputnikv2.testnet` and `meridian-harvest.sputnikv2.testnet`. MERI/wNEAR: pool 2901
on Rhea's `ref-finance-101.testnet`.

```bash
node scripts/town.ts                    # day, Festival progress, grounds, every shop's prices
```

To deploy your own: `PARENT=<you>.testnet WASM=<built wasm> ./scripts/deploy-testnet.sh`.

## Docs

- [docs/HOW-TO-PLAY.md](docs/HOW-TO-PLAY.md): the player's guide (also in the game, under the book button).
- [docs/GAME.md](docs/GAME.md): the game design: fantasy, loops, progression, first session, feel.
- [docs/DESIGN.md](docs/DESIGN.md): the game loop (every 30 seconds, 5 minutes and
  session) and what lives on chain.
- [docs/RULES.md](docs/RULES.md): every price, upkeep, contract, caravan and Festival
  rule, with simulation results and open issues.
- [docs/ECONOMY.md](docs/ECONOMY.md): play, earn, own: how players earn, where the money
  comes from, what stops abuse, and what mainnet needs.
- [docs/PARTNERS.md](docs/PARTNERS.md): NEAR and ecosystem partners used today (NEAR AI,
  SputnikDAO, Rhea) with contract ids, and the mainnet plan for the rest.
- [docs/ARENA.md](docs/ARENA.md): the agent arena: run a shop with your own agent
  (`scripts/arena-agent.ts` is a starter).
- [docs/MAINNET.md](docs/MAINNET.md): the mainnet preview: costs and steps
  (`scripts/deploy-mainnet.sh`).
- [docs/DEPLOY.md](docs/DEPLOY.md): hosting the demo.

## Layout

| Path | What |
| --- | --- |
| `packages/economy` | The rules engine, shared by the simulator and fast-forward; the contract's tests are pinned to its prices |
| `sim/` | Scenario runner and money trace |
| `contracts/` | The town contract: coin, goods, shops, contracts, Festival, deeds, caravan, guilds, and V4 (tips, shop coins, predictions, tournament, boosts, NFTs). 62 tests. See [contracts/README.md](contracts/README.md) |
| `apps/server` | Game server: sign-up, gathering, the AI shopkeepers, townsfolk, the town clock keeper, crier, shocks, bounties |
| `apps/web` | The game client (React, three.js, near-api-js) and the Inspector's Desk at `/judge` |

## Hackathon disclosure

- **Built in the window.** The repository starts on 2026-11-03 (first commit: game design and
  simulator); everything in it, including the NEAR contract and integrations, was built during
  NEAR HACKATHON. There is no pre-hackathon baseline and no version on another chain.
- **Libraries.** Contract: `near-sdk` and `near-contract-standards` 5.30. Web: React 19, three.js
  with `@react-three/fiber`, `drei` and `postprocessing`, `near-api-js` 7.4, `@scure/bip39`,
  `@noble/curves` and `@noble/hashes`, built with Vite. Server: `near-api-js`. No templates or
  boilerplate.
- **Assets.** 3D models: CC0 by Kenney (see [CREDITS.md](CREDITS.md)). Font: Chillax by the
  Indian Type Foundry (Fontshare, free for commercial use). Music is synthesized in the browser.
- **AI assistance.** Much of the code was written with Claude Code, directed and reviewed by the
  team. The in-game shopkeepers use NEAR AI Cloud at runtime.

## License

Code: MIT. 3D models: CC0 by Kenney; see [CREDITS.md](CREDITS.md).
