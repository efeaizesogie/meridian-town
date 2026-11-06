// Meridian Town game server: sign-up, gathering (stamina, batching), and crediting
// bread and tools used on chain. Trading never goes through here: players sign their
// own transactions with a key that can only call the town contract.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublicKey, teraToGas } from 'near-api-js';
import { GAME, NETWORK, RPCS, TOWN, accountExists, advanceTown, createPlayer, game, gatherBatch, hasKey, verifyTownCall, verifyUseItem, provider, view, viewOn, type GatherOrder } from './chain.ts';
import * as players from './players.ts';
import * as prog from './progression.ts';
import { PERSONAS, agentAccount, getReports, startAgents } from './agents.ts';
import { getSupplierBids, startSuppliers } from './suppliers.ts';
import { getTownsfolk, startTownsfolk } from './townsfolk.ts';
import { readGuilds, runRegistrar, type GuildView } from './guilds.ts';
import { activeBells, activeShock, eventFor, maybeShock, myVote, setBoosts, shockHistory, tally, vote as voteEvent } from './events.ts';
import * as records from './records.ts';
import * as feed from './feed.ts';
import * as styles from './styles.ts';
import * as bounties from './bounties.ts';

// The gathering record starts from what players had already gathered before records existed.
for (const p of players.all()) records.offer('gather', { who: p.accountId, value: p.progress.stats.gathered, detail: 'goods gathered in all' });

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
let market: { exchange: string; poolId: number; meri: string; wnear: string; nearPerMeri: number; meriInPool: number; nearInPool: number; readAt: number } | null = null;
async function readMarket() {
  if (!RHEA) return;
  const pool = await viewOn<{ token_account_ids: string[]; amounts: string[] }>(RHEA.exchange, 'get_pool', { pool_id: RHEA.poolId });
  const meriAt = pool.token_account_ids.indexOf(RHEA.meri);
  const nearAt = pool.token_account_ids.indexOf(RHEA.wnear);
  const meriInPool = Number(pool.amounts[meriAt]) / 1e6;
  const nearInPool = Number(BigInt(pool.amounts[nearAt]) / 10n ** 18n) / 1e6;
  market = { exchange: RHEA.exchange, poolId: RHEA.poolId, meri: RHEA.meri, wnear: RHEA.wnear, nearPerMeri: meriInPool ? nearInPool / meriInPool : 0, meriInPool, nearInPool, readAt: Date.now() };
}
setInterval(() => readMarket().catch(e => console.error('market', e instanceof Error ? e.message : e)), 60_000).unref();
setTimeout(() => readMarket().catch(() => {}), 3_000).unref();

// The first two guilds were chartered with a policy whose members couldn't vote on function
// calls (Sputnik's label is `call`); they stay registered until the owner calls unregister_guild.
const RETIRED_GUILDS = new Set((process.env.RETIRED_GUILDS ?? 'hammer-guild.sputnikv2.testnet,harvest-guild.sputnikv2.testnet').split(',').filter(Boolean));

// ---------- funds: warn before the game account runs dry (it pays sign-ups and the keeper) ----------
const LOW_FUNDS_NEAR = Number(process.env.LOW_FUNDS_NEAR ?? 1);
let gameNear: number | null = null;
async function readFunds() {
  const a = await provider.viewAccount({ accountId: GAME });
  gameNear = Number(BigInt(a.amount) / 10n ** 18n) / 1e6;
  if (gameNear < LOW_FUNDS_NEAR) console.error(`LOW FUNDS: ${GAME} has ${gameNear.toFixed(3)} NEAR left. Top it up, or sign-ups and the town clock will stop.`);
}
setInterval(() => readFunds().catch(() => {}), 120_000).unref();
setTimeout(() => readFunds().catch(() => {}), 5_000).unref();

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
  // V4 (shop coins, boosts, the prediction pool, the tournament): read every poll, and simply
  // absent while the contract is older.
  const opt = <T,>(p: Promise<T>) => p.catch(() => null);
  const [shopCoins, boosts, prediction, tournament] = await Promise.all([
    opt(view('get_shop_coins')), opt(view<any[]>('get_boosts', { limit: 20 })), opt(view('get_prediction', {})), opt(view('get_tournament', {})),
  ]);
  if (slow) lastSlowRead = Date.now();
  // readAt: when the clock was read, so clients can turn its chain time into a local offset.
  const prev = world;
  world = { town, shops, jobs, auctions, caravan, guilds, weeks, params, clock, readAt: world?.readAt ?? Date.now(), shopCoins, boosts, prediction, tournament };
  if (boosts) setBoosts(boosts);
  feed.watch(prev, world);
}
const pollWorld = () => readWorld().catch(e => console.error('read world', e instanceof Error ? e.message : e));
pollWorld();
setInterval(pollWorld, 5000).unref();

// Market shocks: every quarter hour, maybe something happens (rain, a flooded shaft, a storm).
// They only run where the shopkeepers do, so a quiet local server doesn't fight the live one.
if (process.env.AGENTS !== 'off') {
  setInterval(() => {
    if (world) maybeShock(world.shops.filter((s: any) => s.shop.open).map((s: any) => s.shop.id), 0.3);
  }, 15 * 60_000).unref();
}

async function playerView(accountId: string) {
  const hit = playerCache.get(accountId);
  if (hit && Date.now() - hit.at < 2500) return hit.data;
  // V4 views (shop coins, tools, bets, tournament entry) fail on an older contract: leave them out then.
  const opt = <T,>(p: Promise<T>) => p.catch(() => null);
  const week = world ? Math.floor(world.town.day / world.params.days_per_week) : undefined;
  const [base, holdings, tools, prediction, tournament] = await Promise.all([
    view<any>('get_player', { account_id: accountId }),
    opt(view('get_coin_holdings', { account_id: accountId })),
    opt(view('get_tools', { account_id: accountId })),
    opt(view('get_prediction', { week, account_id: accountId })),
    opt(view('get_tournament', { account_id: accountId })),
  ]);
  const data = { ...base, holdings, tools, prediction, tournament };
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

// ---------- marks on chain: each new mark becomes a soulbound NFT, one call at a time ----------

let markChain: Promise<unknown> = Promise.resolve();
function chainMark(player: string, mark: string) {
  markChain = markChain.then(async () => {
    try {
      await game.callFunction({ contractId: TOWN, methodName: 'mint_mark', args: { player, mark }, gas: teraToGas(30) });
    } catch (e) {
      // An older contract has no mint_mark; the mark still counts in the game.
      console.warn(`[marks] ${player} ${mark}:`, (e instanceof Error ? e.message : String(e)).slice(0, 120));
    }
  });
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
    // gameNear: what the game account has left for sign-ups, the keeper and gas top-ups.
    return { ok: !!world, town: TOWN, readAt: world?.readAt ?? null, uptimeS: Math.round(process.uptime()), gameNear, lowFunds: gameNear !== null && gameNear < LOW_FUNDS_NEAR };
  }

  if (req.method === 'GET' && url.pathname === '/api/stats') {
    // Real numbers for the welcome page: who plays, and whether the town is trading.
    const all = players.all();
    const day = 24 * 3600_000;
    const weeks = world?.weeks ?? [];
    return {
      players: all.length,
      activeToday: all.filter(p => Date.now() - p.staminaAt < day).length,
      joinedThisWeek: all.filter(p => Date.now() - p.joinedAt < 7 * day).length,
      week: world ? { traded: Number(world.town.week_counted) / 1e6, target: Number(world.town.week_target) / 1e6, streak: world.town.streak } : null,
      festivalsHit: weeks.filter((w: any) => w.hit).length,
      festivals: weeks.length,
      openContracts: world?.jobs.length ?? 0,
      meriInNear: market?.nearPerMeri ?? null,
      townsfolk: getTownsfolk().length,
    };
  }

  if (req.method === 'GET' && url.pathname === '/api/config') {
    return { network: NETWORK, rpcs: RPCS, town: TOWN, game: GAME, dayMs, rules: R, guilds: world?.guilds ?? [] };
  }

  if (req.method === 'GET' && url.pathname === '/api/world') {
    if (!world) throw new HttpError(503, 'reading the town, try again in a moment');
    return {
      ...world, agents: getReports(), suppliers: getSupplierBids(), guildViews, market, townsfolk: getTownsfolk(),
      event: eventFor(world.town.week), shock: activeShock(), styles: styles.current(world.shops),
      bounties: bounties.view(world.town.week, guildViews),
      bells: activeBells(),
    };
  }

  if (req.method === 'GET' && url.pathname === '/api/feed') {
    // The town crier: recent moments, plain headlines about the market, and next week's event vote.
    if (!world) throw new HttpError(503, 'reading the town, try again in a moment');
    return { items: feed.recent(40), standout: feed.standout(world), shock: activeShock(), nextWeek: world.town.week + 1, vote: tally(world.town.week + 1) };
  }

  if (req.method === 'GET' && url.pathname === '/api/prices') {
    return { ...feed.priceHistory(), shocks: shockHistory() };
  }

  if (req.method === 'POST' && url.pathname === '/api/deed/vote') {
    // Deed holders choose next week's event. One vote per deed holder per week; it can change.
    const accountId = await authenticate(req, body);
    const { eventId } = JSON.parse(body);
    if (!world.shops.some((s: any) => s.deed_holder === accountId)) throw new HttpError(403, 'Only a deed holder can vote on the town’s events');
    try { voteEvent(world.town.week + 1, accountId, String(eventId)); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : String(e)); }
    return { week: world.town.week + 1, vote: tally(world.town.week + 1), mine: myVote(world.town.week + 1, accountId) };
  }

  if (req.method === 'POST' && url.pathname === '/api/deed/style') {
    // A deed holder names and decorates their shop. It shows on the island for everyone.
    const accountId = await authenticate(req, body);
    const { shopId, title, color, flag } = JSON.parse(body);
    const shop = world.shops.find((s: any) => s.shop.id === shopId);
    if (!shop || shop.deed_holder !== accountId) throw new HttpError(403, 'Only the deed holder can decorate this shop');
    try { styles.set(String(shopId), accountId, { title, color, flag }); } catch (e) { throw new HttpError(400, e instanceof Error ? e.message : String(e)); }
    feed.post({ kind: 'deed', text: `${accountId.split('.')[0]} renamed their shop: “${styles.current(world.shops)[shopId]?.title}”`, who: accountId });
    return styles.current(world.shops)[shopId];
  }

  if (req.method === 'GET' && url.pathname === '/api/records') {
    // Town records, plus the leaders the server can see from its own player files.
    const all = players.all();
    const top = (pick: (p: (typeof all)[number]) => number) =>
      all.map(p => ({ who: p.accountId, value: pick(p) })).filter(x => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 5);
    const weeks: any[] = world?.weeks ?? [];
    const bestWeek = weeks.reduce((b: any, w: any) => (!b || Number(w.counted) > Number(b.counted) ? w : b), null);
    return {
      records: Object.entries(records.all()).map(([id, r]) => ({ id, ...records.RECORD_LABELS[id as records.RecordId], ...r })),
      bestWeek: bestWeek ? { week: bestWeek.week, traded: Number(bestWeek.counted) / 1e6, target: Number(bestWeek.target) / 1e6, hit: bestWeek.hit } : null,
      bestStreak: world?.town.best_streak ?? 0,
      topSellers: top(p => p.progress.stats.sold),
      topGatherers: top(p => p.progress.stats.gathered),
      topMarks: top(p => Object.values(p.progress.marks ?? {}).filter(Boolean).length),
      marks: prog.MARKS,
    };
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
    const marks: string[] = [];
    const markIt = (id: string) => {
      const m = prog.mark(p.progress, id);
      if (m) {
        marks.push(m);
        chainMark(accountId, id);
      }
    };
    const exact = (v: unknown) => Number(v ?? 0) / 1e6;
    const shopName = (id: unknown) => world?.shops.find((s: any) => s.shop.id === id)?.shop.name ?? String(id);
    let newRecord: string | null = null;
    const offer = (id: records.RecordId, value: number, detail: string) => {
      if (records.offer(id, { who: accountId, value, detail, tx: String(txHash) })) newRecord = records.RECORD_LABELS[id].title;
    };
    if (c.method === 'sell') {
      gained = meri(c.value) * prog.XP.perMeriSold;
      p.progress.stats.sold += meri(c.value);
      quest('sell');
      p.progress.soldTo = [...new Set([...(p.progress.soldTo ?? []), String(c.args.shop_id)])];
      if (p.progress.soldTo.length >= 4) markIt('buyers');
      if (world) bounties.credit(world.town.week, guildViews, accountId, String(c.args.item), Number(c.args.quantity));
      offer('sale', exact(c.value), `${c.args.quantity} ${c.args.item} to ${shopName(c.args.shop_id)}`);
    }
    if (c.method === 'deliver') {
      gained = meri(c.value) * prog.XP.perMeriDelivered;
      p.progress.stats.delivered += meri(c.value);
      quest('deliver');
      markIt('contract');
      offer('delivery', exact(c.value), `${c.args.quantity} goods for contract #${c.args.job_id}`);
    }
    if (c.method === 'bid_for_deed') {
      gained = prog.XP.deedBid;
      quest('deed');
      markIt('deed');
      offer('bid', exact(c.args.amount), `for ${shopName(c.args.shop_id)}`);
    }
    if (c.method === 'pay_guild') gained = prog.XP.guildPayIn;
    if (c.method === 'claim_festival') {
      gained = prog.XP.festivalClaim;
      p.progress.stats.festival = (p.progress.stats.festival ?? 0) + meri(c.value);
      markIt('festival');
    }
    // V4: social money, boosts, predictions, shop coins, the tournament, crafting.
    const who = p.name || accountId.split('.')[0];
    const amt = (v: unknown) => exact(v).toFixed(2);
    const KEEPERS: Record<string, string> = { lumberyard: 'Brann', mine: 'Petra', granary: 'Wen', smith: 'Hilde', baker: 'Oswin', store: 'Mabel' };
    if (c.method === 'tip') {
      gained = 2;
      const memo = c.args.memo ? `: “${String(c.args.memo).slice(0, 80)}”` : '';
      feed.post({ kind: 'tip', text: `${who} tipped ${String(c.args.receiver_id).split('.')[0]} ${amt(c.args.amount)} MERI${memo}`, who: accountId, tx: String(txHash) });
    }
    if (c.method === 'burn_for_boost') gained = 5; // the crier announces boosts as it reads them from the chain
    if (c.method === 'predict') {
      gained = 3;
      feed.post({ kind: 'bet', text: `${who} staked ${amt(c.args.amount)} MERI that this week’s Festival will be ${c.args.hit ? 'hit' : 'missed'}`, who: accountId, tx: String(txHash) });
    }
    if (c.method === 'claim_prediction' && exact(c.value) > 0) feed.post({ kind: 'bet', text: `${who} won ${amt(c.value)} MERI on the Festival prediction`, who: accountId, tx: String(txHash) });
    if (c.method === 'buy_shop_coin' || c.method === 'sell_shop_coin') {
      gained = 3;
      const ticker = `$${(KEEPERS[c.args.shop_id] ?? c.args.shop_id).toUpperCase()}`;
      feed.post({ kind: 'coin', text: `${who} ${c.method === 'buy_shop_coin' ? 'bought' : 'sold'} ${c.args.coins} ${ticker} for ${amt(c.value)} MERI`, who: accountId, tx: String(txHash) });
    }
    if (c.method === 'enter_tournament') {
      gained = 5;
      feed.post({ kind: 'tourney', text: `${who} entered this week’s tournament. Biggest single sale wins the pot`, who: accountId, tx: String(txHash) });
    }
    if (c.method === 'craft_tool') {
      gained = 15;
      const name = { axe: 'a Silver Axe', pick: 'an Iron Pick', sickle: 'a Golden Sickle' }[String(c.args.kind)] ?? 'a tool';
      feed.post({ kind: 'craft', text: `${who} forged ${name} at the Forge`, who: accountId, tx: String(txHash) });
    }
    const before = prog.levelOf(p.progress.xp).level;
    p.progress.xp += gained;
    players.save();
    const after = prog.levelOf(p.progress.xp);
    const nm = p.name || accountId.split('.')[0];
    if (c.method === 'sell' && exact(c.value) >= 10) feed.post({ kind: 'sale', text: `${nm} sold ${c.args.quantity} ${c.args.item} to ${shopName(c.args.shop_id)} for ${exact(c.value).toFixed(2)} MERI`, who: accountId, tx: String(txHash) });
    if (c.method === 'deliver') feed.post({ kind: 'contract', text: `${nm} filled a delivery contract for ${exact(c.value).toFixed(2)} MERI`, who: accountId, tx: String(txHash) });
    if (c.method === 'bid_for_deed') feed.post({ kind: 'deed', text: `${nm} bid ${exact(c.args.amount).toFixed(0)} MERI for ${shopName(c.args.shop_id)}`, who: accountId, tx: String(txHash) });
    if (c.method === 'claim_festival') feed.post({ kind: 'festival', text: `${nm} claimed a Festival share of ${exact(c.value).toFixed(2)} MERI`, who: accountId, tx: String(txHash) });
    if (newRecord) feed.post({ kind: 'record', text: `New town record: ${newRecord}, by ${nm}`, who: accountId, tx: String(txHash) });
    return { xp: gained, quests: done, marks, record: newRecord, levelUp: after.level > before ? after : null };
  }

  if (req.method === 'GET' && url.pathname === '/api/leaders') {
    return leaders;
  }

  if (req.method === 'POST' && url.pathname === '/api/gather') {
    const accountId = await authenticate(req, body);
    const { ground, swings, timing, tool } = JSON.parse(body);
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
    // A crafted tool NFT adds a unit per swing on chain; the contract checks the player holds it.
    const got = await enqueue({ player: accountId, item, quantity: wanted, ...(typeof tool === 'string' && /^tool-\d+$/.test(tool) ? { tool } : {}) });
    // Swings that found nothing (the ground was bare) cost nothing.
    if (got < wanted) {
      const wasted = Math.floor((wanted - got) / (withTool > 0 ? R.toolYield : 1));
      players.setStamina(p, players.staminaNow(p, dayMs) + wasted * R.swingCost);
    }
    const before = prog.levelOf(p.progress.xp).level;
    // The timing ring: a well-timed swing earns bonus XP (never extra goods, so it can't be farmed
    // for coin). The grade comes from the client; at worst a cheat earns a little XP.
    const grade = got > 0 && (timing === 'perfect' || timing === 'good') ? timing : 'ok';
    const bonus = grade === 'perfect' ? 3 : grade === 'good' ? 1 : 0;
    p.progress.xp += got * prog.XP.perUnitGathered + bonus;
    p.progress.stats.gathered += got;
    const q = got > 0 ? prog.complete(p.progress, 'swing') : null;
    const marks: string[] = [];
    const markIt = (id: string) => {
      const m = prog.mark(p.progress, id);
      if (m) {
        marks.push(m);
        chainMark(accountId, id);
      }
    };
    let record: string | null = null;
    if (got > 0) {
      markIt(item);
      if (world) bounties.credit(world.town.week, guildViews, accountId, item, got);
      if (grade === 'perfect') {
        p.progress.perfect = (p.progress.perfect ?? 0) + 1;
        p.progress.perfectRun = (p.progress.perfectRun ?? 0) + 1;
        p.progress.bestPerfectRun = Math.max(p.progress.bestPerfectRun ?? 0, p.progress.perfectRun);
        markIt('perfect');
        if (p.progress.perfect >= 10) markIt('perfect10');
        if (records.offer('perfectRun', { who: accountId, value: p.progress.perfectRun, detail: `perfect swings in a row` })) record = records.RECORD_LABELS.perfectRun.title;
      } else p.progress.perfectRun = 0;
      if (records.offer('gather', { who: accountId, value: p.progress.stats.gathered, detail: 'goods gathered in all' })) record ??= records.RECORD_LABELS.gather.title;
    }
    players.save();
    if (grade === 'perfect' && [5, 10, 20].includes(p.progress.perfectRun ?? 0)) feed.post({ kind: 'perfect', text: `${p.name} landed ${p.progress.perfectRun} perfect swings in a row`, who: accountId });
    if (record) feed.post({ kind: 'record', text: `New town record: ${record}, by ${p.name}`, who: accountId });
    const after = prog.levelOf(p.progress.xp);
    return {
      item, gathered: got, wanted, stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses, xp: got + bonus, timing: grade, bonusXp: bonus,
      perfectRun: p.progress.perfectRun ?? 0, quests: q ? [q.title] : [], marks, record, levelUp: after.level > before ? after : null,
    };
  }

  if (req.method === 'POST' && url.pathname === '/api/chest') {
    // The daily chest: stamina, XP and sometimes a borrowed tool, more for each day in a row.
    const accountId = await authenticate(req, body);
    const p = players.get(accountId)!;
    const before = prog.levelOf(p.progress.xp).level;
    const got = prog.openChest(p.progress);
    if (!got) throw new HttpError(409, 'Today’s chest is already open. Come back tomorrow.');
    players.setStamina(p, Math.min(prog.maxStamina(p.progress), players.staminaNow(p, dayMs) + got.stamina));
    p.toolUses += got.toolUses;
    players.save();
    feed.post({ kind: 'chest', text: got.streak >= 3 ? `${p.name} opened the daily chest: ${got.streak} days in a row` : '', who: accountId });
    const after = prog.levelOf(p.progress.xp);
    return { ...got, stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses, xp: got.xp, levelUp: after.level > before ? after : null };
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
    const marks: string[] = [];
    const markIt = (id: string) => {
      const m = prog.mark(p.progress, id);
      if (m) {
        marks.push(m);
        chainMark(accountId, id);
      }
    };
    if (purpose === 'cottage') {
      built = prog.build(p.progress, used.item as 'tool' | 'bread', used.quantity);
      if (p.progress.cottage.level >= 2) {
        const q = prog.complete(p.progress, 'cottage');
        if (q) done.push(q.title);
        markIt('cottage');
      }
    } else {
      if (used.item === 'tool') markIt('tool');
      if (used.item === 'bread') {
        markIt('bread');
        players.setStamina(p, Math.min(prog.maxStamina(p.progress), players.staminaNow(p, dayMs) + used.quantity * R.breadStamina));
        p.progress.xp += prog.XP.eat;
        const q = prog.complete(p.progress, 'eat');
        if (q) done.push(q.title);
      }
      if (used.item === 'tool') p.toolUses += used.quantity * R.toolDurability;
    }
    players.save();
    const after = prog.levelOf(p.progress.xp);
    return { stamina: players.staminaNow(p, dayMs), toolUses: p.toolUses, built, cottage: p.progress.cottage, quests: done, marks, levelUp: after.level > before ? after : null };
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

const TYPES: Record<string, string> = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.glb': 'model/gltf-binary', '.txt': 'text/plain', '.webmanifest': 'application/manifest+json' };

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
  startTownsfolk(() => world, enqueue);
  console.log(`Meridian game server on http://localhost:${PORT} — town ${TOWN}, game account ${GAME}`);
});
