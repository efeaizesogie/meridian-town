// Townsfolk: three residents the game runs so the market never sits still between players.
// They gather, sell where it pays, take delivery contracts, and buy bread and tools that they
// actually eat and wear out. That consumption is what makes the bakery and the forge run
// short, which is what makes the merchants buy, post contracts and move their prices.
//
// They are ordinary players on chain (their own accounts, a key limited to the town), shown
// in the game as townsfolk, and they play by the same rules: no stamina tricks beyond a modest
// gather per turn, the same prices, the same 2% tax. They act one at a time, every TICK_MS.
import { Account, nearToYocto, teraToGas, actions } from 'near-api-js';
import { TOWN, game, provider, view } from './chain.ts';
import { KeyStore, withRetries } from './accounts.ts';
import type { GatherOrder } from './chain.ts';

type Item = 'wood' | 'ore' | 'wheat' | 'bread' | 'tool';
const ITEMS: Item[] = ['wood', 'ore', 'wheat', 'bread', 'tool'];
const RAW: Item[] = ['wood', 'ore', 'wheat'];

export const TOWNSFOLK: Record<string, { name: string; account: string; habit: string }> = {
  ivy: { name: 'Ivy', account: 'ivy', habit: 'a woodcutter who likes her bread' },
  rowan: { name: 'Rowan', account: 'rowan', habit: 'a miner who goes through tools' },
  tamsin: { name: 'Tamsin', account: 'tamsin', habit: 'a farmhand who takes any contract going' },
};

const TICK_MS = Number(process.env.TOWNSFOLK_TICK_MS ?? 80_000);
const GATHER_PER_TURN = 4;
const BUY_LOT = 4;   // loaves or tools bought in one go
const FLIP_LOT = 15; // raw goods carried between shops in one trip
const store = new KeyStore('townsfolk.json');
export const townsfolkAccount = (id: string) => store.accountId(id, TOWNSFOLK[id].account);

export interface TownsfolkReport { id: string; name: string; accountId: string; did: string; at: number }
const reports: Record<string, TownsfolkReport> = {};
export const getTownsfolk = () => Object.values(reports);

interface ShopLite { shop: { id: string; name: string; open: boolean; buys: Item[]; sells: Item[] }; ask: string[]; bid: string[] }
interface JobLite { id: number; item: Item; remaining: number; unit_price: string }
interface WorldLite { shops: ShopLite[]; jobs: JobLite[] }

const meri = (micro: string | number) => Number(micro) / 1e6;

async function act(signer: Account, methodName: string, args: object, tgas = 40) {
  return signer.callFunction({ contractId: TOWN, methodName, args, gas: teraToGas(tgas) });
}

/** One turn for one resident: eat or equip, sell, deliver, buy, or gather, whichever fits. */
export async function townsfolkTurn(id: string, world: WorldLite, gather: (o: GatherOrder) => Promise<number>): Promise<string> {
  const me = townsfolkAccount(id);
  const signer = store.signer(id);
  const player = await view<{ coins: string; items: number[] }>('get_player', { account_id: me });
  const have = (item: Item) => player.items[ITEMS.indexOf(item)] ?? 0;
  const coins = meri(player.coins);
  const open = world.shops.filter(s => s.shop.open);

  // Eat what was bought last turn, or put the tools to work: this is the town's demand.
  if (have('bread') > 0) {
    const n = Math.min(have('bread'), 20);
    await act(signer, 'use_item', { item: 'bread', quantity: n }, 30);
    return n === 1 ? 'ate a loaf' : `shared ${n} loaves at home`;
  }
  if (have('tool') > 0) {
    const n = Math.min(have('tool'), 20);
    await act(signer, 'use_item', { item: 'tool', quantity: n }, 30);
    return n === 1 ? 'wore out a tool' : `wore out ${n} tools`;
  }

  // A contract for something in the pack pays best.
  const job = world.jobs.find(j => have(j.item) > 0);
  if (job) {
    const n = Math.min(have(job.item), job.remaining);
    await act(signer, 'deliver', { job_id: job.id, quantity: n }, 40);
    return `delivered ${n} ${job.item} on a contract`;
  }

  // Sell raw goods to whichever shop pays most.
  const sale = open
    .flatMap(s => RAW.map((item, i) => ({ s, item, n: have(item), price: meri(s.bid[ITEMS.indexOf(item)]), i })))
    .filter(x => x.n > 0 && x.price > 0)
    .sort((a, b) => b.price - a.price)[0];
  if (sale) {
    const cap = await view<number>('sell_capacity', { shop_id: sale.s.shop.id, item: sale.item });
    const n = Math.min(sale.n, cap, 20);
    if (n > 0) {
      const quote = BigInt(await view<string>('quote_sell', { shop_id: sale.s.shop.id, item: sale.item, quantity: n }));
      await act(signer, 'sell', { shop_id: sale.s.shop.id, item: sale.item, quantity: n, min_total: String((quote * 95n) / 100n) }, 40);
      return `sold ${n} ${sale.item} to ${sale.s.shop.name}`;
    }
  }

  // Trade: buy a raw good where it's piled up and cheap, sell it where it's short, when the
  // gap beats the tax on both sides. This is what empties a glutted granary into the bakery.
  const flip = await bestFlip(open, coins);
  if (flip) {
    const quote = BigInt(await view<string>('quote_buy', { shop_id: flip.from.shop.id, item: flip.item, quantity: flip.n }));
    await act(signer, 'buy', { shop_id: flip.from.shop.id, item: flip.item, quantity: flip.n, max_total: String((quote * 104n) / 100n) }, 60);
    return `bought ${flip.n} ${flip.item} at ${flip.from.shop.name} to sell on`;
  }

  // Buy bread for the household, or now and then tools, a few at a time when the purse allows.
  const want: Item = id === 'rowan' && Math.random() < 0.5 ? 'tool' : 'bread';
  const seller = open
    .filter(s => s.shop.sells.includes(want) && s.ask[ITEMS.indexOf(want)] !== '0')
    .sort((a, b) => Number(a.ask[ITEMS.indexOf(want)]) - Number(b.ask[ITEMS.indexOf(want)]))[0];
  const unit = seller ? meri(seller.ask[ITEMS.indexOf(want)]) * 1.05 : 0;
  if (seller && unit > 0 && coins > unit + 1) {
    const n = Math.max(1, Math.min(BUY_LOT, Math.floor((coins * 0.6) / unit)));
    const quote = BigInt(await view<string>('quote_buy', { shop_id: seller.shop.id, item: want, quantity: n }));
    if (meri(quote.toString()) * 1.03 <= coins) {
      await act(signer, 'buy', { shop_id: seller.shop.id, item: want, quantity: n, max_total: String((quote * 105n) / 100n) }, 40);
      return n === 1 ? `bought ${want === 'bread' ? 'a loaf' : 'a tool'} at ${seller.shop.name}` : `bought ${n} ${want === 'bread' ? 'loaves' : 'tools'} at ${seller.shop.name}`;
    }
  }

  // Otherwise gather whatever pays best right now.
  const best = RAW.map((item, i) => ({ item, v: Math.max(0, ...open.map(s => Number(s.bid[i]))) })).sort((a, b) => b.v - a.v)[0];
  const got = await gather({ player: me, item: best.item as GatherOrder['item'], quantity: GATHER_PER_TURN });
  return got > 0 ? `gathered ${got} ${best.item}` : `found the ${best.item} ground bare`;
}

/** The best buy-low, sell-high trade in a raw good the purse can afford, if one pays. */
async function bestFlip(open: ShopLite[], coins: number) {
  if (coins < 5) return null;
  let best: { from: ShopLite; to: ShopLite; item: Item; n: number; gain: number } | null = null;
  for (const item of RAW) {
    const i = ITEMS.indexOf(item);
    const from = open.filter(s => s.shop.sells.includes(item) && s.ask[i] !== '0').sort((a, b) => Number(a.ask[i]) - Number(b.ask[i]))[0];
    const to = open.filter(s => s.shop.buys.includes(item) && s.bid[i] !== '0' && s !== from).sort((a, b) => Number(b.bid[i]) - Number(a.bid[i]))[0];
    if (!from || !to) continue;
    const ask = meri(from.ask[i]), bid = meri(to.bid[i]);
    if (bid * 0.98 < ask * 1.02 * 1.1) continue; // needs a 10% margin after tax both ways
    const n = Math.min(FLIP_LOT, Math.floor((coins * 0.8) / (ask * 1.03)));
    if (n < 2) continue;
    // Check the whole lot still pays once prices move along the curve.
    const [cost, take] = await Promise.all([
      view<string>('quote_buy', { shop_id: from.shop.id, item, quantity: n }).then(Number),
      view<string>('quote_sell', { shop_id: to.shop.id, item, quantity: n }).then(Number).catch(() => 0),
    ]);
    const gain = (take * 0.98 - cost * 1.02) / 1e6;
    if (gain > 1 && cost * 1.03 / 1e6 <= coins && (!best || gain > best.gain)) best = { from, to, item, n, gain };
  }
  return best;
}

/** Keep each resident in gas money from the game account. */
async function topUp(id: string) {
  const me = townsfolkAccount(id);
  const acct = await provider.viewAccount({ accountId: me }).catch(() => null);
  if (acct && BigInt(acct.amount) < nearToYocto('0.05')) {
    await game.signAndSendTransaction({ receiverId: me, actions: [actions.transfer(nearToYocto('0.1'))] });
    console.log(`[townsfolk] topped up ${me}`);
  }
}

export async function startTownsfolk(readWorld: () => WorldLite | null, gather: (o: GatherOrder) => Promise<number>) {
  if (process.env.TOWNSFOLK === 'off' || process.env.AGENTS === 'off') return;
  await withRetries('townsfolk accounts', async () => {
    for (const id of Object.keys(TOWNSFOLK)) await store.ensure(id, TOWNSFOLK[id].account, [], '0.2');
  });
  const ids = Object.keys(TOWNSFOLK).filter(id => store.ready(id));
  console.log(`townsfolk: ${ids.length} ready (${ids.map(townsfolkAccount).join(', ')})`);
  let n = 0;
  setInterval(async () => {
    const world = readWorld();
    if (!world || !ids.length) return;
    const id = ids[n++ % ids.length];
    try {
      await topUp(id);
      const did = await townsfolkTurn(id, world, gather);
      reports[id] = { id, name: TOWNSFOLK[id].name, accountId: townsfolkAccount(id), did, at: Date.now() };
      console.log(`[townsfolk] ${TOWNSFOLK[id].name} ${did}`);
    } catch (e) {
      console.error(`[townsfolk] ${id}:`, e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }, TICK_MS).unref();
}

