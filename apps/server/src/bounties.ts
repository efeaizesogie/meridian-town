// Guild bounties: each market week every guild gets a shared goal ("sell 60 ore between you").
// Members' sales and gathering of that good count toward it, as the server sees them on chain.
// When the goal is met, any member can propose (in the guild's Sputnik DAO) a share-out of part
// of the guild treasury, split by how much each member contributed; the members vote it through.
// The money never touches the server: it moves from the DAO to the members by their own vote.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataFile } from './data.ts';
import * as feed from './feed.ts';

const FILE = dataFile('bounties.json');
const RAW = ['wood', 'ore', 'wheat'] as const;
/** Share of the guild treasury the bounty proposes to pay out when it's met. */
export const POT_BPS = 3000;

/** week -> guild -> member -> units contributed */
let state: Record<string, Record<string, Record<string, number>>> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
let announced: Record<string, boolean> = {};
let dirty = false;
setInterval(() => {
  if (!dirty) return;
  // Keep the last few weeks only.
  const weeks = Object.keys(state).map(Number).sort((a, b) => b - a).slice(0, 4);
  state = Object.fromEntries(weeks.map(w => [w, state[w]]));
  writeFileSync(FILE, JSON.stringify(state));
  dirty = false;
}, 5000).unref();

/** This week's goal for a guild: a good and an amount that grows with the guild. */
export function goalFor(week: number, guildIndex: number, members: number) {
  const item = RAW[(week + guildIndex) % RAW.length];
  return { item, qty: Math.max(30, 15 * members) };
}

/** Credit a member's work to every guild they belong to. */
export function credit(week: number, guilds: { id: string; title: string; members: string[] }[], who: string, item: string, qty: number) {
  if (qty <= 0) return;
  guilds.forEach((g, i) => {
    if (!g.members.includes(who)) return;
    const goal = goalFor(week, i, g.members.length);
    if (goal.item !== item) return;
    const wk = (state[week] ??= {});
    const c = (wk[g.id] ??= {});
    const before = Object.values(c).reduce((s, v) => s + v, 0);
    c[who] = (c[who] ?? 0) + qty;
    dirty = true;
    const key = `${week}:${g.id}`;
    if (before < goal.qty && before + qty >= goal.qty && !announced[key]) {
      announced[key] = true;
      feed.post({ kind: 'guild', text: `${g.title} met its bounty: ${goal.qty} ${goal.item} this week. Members can now vote to share out the reward` });
    }
  });
}

/** Each guild's bounty this week: the goal, progress, who helped, and the share-out it proposes. */
export function view(week: number, guilds: { id: string; title: string; members: string[]; treasury: string }[]) {
  return Object.fromEntries(guilds.map((g, i) => {
    const goal = goalFor(week, i, g.members.length);
    const c = state[week]?.[g.id] ?? {};
    const done = Object.values(c).reduce((s, v) => s + v, 0);
    const pot = (BigInt(g.treasury || '0') * BigInt(POT_BPS)) / 10_000n;
    // Split the pot by contribution, rounding down; whatever rounds away stays in the treasury.
    const recipients = done > 0
      ? Object.entries(c).filter(([, v]) => v > 0).map(([who, v]) => [who, String((pot * BigInt(v)) / BigInt(done))] as [string, string]).filter(([, a]) => a !== '0')
      : [];
    return [g.id, {
      week, item: goal.item, qty: goal.qty, done, met: done >= goal.qty,
      contributors: Object.entries(c).sort((a, b) => b[1] - a[1]).map(([who, qty]) => ({ who, qty })),
      pot: String(pot), recipients,
    }];
  }));
}
