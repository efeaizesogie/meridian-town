// How a player grows (docs/GAME.md): XP and titles, the cottage, and the first-session
// quest chain. XP is only awarded for work the server has seen succeed on chain.

export const TITLES: [number, string][] = [
  [1, 'Wanderer'], [3, 'Peddler'], [5, 'Hauler'], [8, 'Trader'], [12, 'Merchant'], [17, 'Burgher'], [23, 'Patron of Meridian'],
];

/** Total XP needed to reach `level`. */
export const xpFor = (level: number) => Math.round(15 * Math.pow(level - 1, 1.7));

export function levelOf(xp: number) {
  let level = 1;
  while (xp >= xpFor(level + 1)) level++;
  const title = [...TITLES].reverse().find(([l]) => level >= l)![1];
  return { level, title, levelXp: xpFor(level), nextLevelXp: xpFor(level + 1) };
}

/** Cottage levels: each raises the stamina cap; building one burns tools and bread. */
export const COTTAGE = [
  { level: 1, maxStamina: 100, cost: { tool: 0, bread: 0 } },
  { level: 2, maxStamina: 125, cost: { tool: 1, bread: 3 } },
  { level: 3, maxStamina: 150, cost: { tool: 2, bread: 5 } },
  { level: 4, maxStamina: 175, cost: { tool: 4, bread: 8 } },
  { level: 5, maxStamina: 200, cost: { tool: 6, bread: 12 } },
];

export const XP = {
  perUnitGathered: 1,
  perMeriSold: 1,
  perMeriDelivered: 2,
  eat: 2,
  cottageLevel: 50,
  deedBid: 25,
  guildPayIn: 10,
  festivalClaim: 15,
};

export interface Quest {
  id: string;
  title: string;
  hint: string;
  /** The map location the quest marker points at. */
  place: string;
  xp: number;
}

export const QUESTS: Quest[] = [
  { id: 'swing', title: 'First swing', hint: 'Head to the Forest, the Mine or the Fields and swing your pick.', place: 'grounds', xp: 10 },
  { id: 'sell', title: 'Find the best buyer', hint: 'Sell what you gathered. Check every shop’s sign: an empty shop pays far more.', place: 'square', xp: 15 },
  { id: 'eat', title: 'Fuel up', hint: 'Buy a loaf at Oswin’s Bakery or Mabel’s Store, then eat it from your pack.', place: 'baker', xp: 15 },
  { id: 'deliver', title: 'Honest work', hint: 'Fill a delivery contract on the notice board. The money is already in escrow.', place: 'board', xp: 25 },
  { id: 'cottage', title: 'A roof over your head', hint: 'Bring tools and bread home and raise your cottage to level 2.', place: 'cottage', xp: 30 },
  { id: 'guild', title: 'Strength in numbers', hint: 'Ask to join a guild at the guild hall.', place: 'guildhall', xp: 30 },
  { id: 'deed', title: 'A stake in the town', hint: 'Bid for a shop’s deed at the auction house, alone or through your guild.', place: 'auction', xp: 50 },
];

export interface Progress {
  xp: number;
  cottage: { level: number; tool: number; bread: number };
  quests: Record<string, boolean>;
  stats: { gathered: number; sold: number; delivered: number; festival?: number };
  reported: string[];
}

export const freshProgress = (): Progress => ({
  xp: 0, cottage: { level: 1, tool: 0, bread: 0 }, quests: {}, stats: { gathered: 0, sold: 0, delivered: 0 }, reported: [],
});

/** Mark a quest done (once) and pay its XP. Returns the quest if it was newly completed. */
export function complete(p: Progress, id: string): Quest | null {
  if (p.quests[id]) return null;
  const q = QUESTS.find(q => q.id === id);
  if (!q) return null;
  p.quests[id] = true;
  p.xp += q.xp;
  return q;
}

/** Put materials into the cottage; build levels while there's enough. Returns levels gained. */
export function build(p: Progress, item: 'tool' | 'bread', quantity: number): number {
  p.cottage[item] += quantity;
  let gained = 0;
  for (;;) {
    const next = COTTAGE[p.cottage.level];
    if (!next || p.cottage.tool < next.cost.tool || p.cottage.bread < next.cost.bread) break;
    p.cottage.tool -= next.cost.tool;
    p.cottage.bread -= next.cost.bread;
    p.cottage.level++;
    p.xp += XP.cottageLevel;
    gained++;
  }
  return gained;
}

export const maxStamina = (p: Progress) => COTTAGE[p.cottage.level - 1].maxStamina;

export function view(p: Progress) {
  const next = COTTAGE[p.cottage.level];
  const current = QUESTS.find(q => !p.quests[q.id]) ?? null;
  return {
    ...levelOf(p.xp),
    xp: p.xp,
    maxStamina: maxStamina(p),
    cottage: { ...p.cottage, maxStamina: maxStamina(p), next: next ? { level: next.level, maxStamina: next.maxStamina, cost: next.cost } : null },
    quests: QUESTS.map(q => ({ ...q, done: !!p.quests[q.id] })),
    current,
    stats: p.stats,
  };
}
