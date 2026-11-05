# Hosting the demo

One container runs everything: the game server, the merchant and supplier agents, the keeper
that advances market days, and the built web client. Everything of value lives on chain, so the
container's own disk only holds conveniences (stamina, XP, quest progress, sealed-bid salts).

## 1. Collect the secrets

```bash
node --env-file-if-exists=.env scripts/export-secrets.ts
```

This writes `deploy.env` (git-ignored) with:

| Variable | What it is |
| --- | --- |
| `GAME_PRIVATE_KEY` | key for `game.efecode.testnet`, which creates player accounts and runs the keeper |
| `MERIDIAN_KEYS_AGENTS` | the six merchant agents' function-call keys |
| `MERIDIAN_KEYS_SUPPLIERS` | the three caravan suppliers' function-call keys |
| `NEARAI_API_KEY` | NEAR AI Cloud, for the agents' LLM decisions (without it they follow rules only) |

Optional: `NEAR_RPCS` (comma-separated RPC URLs, e.g. a keyed endpoint), `AGENT_LLM_MODEL`,
`AGENT_TICK_MS`, `AGENTS=off`.

Never commit `deploy.env` or paste it anywhere public. These are testnet keys, but the game key
holds the NEAR that pays for sign-ups.

## 2. Run it somewhere

The container listens on `$PORT` (default 8787) and keeps state in `MERIDIAN_DATA_DIR`
(`/data` in the image). Health check: `GET /api/health`.

**Railway or Render (recommended).** Create a web service from the GitHub repo; both build the
`Dockerfile` automatically. Paste each line of `deploy.env` as an environment variable, attach
a small volume at `/data`, and set the health check path to `/api/health`. Use an always-on plan:
a free instance that sleeps stops the keeper and the agents, and the town stops moving.

**Any Docker host.**

```bash
docker build -t meridian-town .
docker run -d --env-file deploy.env -v meridian-data:/data -p 8787:8787 meridian-town
```

Run only one copy at a time. Two servers would run the same agents twice.

## 3. If the disk is lost

Agents and suppliers load their keys from the environment, so they keep working. Players
who return are adopted again the first time they act: their coins, goods and deeds are on
chain. Only off-chain progress (XP, quests, stamina) starts over.

## 4. Keep it funded

Each sign-up costs `game.efecode.testnet` about 0.1 NEAR, and the agents spend gas. Top them
up from the testnet faucet before judging (16–18 November).
