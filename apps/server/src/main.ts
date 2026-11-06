// Meridian Town game server: sign-up, gathering (stamina, batching), and crediting
// bread and tools used on chain. Trading never goes through here: players sign their
// own transactions with a key that can only call the town contract.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey } from 'near-api-js';
import { GAME, NETWORK, RPCS, TOWN, accountExists, advanceTown, createPlayer, gatherBatch, hasKey, verifyTownCall, verifyUseItem, view, viewOn, type GatherOrder } from './chain.ts';
import * as players from './players.ts';
import * as prog from './progression.ts';
import { PERSONAS, agentAccount, getReports, startAgents } from './agents.ts';
import { getSupplierBids, startSuppliers } from './suppliers.ts';
import { readGuilds, runRegistrar, type GuildView } from './guilds.ts';

const PORT = Number(process.env.PORT ?? 8787);
const WEB_DIST = fileURLToPath(new URL('../../web/dist/', import.meta.url));

let dayMs = 900_000;

// ---------- one shared read of the town, so player count doesn't multiply RPC load ----------

let params: any = null;
let world: any = null;
const playerCache = new Map<string, { at: number; data: unknown }>();

// ---------- leaderboard: purses and shops of known players, refreshed each minute ----------

let leaders: { accountId: string; name: string; title: string; level: number; coins: string; deeds: string[] }[] = [];
async function readLeaders() {
  const rows = [];
  for (const p of players.all().slice(0, 60)) {
    const pv: any = await playerView(p.accountId).catch(() => null);
    rows.push({
      accountId: p.accountId,
      name: p.name,
      ...prog.levelOf(p.progress.xp),
      coins: pv?.coins ?? '0',
      deeds: (world?.shops ?? []).filter((s: any) => s.deed_holder === p.accountId).map((s: any) => s.shop.name),
    });
  }
  leaders = rows.sort((a, b) => b.deeds.length - a.deeds.length || Number(BigInt(b.coins) - BigInt(a.coins))).slice(0, 20);
}
setInterval(() => readLeaders().catch(e => console.error('leaders', e instanceof Error ? e.message : e)), 60_000).unref();
setTimeout(() => readLeaders().catch(() => {}), 8_000).unref();

// ---------- the market: MERI's price in the MERI/wNEAR pool on Rhea ----------
// apps/server/rhea-pool.json is written by scripts/rhea-pool.ts; RHEA_POOL overrides it on a host.
const RHEA: { exchange: string; poolId: number; meri: string; wnear: string } | null = (() => {
  try {
    return JSON.parse(process.env.RHEA_POOL ?? readFileSync(fileURLToPath(new URL('../rhea-pool.json', import.meta.url)), 'utf8'));
  } catch {
    return null;
  }
})();
let market: { exchange: string; poolId: number; nearPerMeri: number; meriInPool: number; nearInPool: number; readAt: number } | null = null;
async function readMarket() {
  if (!RHEA) return;
  const pool = await viewOn<{ token_account_ids: string[]; amounts: string[] }>(RHEA.exchange, 'get_pool', { pool_id: RHEA.poolId });
  const meriAt = pool.token_account_ids.indexOf(RHEA.meri);
  const nearAt = pool.token_account_ids.indexOf(RHEA.wnear);
  const meriInPool = Number(pool.amounts[meriAt]) / 1e6;
  const nearInPool = Number(BigInt(pool.amounts[nearAt]) / 10n ** 18n) / 1e6;
  market = { exchange: RHEA.exchange, poolId: RHEA.poolId, nearPerMeri: meriInPool ? nearInPool / meriInPool : 0, meriInPool, nearInPool, readAt: Date.now() };
}
setInterval(() => readMarket().catch(e => console.error('market', e instanceof Error ? e.message : e)), 60_000).unref();
setTimeout(() => readMarket().catch(() => {}), 3_000).unref();

// The first two guilds were chartered with a policy whose members couldn't vote on function
// calls (Sputnik's label is `call`); they stay registered until the owner calls unregister_guild.
const RETIRED_GUILDS = new Set((process.env.RETIRED_GUILDS ?? 'hammer-guild.sputnikv2.testnet,harvest-guild.sputnikv2.testnet').split(',').filter(Boolean));

let lastSlowRead = 0;
let guildViews: GuildView[] = [];
async function pollGuilds() {
  const ids: string[] = world?.guilds ?? [];
  if (!ids.length) return;
  guildViews = await readGuilds(ids);
  await runRegistrar(guildViews);
}
setInterval(() => pollGuilds().catch(e => console.error('guilds', e instanceof Error ? e.message : e)), 15_000).unref();
async function readWorld() {
  params ??= await view<any>('get_params');
  dayMs = params.day_ms;
  // Live state every poll; the clock once; Festival history every 30 seconds.
  const slow = Date.now() - lastSlowRead > 30_000;
  const [town, shops, jobs, auctions, caravan, guilds, weeks, clock] = await Promise.all([
    view('get_town'), view('get_shops'), view('get_jobs'), view('get_auctions'), view('get_caravan'),
    slow || !world ? view<string[]>('get_guilds').then(ids => ids.filter(id => !RETIRED_GUILDS.has(id))) : world.guilds,
    slow || !world ? view('get_weeks', {}) : world.weeks,
    world?.clock ?? view<[number, number, number]>('get_clock'),
  ]);
  if (slow) lastSlowRead = Date.now();
  // readAt: when the clock was read, so clients can turn its chain time into a local offset.
  world = { town, shops, jobs, auctions, caravan, guilds, weeks, params, clock, readAt: world?.readAt ?? Date.now() };
}
const pollWorld = () => readWorld().catch(e => console.error('read world', e instanceof Error ? e.message : e));
pollWorld();
setInterval(pollWorld, 5000).unref();

async function playerView(accountId: string) {
  const hit = playerCache.get(accountId);
  if (hit && Date.now() - hit.at < 2500) return hit.data;
  const data = await view('get_player', { account_id: accountId });
  playerCache.set(accountId, { at: Date.now(), data });
  return data;
}

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
  // A player whose key checks out on chain but who isn't in our records (a fresh server, a
  // new host) is simply re-adopted: everything of value lives on chain anyway.
  if (!players.get(accountId)) {
    if (!accountId.endsWith(`.${GAME}`)) throw new HttpError(404, 'unknown player');
    players.add(accountId, accountId.split('.')[0]);
  }
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

/**
 * What a player should read when the chain says no. near-api-js wraps the real cause (an empty
 * balance, a busy RPC) inside "Exceeded 5 providers"; unwrap it and say what it means.
 */
function plainError(e: unknown): { status: number; message: string } {
  const all = [e, ...((e as any)?.errors ?? [])];
  const text = all.map(x => (x instanceof Error ? `${x.name} ${x.message}` : String(x))).join(' | ');
  const signer = all.map(x => (x as any)?.signerId).find(Boolean);
  if (/NotEnoughBalance|LackBalanceForState|not enough balance/i.test(text)) {
    if (!signer || signer === GAME) {
      console.error(`LOW FUNDS: ${GAME} cannot pay for transactions. Top it up with testnet NEAR.`);
      return { status: 503, message: 'The town’s treasury for new players is empty right now, so it can’t open new stalls. The keeper has been told; please try again in a little while.' };
    }
    return { status: 402, message: 'Your account is out of NEAR for transaction fees. Ask in the town square, or try again after the next top-up.' };
  }
  if (/Exceeded \d+ providers|RetriesExceeded|ECONNRESET|ETIMEDOUT|fetch failed|429|Too Many Requests|timeout/i.test(text)) {
    return { status: 503, message: 'The NEAR network is busy right now. Wait a few seconds and try again; nothing was lost.' };
  }
  return { status: 500, message: 'Something went wrong on our side. Try again in a moment; your coins and goods are safe on chain.' };
}

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
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return { ok: !!world, town: TOWN, readAt: world?.readAt ?? null, uptimeS: Math.round(process.uptime()) };
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return { network: NETWORK, rpcs: RPCS, town: TOWN, game: GAME, dayMs, rules: R, guilds: world?.guilds ?? [] };
  }

  if (req.method === 'GET' && url.pathname === '/api/world') {
    if (!world) throw new HttpError(503, 'reading the town, try again in a moment');
    return { ...world, agents: getReports(), suppliers: getSupplierBids(), guildViews, market };
  }

  if (req.method === 'GET' && url.pathname === '/api/player') {
    const accountId = url.searchParams.get('account') ?? '';
    if (!/^[a-z0-9._-]{2,64}$/.test(accountId)) throw new HttpError(400, 'bad account');
    if (url.searchParams.get('fresh')) playerCache.delete(accountId);
    return playerView(accountId);
  }

  if (req.method === 'GET' && url.pathname === '/api/agents') {
    return { agents: Object.fromEntries(Object.keys(PERSONAS).map(id => [id, agentAccount(id)])), reports: getReports() };
  }

  if (req.method === 'POST' && url.pathname === '/api/join') {
    const { name, publicKey, ownerKey, guildKeys = {} } = JSON.parse(body || '{}');
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]{1,18}[a-z0-9]$/.test(name)) {
      throw new HttpError(400, 'names are 3–20 characters: lowercase letters, digits and dashes');
    }
    PublicKey.fromString(publicKey); // throws on garbage
    if (ownerKey !== undefined) PublicKey.fromString(ownerKey);
    const ip = req.socket.remoteAddress ?? '';
    const recent = (joinsByIp.get(ip) ?? []).filter(t => Date.now() - t < 3_600_000);
    if (recent.length >= 5) throw new HttpError(429, 'too many new players from here; try later');
    const accountId = `${name}.${GAME}`;
    if (await accountExists(accountId)) throw new HttpError(409, 'that name is taken');
    // One extra key per chartered guild, limited to proposing and voting in that DAO.
    const guildIds: string[] = world?.guilds ?? [];
    const extra = guildIds.filter(g => guildKeys[g]).map(g => ({ receiver: g, publicKey: String(guildKeys[g]), methods: ['add_proposal', 'act_proposal'] }));
    extra.forEach(k => PublicKey.fromString(k.publicKey));
    await createPlayer(accountId, publicKey, extra, ownerKey);
    joinsByIp.set(ip, [...recent, Date.now()]);
    players.add(accountId, name);
    knownKeys.set(accountId, publicKey);
    return { accountId };
  }

  if (req.method === 'POST' && url.pathname === '/api/me') {
    const accountId = await authenticate(req, body);
    const p = players.get(accountId)!;
    // Joining a guild shows up in the DAO's member list rather than being reported.
    if (guildViews.some(g => g.members.includes(accountId)) && prog.complete(p.progress, 'guild')) players.save();
    return { accountId, name: p.name, stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses, ...prog.view(p.progress) };
  }

  if (req.method === 'POST' && url.pathname === '/api/report') {
    // The client reports a transaction it sent; XP and quests follow only if it succeeded on chain.
    const accountId = await authenticate(req, body);
    const { txHash } = JSON.parse(body);
    const p = players.get(accountId)!;
    if (p.progress.reported.includes(txHash)) throw new HttpError(409, 'already reported');
    const c = await verifyTownCall(String(txHash), accountId);
    if (!c) throw new HttpError(400, 'not a successful town transaction from you');
    p.progress.reported = [...p.progress.reported.slice(-300), txHash];
    const meri = (v: unknown) => Math.floor(Number(v ?? 0) / 1e6);
    const done: string[] = [];
    const quest = (id: string) => {
      const q = prog.complete(p.progress, id);
      if (q) done.push(q.title);
    };
    let gained = 0;
    if (c.method === 'sell') { gained = meri(c.value) * prog.XP.perMeriSold; p.progress.stats.sold += meri(c.value); quest('sell'); }
    if (c.method === 'deliver') { gained = meri(c.value) * prog.XP.perMeriDelivered; p.progress.stats.delivered += meri(c.value); quest('deliver'); }
    if (c.method === 'bid_for_deed') { gained = prog.XP.deedBid; quest('deed'); }
    if (c.method === 'pay_guild') gained = prog.XP.guildPayIn;
    if (c.method === 'claim_festival') { gained = prog.XP.festivalClaim; p.progress.stats.festival = (p.progress.stats.festival ?? 0) + meri(c.value); }
    const before = prog.levelOf(p.progress.xp).level;
    p.progress.xp += gained;
    players.save();
    const after = prog.levelOf(p.progress.xp);
    return { xp: gained, quests: done, levelUp: after.level > before ? after : null };
  }

  if (req.method === 'GET' && url.pathname === '/api/leaders') {
    return leaders;
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
    const before = prog.levelOf(p.progress.xp).level;
    p.progress.xp += got * prog.XP.perUnitGathered;
    p.progress.stats.gathered += got;
    const q = got > 0 ? prog.complete(p.progress, 'swing') : null;
    players.save();
    const after = prog.levelOf(p.progress.xp);
    return { item, gathered: got, wanted, stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses, xp: got, quests: q ? [q.title] : [], levelUp: after.level > before ? after : null };
  }

  if (req.method === 'POST' && url.pathname === '/api/use') {
    const accountId = await authenticate(req, body);
    const { txHash, purpose = 'use' } = JSON.parse(body);
    const p = players.get(accountId)!;
    if (p.usedTx.includes(txHash)) throw new HttpError(409, 'already credited');
    const used = await verifyUseItem(String(txHash), accountId);
    if (!used) throw new HttpError(400, 'not a successful use_item transaction from you');
    p.usedTx = [...p.usedTx.slice(-200), txHash];
    const before = prog.levelOf(p.progress.xp).level;
    const done: string[] = [];
    let built = 0;
    if (purpose === 'cottage') {
      built = prog.build(p.progress, used.item as 'tool' | 'bread', used.quantity);
      if (p.progress.cottage.level >= 2) {
        const q = prog.complete(p.progress, 'cottage');
        if (q) done.push(q.title);
      }
    } else {
      if (used.item === 'bread') {
        players.setStamina(p, Math.min(prog.maxStamina(p.progress), players.staminaNow(p, dayMs) + used.quantity * R.breadStamina));
        p.progress.xp += prog.XP.eat;
        const q = prog.complete(p.progress, 'eat');
        if (q) done.push(q.title);
      }
      if (used.item === 'tool') p.toolUses += used.quantity * R.toolDurability;
    }
    players.save();
    const after = prog.levelOf(p.progress.xp);
    return { stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses, built, cottage: p.progress.cottage, quests: done, levelUp: after.level > before ? after : null };
  }

  throw new HttpError(404, 'not found');
}

// ---------- keeper: run the town clock so Festivals and auctions settle on time ----------

setInterval(async () => {
  try {
    const t = world?.town ?? (await view<{ day: number; processed_days: number }>('get_town'));
    if (t.day > t.processed_days) {
      await advanceTown();
      console.log(`advanced town to day ${t.day}`);
    }
  } catch (e) {
    console.error('keeper', e instanceof Error ? e.message : e);
  }
}, 30_000).unref();

// ---------- static files (the built web client) ----------

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.txt': 'text/plain' };

// Visitors land on the welcome page at `/`; the game itself lives at `/play`. Every other
// path is a file from the build, or falls back to the game.
function serveStatic(url: URL, res: ServerResponse) {
  const path = url.pathname === '/' ? '/welcome/index.html' : url.pathname.replace(/\/+$/, '') === '/play' ? '/index.html' : url.pathname;
  let file = normalize(join(WEB_DIST, decodeURIComponent(path)));
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
    if (e instanceof HttpError) {
      res.writeHead(e.status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: e.message }));
      return;
    }
    console.error(e);
    const { status, message } = plainError(e);
    res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify({ error: message }));
  }
}).listen(PORT, () => {
  startAgents(() => world);
  startSuppliers(() => world?.caravan ?? null);
  console.log(`Meridian game server on http://localhost:${PORT} — town ${TOWN}, game account ${GAME}`);
});
