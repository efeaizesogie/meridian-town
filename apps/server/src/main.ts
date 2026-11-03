// Meridian Town game server: sign-up, gathering (stamina, batching), and crediting
// bread and tools used on chain. Trading never goes through here: players sign their
// own transactions with a key that can only call the town contract.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from 'near-api-js';
import { GAME, NETWORK, RPC, TOWN, accountExists, advanceTown, createPlayer, gatherBatch, hasKey, verifyUseItem, view, type GatherOrder } from './chain.ts';
import * as players from './players.ts';

const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));

let dayMs = 900_000;
view<{ day_ms: number }>('get_params').then(p => (dayMs = p.day_ms)).catch(e => console.error('get_params failed', e));

// ---------- auth: requests are signed by the player's own key ----------

const knownKeys = new Map<string, string>(); // accountId -> public key already checked on chain

async function authenticate(req: IncomingMessage, body: string): Promise<string> {
  const header = req.headers['x-meridian-auth'];
  if (typeof header !== 'string') throw new HttpError(401, 'sign in first');
  const { accountId, publicKey, ts, signature } = JSON.parse(Buffer.from(header, 'base64').toString());
  if (Math.abs(Date.now() - Number(ts)) > 60_000) throw new HttpError(401, 'stale signature');
  const message = new TextEncoder().encode(`meridian|${accountId}|${ts}|${body}`);
  if (!PublicKey.fromString(publicKey).verify(message, Buffer.from(signature, 'base64'))) throw new HttpError(401, 'bad signature');
  if (knownKeys.get(accountId) !== publicKey) {
    if (!(await hasKey(accountId, publicKey))) throw new HttpError(401, 'key not on this account');
    knownKeys.set(accountId, publicKey);
  }
  if (!players.get(accountId)) throw new HttpError(404, 'unknown player');
  return accountId;
}

// ---------- gathering: one gather_batch transaction per window ----------

const GROUNDS = { forest: 'wood', mine: 'ore', fields: 'wheat' } as const;
type Pending = { order: GatherOrder; resolve: (n: number) => void; reject: (e: unknown) => void };
let queue: Pending[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function enqueue(order: GatherOrder): Promise<number> {
  return new Promise((resolve, reject) => {
    queue.push({ order, resolve, reject });
    flushTimer ??= setTimeout(flush, 800);
  });
}

async function flush() {
  const batch = queue;
  queue = [];
  flushTimer = null;
  try {
    const got = await gatherBatch(batch.map(b => b.order));
    batch.forEach((b, i) => b.resolve(got[i] ?? 0));
  } catch (e) {
    batch.forEach(b => b.reject(e));
  }
}

// ---------- routes ----------

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const joinsByIp = new Map<string, number[]>();

async function route(req: IncomingMessage, url: URL, body: string): Promise<unknown> {
  const R = players.RULES;
  if (req.method === 'GET' && url.pathname === '/api/config') {
    return { network: NETWORK, rpc: RPC, town: TOWN, game: GAME, dayMs, rules: R };
  }

  if (req.method === 'POST' && url.pathname === '/api/join') {
    const { name, publicKey } = JSON.parse(body || '{}');
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(name)) {
      throw new HttpError(400, 'names are 3–20 characters: lowercase letters, digits and dashes');
    }
    PublicKey.fromString(publicKey); // throws on garbage
    const ip = req.socket.remoteAddress ?? '';
    const recent = (joinsByIp.get(ip) ?? []).filter(t => Date.now() - t < 3_600_000);
    if (recent.length >= 5) throw new HttpError(429, 'too many new players from here; try later');
    const accountId = `${name}.${GAME}`;
    if (await accountExists(accountId)) throw new HttpError(409, 'that name is taken');
    await createPlayer(accountId, publicKey);
    joinsByIp.set(ip, [...recent, Date.now()]);
    players.add(accountId, name);
    knownKeys.set(accountId, publicKey);
    return { accountId };
  }

  if (req.method === 'POST' && url.pathname === '/api/me') {
    const accountId = await authenticate(req, body);
    const p = players.get(accountId)!;
    return { accountId, name: p.name, stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses };
  }

  if (req.method === 'POST' && url.pathname === '/api/gather') {
    const accountId = await authenticate(req, body);
    const { ground, swings } = JSON.parse(body);
    const item = GROUNDS[ground as keyof typeof GROUNDS];
    if (!item) throw new HttpError(400, 'no such ground');
    const n = Math.max(1, Math.min(R.maxSwingsPerRequest, Number(swings) | 0));
    const p = players.get(accountId)!;
    const stamina = players.staminaNow(p, dayMs);
    const affordable = Math.min(n, Math.floor(stamina / R.swingCost));
    if (affordable < 1) throw new HttpError(409, 'too tired: eat some bread or wait');
    const withTool = Math.min(affordable, p.toolUses);
    const wanted = withTool * R.toolYield + (affordable - withTool);
    players.setStamina(p, stamina - affordable * R.swingCost);
    p.toolUses -= withTool;
    const got = await enqueue({ player: accountId, item, quantity: wanted });
    // Swings that found nothing (the ground was bare) cost nothing.
    if (got < wanted) {
      const wasted = Math.floor((wanted - got) / (withTool > 0 ? R.toolYield : 1));
      players.setStamina(p, players.staminaNow(p, dayMs) + wasted * R.swingCost);
    }
    players.save();
    return { item, gathered: got, wanted, stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses };
  }

  if (req.method === 'POST' && url.pathname === '/api/use') {
    const accountId = await authenticate(req, body);
    const { txHash } = JSON.parse(body);
    const p = players.get(accountId)!;
    if (p.usedTx.includes(txHash)) throw new HttpError(409, 'already credited');
    const used = await verifyUseItem(String(txHash), accountId);
    if (!used) throw new HttpError(400, 'not a successful use_item transaction from you');
    p.usedTx = [...p.usedTx.slice(-200), txHash];
    if (used.item === 'bread') players.setStamina(p, Math.min(R.maxStamina, players.staminaNow(p, dayMs) + used.quantity * R.breadStamina));
    if (used.item === 'tool') p.toolUses += used.quantity * R.toolDurability;
    players.save();
    return { stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses };
  }

  throw new HttpError(404, 'not found');
}

// ---------- keeper: run the town clock so Festivals and auctions settle on time ----------

setInterval(async () => {
  try {
    const t = await view<{ day: number; processed_days: number }>('get_town');
    if (t.day > t.processed_days) {
      await advanceTown();
      console.log(`advanced town to day ${t.day}`);
    }
  } catch (e) {
    console.error('keeper', e instanceof Error ? e.message : e);
  }
}, 30_000).unref();

// ---------- static files (the built web client) ----------

const TYPES: Record<string, string> = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2' };

function serveStatic(url: URL, res: ServerResponse) {
  let file = normalize(join(WEB_DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(normalize(WEB_DIST)) || !existsSync(file) || statSync(file).isDirectory()) file = join(WEB_DIST, 'index.html');
  if (!existsSync(file)) {
    res.writeHead(404).end('web client not built: run `npm run build -w apps/web`, or use `npm run web` in development');
    return;
  }
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' }).end(readFileSync(file));
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  if (!url.pathname.startsWith('/api/')) return serveStatic(url, res);
  let body = '';
  for await (const chunk of req) body += chunk;
  try {
    const out = await route(req, url, body);
    res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
  } catch (e) {
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }));
  }
}).listen(PORT, () => console.log(`Meridian game server on http://localhost:${PORT} — town ${TOWN}, game account ${GAME}`));
