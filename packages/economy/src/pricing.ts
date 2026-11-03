import type { Params } from './params.ts';

// RULES.md §2. Integer-friendly on purpose: the market contract computes the same
// thing with u128 fixed point, no pow/log.

/** Stock multiplier: 4x at empty, 1x at target, 0.25x at 3x target. */
export function stockMultiplier(stock: number, target: number): number {
  const r = (2 * target) / (Math.max(stock, 0) + target);
  return r * r;
}

export function askPrice(base: number, stock: number, target: number): number {
  return base * stockMultiplier(stock, target);
}

export function cashFactor(cash: number, p: Params): number {
  return Math.min(1, Math.max(p.minCashFactor, cash / p.cashComfort));
}

/** What a shop pays for one unit, or 0 if it won't buy. */
export function bidPrice(base: number, stock: number, target: number, cash: number, p: Params): number {
  if (stock >= target * p.maxStockMult) return 0;
  const bid = askPrice(base, stock + 1, target) * (1 - p.spread) * cashFactor(cash, p);
  return bid <= cash ? bid : 0;
}

export function explainPrice(base: number, stock: number, target: number, cash: number, p: Params): string {
  const m = stockMultiplier(stock, target);
  const cf = cashFactor(cash, p);
  return [
    `base ${base}`,
    `stock ${stock}/${target} -> x${m.toFixed(2)}`,
    `ask ${(base * m).toFixed(2)}`,
    `bid = ask(stock+1) x ${(1 - p.spread).toFixed(2)}${cf < 1 ? ` x cash ${cf.toFixed(2)}` : ''}`,
  ].join(' | ');
}
