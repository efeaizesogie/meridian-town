# Meridian Town

A market-town game where the economy runs itself. Every shopkeeper is an AI agent with
its own NEAR account; every shop is a deed NFT that *is* that account; the town coin
mints or burns each week depending on whether the town kept trading.

Built for NEAR HACKATHON (Nov 2026). Tracks: Games, NFTs, Memecoins, Social Money, AI Swarms.

> Status: the game design, economy rules, simulator and core contract are done and
> deployed to testnet (coin, goods, shops, trading, gathering, delivery contracts,
> Festival, deeds), the game is playable in the browser, and six merchant agents run the
> shops on chain, a sealed-bid caravan with supplier agents runs every market day, guilds
> are Sputnik DAOs, and fast-forward replays a week in a minute.

## Try it

Requires Node 22.18+ (TypeScript runs natively; there are no dependencies yet).

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
lives in your browser and can only call the town contract. The town map is the main screen:
click a place to go there. A quest scroll walks you through the first session (gather →
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
with 15-minute market days (a Festival every 105 minutes).

```bash
node scripts/town.ts                    # day, Festival progress, grounds, every shop's prices
```

To deploy your own: `PARENT=<you>.testnet WASM=<built wasm> ./scripts/deploy-testnet.sh`.

## Docs

- [docs/HOW-TO-PLAY.md](docs/HOW-TO-PLAY.md): the player's guide (also in the game, under 📖).
- [docs/GAME.md](docs/GAME.md): the game design: fantasy, loops, progression, first session, feel.
- [docs/DESIGN.md](docs/DESIGN.md): the game loop (every 30 seconds, 5 minutes and
  session) and what lives on chain.
- [docs/RULES.md](docs/RULES.md): every price, upkeep, contract, caravan and Festival
  rule, with simulation results and open issues.

## Layout

| Path | What |
| --- | --- |
| `packages/economy` | The rules engine. The simulator uses it now; later the agents and fast-forward mode will too |
| `sim/` | Scenario runner and money trace |
| `contracts/` | The town contract: NEP-141 coin, NEP-245 goods, shops, delivery contracts, Festival. See [contracts/README.md](contracts/README.md) |
| `apps/server` | Game server: sign-up, gathering and stamina, the town clock keeper |
| `apps/web` | The game client (React + near-api-js) |

## License

MIT
