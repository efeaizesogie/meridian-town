// Writes the price grid the contract tests check against, so the Rust market and the
// TypeScript engine can't drift apart.  node sim/export-fixtures.ts
import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS as p, ITEMS, askPrice, bidPrice } from '../packages/economy/src/index.ts';

const MICRO = 1_000_000;
const cases = [];
for (const item of ITEMS)
  for (const target of [10, 30, 100, 150])
    for (const stock of [0, 1, 5, target / 2, target - 1, target, target * 2, target * 3 - 1, target * 3])
      for (const cash of [0.5, 100, 300, 600, 5000]) {
        const s = Math.floor(stock);
        cases.push({
          item, stock: s, target,
          cash: Math.round(cash * MICRO),
          ask: Math.floor(askPrice(p.base[item], s, target) * MICRO),
          bid: Math.floor(bidPrice(p.base[item], s, target, cash, p) * MICRO),
        });
      }

const out = new URL('../contracts/town/tests/fixtures/prices.json', import.meta.url);
writeFileSync(out, JSON.stringify({ base: p.base, spread: p.spread, maxStockMult: p.maxStockMult, cashComfort: p.cashComfort, minCashFactor: p.minCashFactor, cases }, null, 0));
console.log(`wrote ${cases.length} price cases`);
