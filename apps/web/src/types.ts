// Shapes returned by the town contract's views. Amounts are micro-MERI strings.
export const ITEMS = ['wood', 'ore', 'wheat', 'bread', 'tool'] as const;
export type Item = (typeof ITEMS)[number];

export const ICON: Record<Item, string> = { wood: '🪵', ore: '⛏️', wheat: '🌾', bread: '🍞', tool: '🔨' };

export const KEEPERS: Record<string, { keeper: string; trade: string }> = {
  lumberyard: { keeper: 'Brann', trade: 'buys and sells wood' },
  mine: { keeper: 'Petra', trade: 'buys and sells ore' },
  granary: { keeper: 'Wen', trade: 'buys and sells wheat' },
  smith: { keeper: 'Hilde', trade: 'forges tools from wood and ore' },
  baker: { keeper: 'Oswin', trade: 'bakes bread from wheat' },
  store: { keeper: 'Mabel', trade: 'sells bread and tools retail' },
};

export interface Params {
  day_ms: number;
  days_per_week: number;
  base: string[];
  spread_bps: number;
  max_stock_mult: number;
  cash_comfort: string;
  min_cash_factor_bps: number;
  trade_tax_bps: number;
  ground_regen_per_day: number[];
  ground_capacity_days: number;
  auction_reserve: string;
  auction_min_raise_bps: number;
}

export interface Shop {
  shop: { id: string; name: string; buys: Item[]; sells: Item[]; target: number[]; open: boolean; agent: string | null; dividends_paid: string };
  account: string;
  deed_holder: string;
  auction: Auction | null;
  cash: string;
  stock: number[];
  ask: string[];
  bid: string[];
}

export interface Auction {
  shop_id: string;
  kind: 'sale' | 'bankruptcy';
  ends_day: number;
  high_bidder: string | null;
  high_bid: string;
}

export interface TownView {
  day: number;
  processed_days: number;
  week: number;
  week_target: string;
  week_counted: string;
  streak: number;
  best_streak: number;
  treasury: string;
  supply: string;
  festival_pool: string;
  grounds: number[];
}

export interface Job {
  id: number;
  shop_id: string;
  item: Item;
  remaining: number;
  unit_price: string;
  deadline_ns: number;
}

export interface Player {
  coins: string;
  items: number[];
  week: { week: number; volume: string };
  claimable: string;
}

export interface WeekResult {
  week: number;
  target: string;
  counted: string;
  hit: boolean;
  minted: string;
  burned: string;
  streak: number;
}

export const meri = (micro: string | number | bigint) => Number(micro) / 1e6;
export const fmt = (micro: string | number | bigint, digits = 2) =>
  meri(micro).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits });
export const short = (account: string) => account.split('.')[0];

export interface AgentReport {
  shopId: string;
  accountId: string;
  mode: 'llm' | 'rules';
  say: string;
  reasoning: string;
  acted: { what: string; tx?: string; error?: string }[];
  at: number;
}
