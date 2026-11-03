// Every tunable number in the town lives here. RULES.md documents what each one does;
// the contracts read the same values at launch and can't change them afterwards.

export const ITEMS = ['wood', 'ore', 'wheat', 'bread', 'tool'] as const;
export type Item = (typeof ITEMS)[number];
export const RAW: readonly Item[] = ['wood', 'ore', 'wheat'];

export type Params = typeof DEFAULT_PARAMS;

export const DEFAULT_PARAMS = {
  ticksPerDay: 12,
  daysPerWeek: 7,

  // Reference price of each item, in MERI.
  base: { wood: 4, ore: 6, wheat: 3, bread: 8, tool: 24 } as Record<Item, number>,

  // Pricing (RULES.md §2)
  spread: 0.2, // bid = ask * (1 - spread)
  maxStockMult: 3, // a shop stops buying above 3x its target stock
  cashComfort: 600, // below this, a shop's bids shrink in proportion
  minCashFactor: 0.25,
  tradeTax: 0.02, // share of every player<->shop trade paid to the town treasury

  // Shops (RULES.md §3)
  upkeep: 25, // MERI per shop per day, paid to the treasury
  missedUpkeepToClose: 2,
  auctionReserve: 300,
  auctionDaysBeforeTownRescue: 3,
  dividendShare: 0.5, // of a profitable day's gain, once cash is above cashComfort
  cashCeiling: 2000, // everything a shop holds above this is paid to the deed holder

  // Production per day
  blacksmithCapacity: 60, // tools/day, 1 wood + 1 ore each
  bakerCapacity: 200, // bread/day, 1 wheat each

  // Residents (demand funded by the treasury)
  residents: 100,
  stipendRate: 0.02, // share of treasury paid to residents each day
  residentBreadPerDay: 1,
  residentToolEveryDays: 3,

  // Gathering grounds: shared pools that regrow each day (RULES.md §4)
  groundRegenPerDay: { wood: 45, ore: 45, wheat: 115 } as Record<Item, number>,
  groundCapacityDays: 1, // a ground holds at most this many days of regrowth

  // Players (RULES.md §4)
  maxStamina: 100,
  staminaRegenPerDay: 30,
  swingCost: 5,
  swingsPerActiveTick: 4,
  activeTicksPerDay: 4,
  breadStamina: 25,
  toolYield: 2,
  toolDurability: 25,
  starterCoins: 50,
  // Home upgrades: players spend savings above a buffer on tools and bread for their cottage.
  homeBuffer: 150,
  homeSpendRate: 0.4, // share of cash above the buffer spent per day

  // Delivery contracts (RULES.md §5)
  jobTriggerStock: 0.3, // post when stock < 30% of target
  jobPremium: 0.15, // over current bid
  jobHours: 6,

  // Caravan (RULES.md §6)
  importMarkup: 1.4, // suppliers' cost vs base, before their bid noise
  exportDiscount: 0.55, // outside buyers' value vs base
  exportAbove: 1.5, // shops sell stock above this x target into the export bid
  // Outside buyers bid less as their coin runs low: price x min(1, cash / outsideStartCoins).
  bidNoise: 0.1,
  suppliers: 3,
  outsideStartCoins: 30000,

  // Festival (RULES.md §7)
  playerVolumeCap: 500, // MERI of shop trades counted per player per week
  minQualifyingVolume: 20,
  targetFloor: 1000,
  targetGrowth: 0.95, // next target = growth * mean(last two weeks' counted volume)
  festivalMintRate: 0.01, // of total supply, minted to qualifying players
  missBurnRate: 0.05, // of town treasury

  // Genesis supply
  genesisTreasury: 20000,
  genesisShopCash: 1500,
};
