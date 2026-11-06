// The town crier: a feed of real moments (contracts, closures, records, shocks, the Festival)
// built by watching the chain state change, plus a price history so charts can show what
// shocks did. Everything here is derived from the chain or from transactions the server checked.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataFile } from './data.ts';

export interface FeedItem { id: number; at: number; kind: string; text: string; who?: string; tx?: string }

const FEED_FILE = dataFile('feed.json');
const PRICE_FILE = dataFile('prices.json');
const ITEMS = ['wood', 'ore', 'wheat', 'bread', 'tool'] as const;
const KEEPER: Record<string, string> = { lumberyard: 'Brann', mine: 'Petra', granary: 'Wen', smith: 'Hilde', baker: 'Oswin', store: 'Mabel' };

let items: FeedItem[] = existsSync(FEED_FILE) ? JSON.parse(readFileSync(FEED_FILE, 'utf8')) : [];
let nextId = (items.at(-1)?.id ?? 0) + 1;
let dirty = false;

/** A price point: what shops pay for raw goods and what bread and tools cost, in MERI. */
export interface PricePoint { at: number; price: (number | null)[] }
let prices: PricePoint[] = existsSync(PRICE_FILE) ? JSON.parse(readFileSync(PRICE_FILE, 'utf8')) : [];
let pricesDirty = false;

setInterval(() => {
  if (dirty) { writeFileSync(FEED_FILE, JSON.stringify(items)); dirty = false; }
  if (pricesDirty) { writeFileSync(PRICE_FILE, JSON.stringify(prices)); pricesDirty = false; }
}, 5000).unref();

export function post(i: Omit<FeedItem, 'id' | 'at'>) {
  if (!i.text) return;
  items.push({ ...i, id: nextId++, at: Date.now() });
  if (items.length > 200) items = items.slice(-200);
  dirty = true;
}

export const recent = (n = 40) => items.slice(-n).reverse();

const m = (micro: string | number | bigint) => Number(micro) / 1e6;

/** What a player meets for each good right now. */
function pricesNow(world: any): (number | null)[] {
  return ITEMS.map((item, i) => {
    const open = world.shops.filter((s: any) => s.shop.open);
    if (i < 3) {
      const bids = open.filter((s: any) => s.shop.buys.includes(item)).map((s: any) => m(s.bid[i])).filter((v: number) => v > 0);
      return bids.length ? Math.max(...bids) : null;
    }
    const asks = open.filter((s: any) => s.shop.sells.includes(item) && s.stock[i] > 0).map((s: any) => m(s.ask[i]));
    return asks.length ? Math.min(...asks) : null;
  });
}

let lastPriceAt = prices.at(-1)?.at ?? 0;

/** Compare two snapshots of the town and announce what changed. */
export function watch(prev: any, world: any) {
  if (Date.now() - lastPriceAt > 5 * 60_000) {
    lastPriceAt = Date.now();
    prices.push({ at: lastPriceAt, price: pricesNow(world) });
    prices = prices.filter(p => p.at > Date.now() - 2 * 86_400_000);
    pricesDirty = true;
  }
  if (!prev) return;
  const name = (id: string) => world.shops.find((s: any) => s.shop.id === id)?.shop.name ?? id;
  for (const j of world.jobs) {
    if (!prev.jobs.some((p: any) => p.id === j.id)) {
      post({ kind: 'contract', text: `${KEEPER[j.shop_id] ?? name(j.shop_id)} posted a contract: ${j.remaining} ${j.item} at ${m(j.unit_price).toFixed(2)} each, paid in advance` });
    }
  }
  for (const s of world.shops) {
    const was = prev.shops.find((p: any) => p.shop.id === s.shop.id);
    if (!was) continue;
    if (was.shop.open && !s.shop.open) post({ kind: 'closed', text: `${s.shop.name} couldn’t pay its upkeep and closed. Its deed is up for auction` });
    if (!was.shop.open && s.shop.open) post({ kind: 'opened', text: `${s.shop.name} is open again` });
    if (was.deed_holder !== s.deed_holder && String(s.deed_holder).includes('.game.')) {
      post({ kind: 'deed', text: `${String(s.deed_holder).split('.')[0]} now holds the deed to ${s.shop.name}`, who: s.deed_holder });
    }
  }
  const target = m(world.town.week_target);
  const before = m(prev.town.week_counted) / target;
  const after = m(world.town.week_counted) / target;
  for (const mark of [0.25, 0.5, 0.75, 1]) {
    if (prev.town.week === world.town.week && before < mark && after >= mark) {
      post({ kind: 'festival', text: mark === 1 ? `The town hit its Festival target: ${target.toFixed(0)} MERI traded this week!` : `The Festival is ${mark * 100}% there: ${(target - m(world.town.week_counted)).toFixed(0)} MERI of trade to go` });
    }
  }
  if (prev.town.week !== world.town.week) {
    const w = world.weeks.at?.(-1);
    if (w && w.week === prev.town.week) {
      post({ kind: 'festival', text: w.hit ? `Festival! Week ${w.week + 1} traded ${m(w.counted).toFixed(0)} MERI and ${m(w.minted).toFixed(0)} new MERI went to the traders` : `No Festival in week ${w.week + 1}: ${m(w.counted).toFixed(0)} of ${m(w.target).toFixed(0)} traded, and ${m(w.burned).toFixed(0)} MERI of the treasury burned` });
    }
  }
}

/** The last two days of prices, for charts. */
export const priceHistory = () => ({ items: ITEMS, points: prices });

/** A few plain headlines about the market right now: what moved, what's short, what's on. */
export function standout(world: any): string[] {
  const out: string[] = [];
  const now = pricesNow(world);
  const dayAgo = prices.find(p => p.at > Date.now() - 86_400_000 - 10 * 60_000);
  if (dayAgo) {
    const moves = ITEMS.map((item, i) => ({ item, from: dayAgo.price[i], to: now[i] }))
      .filter(x => x.from && x.to)
      .map(x => ({ ...x, pct: (x.to! / x.from! - 1) * 100 }))
      .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
    const big = moves[0];
    if (big && Math.abs(big.pct) >= 10) out.push(`${big.item[0].toUpperCase() + big.item.slice(1)} ${big.item === 'bread' || big.item === 'tool' ? 'costs' : 'pays'} ${Math.abs(big.pct).toFixed(0)}% ${big.pct > 0 ? 'more' : 'less'} than this time yesterday.`);
  }
  const full = world.shops.filter((s: any) => s.shop.open).flatMap((s: any) => (['wood', 'ore', 'wheat'] as const)
    .filter((item, i) => s.shop.buys.includes(item) && BigInt(s.bid[i]) === 0n).map(item => `${KEEPER[s.shop.id]} is full of ${item}`));
  if (full.length) out.push(`${full.slice(0, 2).join(' and ')}: sell elsewhere.`);
  const short = world.shops.filter((s: any) => s.shop.open).flatMap((s: any) => (['wood', 'ore', 'wheat'] as const)
    .filter((item, i) => s.shop.buys.includes(item) && s.stock[i] < s.shop.target[i] * 0.5).map(item => `${KEEPER[s.shop.id]} is short of ${item}`));
  if (short.length) out.push(`${short.slice(0, 2).join(' and ')}: the best prices in town.`);
  if (world.jobs.length) out.push(`${world.jobs.length} delivery contract${world.jobs.length > 1 ? 's are' : ' is'} open on the Notice Board.`);
  const closed = world.shops.filter((s: any) => !s.shop.open);
  if (closed.length) out.push(`${closed.map((s: any) => s.shop.name).join(' and ')} ${closed.length > 1 ? 'are' : 'is'} closed, and the deed${closed.length > 1 ? 's are' : ' is'} at auction.`);
  const target = m(world.town.week_target);
  const left = target - m(world.town.week_counted);
  out.push(left > 0 ? `The town needs ${left.toFixed(0)} more MERI of trade for this week’s Festival.` : 'The Festival target is already met this week.');
  return out;
}
