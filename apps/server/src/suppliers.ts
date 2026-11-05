// Supplier agents: outside traders who bid in the caravan's sealed-bid rounds. Each has its
// own account whose key can call only caravan_commit and caravan_reveal, and its own pricing
// temperament. Anyone else can bid too: the contract doesn't know or care who runs them.
//
// A sealed bid is "<day>:<item>:<price>:<salt>:<supplier>" hashed. The salt is written to
// disk before the commit is sent, so a restart between commit and reveal doesn't lose it.
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { teraToGas } from 'near-api-js';
import { TOWN } from './chain.ts';
import { KeyStore, withRetries } from './accounts.ts';

type Raw = 'wood' | 'ore' | 'wheat';
const METHODS = ['caravan_commit', 'caravan_reveal'];

/** How each trader prices: a margin over import cost, or a share of what shops will pay. */
export const SUPPLIERS: Record<string, { name: string; account: string; style: string; price: (cost: number, maxPay: number) => number }> = {
  varga: {
    name: 'Varga’s Caravan', account: 'varga', style: 'steady: cost plus about 15%',
    price: (cost) => cost * (1.12 + Math.random() * 0.06),
  },
  sable: {
    name: 'Sable Traders', account: 'sable', style: 'undercutter: cost plus 3–8%',
    price: (cost) => cost * (1.03 + Math.random() * 0.05),
  },
  longroad: {
    name: 'The Long Road Co.', account: 'longroad', style: 'greedy: close to what the shops will bear',
    price: (cost, maxPay) => Math.max(cost * 1.25, maxPay * (0.82 + Math.random() * 0.1)),
  },
};

interface Sealed { day: number; item: Raw; price: string; salt: string; committed?: string; revealed?: string; error?: string }

import { dataFile } from './data.ts';

const BIDS = dataFile('supplier-bids.json');
let bids: Record<string, Sealed[]> = existsSync(BIDS) ? JSON.parse(readFileSync(BIDS, 'utf8')) : {};
const saveBids = () => {
  writeFileSync(BIDS, JSON.stringify(bids, null, 1));
};

const store = new KeyStore('suppliers.json');
export const supplierAccount = (id: string) => store.accountId(id, SUPPLIERS[id].account);
export const getSupplierBids = () =>
  Object.fromEntries(Object.keys(SUPPLIERS).map(id => [id, { ...SUPPLIERS[id], price: undefined, accountId: supplierAccount(id), bids: (bids[id] ?? []).slice(-6) }]));

const seal = (day: number, item: string, price: string, salt: string, supplier: string) =>
  createHash('sha256').update(`${day}:${item}:${price}:${salt}:${supplier}`).digest('hex');

interface CaravanView {
  round: { day: number; orders: { shop_id: string; item: Raw; quantity: number; max_price: string }[] } | null;
  phase: 'commit' | 'reveal' | 'closed';
  import_cost: string[];
}

async function tick(caravan: CaravanView | null) {
  if (!caravan?.round) return;
  const day = caravan.round.day;
  const items = [...new Set(caravan.round.orders.map(o => o.item))];
  for (const id of Object.keys(SUPPLIERS)) {
    if (!store.ready(id)) continue;
    const mine = (bids[id] ??= []);
    const signer = store.signer(id);
    const me = supplierAccount(id);
    if (caravan.phase === 'commit') {
      for (const item of items) {
        if (mine.some(b => b.day === day && b.item === item)) continue;
        const cost = Number(caravan.import_cost[['wood', 'ore', 'wheat'].indexOf(item)]);
        const maxPay = Math.max(...caravan.round.orders.filter(o => o.item === item).map(o => Number(o.max_price)));
        const price = String(Math.max(Math.ceil(cost), Math.round(SUPPLIERS[id].price(cost, maxPay))));
        const b: Sealed = { day, item, price, salt: randomBytes(12).toString('hex') };
        mine.push(b);
        saveBids();
        try {
          const res: any = await signer.callFunctionRaw({ contractId: TOWN, methodName: 'caravan_commit', args: { item, hash: seal(day, item, price, b.salt, me) }, gas: teraToGas(30) });
          b.committed = res.transaction.hash;
        } catch (e) {
          b.error = (e instanceof Error ? e.message : String(e)).slice(0, 160);
        }
        saveBids();
      }
    }
    if (caravan.phase === 'reveal') {
      for (const b of mine.filter(b => b.day === day && b.committed && !b.revealed && !b.error)) {
        try {
          const res: any = await signer.callFunctionRaw({ contractId: TOWN, methodName: 'caravan_reveal', args: { item: b.item, price: b.price, salt: b.salt }, gas: teraToGas(30) });
          b.revealed = res.transaction.hash;
          console.log(`[supplier ${id}] revealed ${b.item} at ${(Number(b.price) / 1e6).toFixed(2)}`);
        } catch (e) {
          b.error = (e instanceof Error ? e.message : String(e)).slice(0, 160);
        }
        saveBids();
      }
    }
    bids[id] = mine.slice(-30);
  }
}

export async function startSuppliers(readCaravan: () => CaravanView | null) {
  if (process.env.AGENTS === 'off') return;
  await withRetries('supplier accounts', async () => {
    for (const id of Object.keys(SUPPLIERS)) await store.ensure(id, SUPPLIERS[id].account, METHODS);
  });
  console.log(`supplier agents: ${Object.keys(SUPPLIERS).filter(id => store.ready(id)).length} ready`);
  setInterval(() => tick(readCaravan()).catch(e => console.error('supplier tick', e instanceof Error ? e.message : e)), 30_000).unref();
}
