// What moves demand in Meridian, beyond stock and targets:
//  - a weekly event, one per market week, picked from the contract's week number (or by the
//    deed holders' vote) so every server agrees;
//  - short market shocks: a few times a day something happens (rain, a flooded shaft, a storm)
//    that pushes one good's demand up or down for about half an hour.
// Both work the same way: the shopkeepers they touch move their target for that good (inside the
// band the contract allows), so the price players meet really moves. Nothing here bypasses the
// contract; it only changes what the shopkeepers aim for.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataFile } from './data.ts';
import * as feed from './feed.ts';

type Raw = 'wood' | 'ore' | 'wheat';

export interface TownEvent {
  id: string;
  title: string;
  blurb: string;
  item: Raw;
  shops: string[];
  /** How far the usual target is pulled, in basis points (capped by the band). Negative: a glut. */
  boostBps: number;
}

export const EVENTS: TownEvent[] = [
  { id: 'harvest', title: 'Harvest fair', item: 'wheat', shops: ['baker', 'granary'], boostBps: 2500,
    blurb: 'The fair is in town and everyone wants bread. Oswin and Wen pay more for wheat this week.' },
  { id: 'frost', title: 'Early frost', item: 'wood', shops: ['lumberyard', 'smith'], boostBps: 2500,
    blurb: 'A cold snap came early. Brann wants timber for the hearths, and Hilde for the forge.' },
  { id: 'rails', title: 'The rail survey', item: 'ore', shops: ['mine', 'smith'], boostBps: 2500,
    blurb: 'Surveyors want iron for a rail line. Petra and Hilde pay more for ore this week.' },
];

export const SHOCKS: (TownEvent & { minutes: number })[] = [
  { id: 'rain', title: 'Rain on the Fields', item: 'wheat', shops: ['granary', 'baker'], boostBps: 2000, minutes: 30,
    blurb: 'A downpour flattened the wheat. Wen and Oswin pay more for what’s left.' },
  { id: 'flood', title: 'Water in the Mine', item: 'ore', shops: ['mine', 'smith'], boostBps: 2000, minutes: 30,
    blurb: 'The lower shaft flooded. Ore is scarce and Petra pays more for it.' },
  { id: 'rush', title: 'Festive rush', item: 'wheat', shops: ['baker'], boostBps: 3000, minutes: 20,
    blurb: 'A wedding party wants every loaf in town. Oswin needs wheat, now.' },
  { id: 'storm', title: 'Storm in the Forest', item: 'wood', shops: ['lumberyard'], boostBps: -2000, minutes: 30,
    blurb: 'A storm brought down the old oaks. Timber is everywhere and Brann pays less for it.' },
  { id: 'caravan', title: 'Ore caravan arrives', item: 'ore', shops: ['mine'], boostBps: -2000, minutes: 25,
    blurb: 'A caravan from the hills dumped ore at the Mine Office. Petra pays less for a while.' },
  { id: 'tools', title: 'Tool fair', item: 'wood', shops: ['smith'], boostBps: 2500, minutes: 25,
    blurb: 'Travelling builders want tools. Hilde is buying wood to keep the forge hot.' },
];

// ---------- the weekly event (with deed holders' votes for next week) ----------

const VOTE_FILE = dataFile('event-votes.json');
/** week -> voter -> event id. Votes for a week decide that week's event. */
let votes: Record<string, Record<string, string>> = existsSync(VOTE_FILE) ? JSON.parse(readFileSync(VOTE_FILE, 'utf8')) : {};

export function vote(week: number, voter: string, eventId: string) {
  if (!EVENTS.some(e => e.id === eventId)) throw new Error('no such event');
  votes[week] = { ...(votes[week] ?? {}), [voter]: eventId };
  writeFileSync(VOTE_FILE, JSON.stringify(votes));
}

export function tally(week: number) {
  const v = Object.values(votes[week] ?? {});
  return EVENTS.map(e => ({ id: e.id, title: e.title, votes: v.filter(x => x === e.id).length }));
}

export const myVote = (week: number, voter: string) => votes[week]?.[voter] ?? null;

/** The event for a contract week: the deed holders' choice if they voted, otherwise the rotation. */
export function eventFor(week: number): TownEvent & { chosenBy: 'vote' | 'rotation' } {
  const t = tally(week).filter(x => x.votes > 0).sort((a, b) => b.votes - a.votes);
  if (t.length) return { ...EVENTS.find(e => e.id === t[0].id)!, chosenBy: 'vote' };
  return { ...EVENTS[((week % EVENTS.length) + EVENTS.length) % EVENTS.length], chosenBy: 'rotation' };
}

// ---------- market shocks ----------

const SHOCK_FILE = dataFile('shocks.json');
interface ShockRun { id: string; start: number; end: number }
let shocks: ShockRun[] = existsSync(SHOCK_FILE) ? JSON.parse(readFileSync(SHOCK_FILE, 'utf8')) : [];

const save = () => writeFileSync(SHOCK_FILE, JSON.stringify(shocks.slice(-100)));

export function activeShock(): (TownEvent & { minutes: number; start: number; end: number }) | null {
  const run = shocks.find(s => s.start <= Date.now() && Date.now() < s.end);
  const def = run && SHOCKS.find(s => s.id === run.id);
  return run && def ? { ...def, start: run.start, end: run.end } : null;
}

/** Shocks in the last two days, for shading price charts. */
export const shockHistory = () => shocks.filter(s => s.end > Date.now() - 2 * 86_400_000).map(s => ({ ...s, title: SHOCKS.find(x => x.id === s.id)?.title ?? s.id }));

let announcedEnd = shocks.at(-1)?.end ?? 0;

/**
 * Called every market day or so: maybe start a shock (never two at once, never the same twice in
 * a row), and announce one that just ended.
 */
export function maybeShock(openShops: string[], chance = 0.35) {
  const now = Date.now();
  const last = shocks.at(-1);
  if (last && last.end <= now && announcedEnd < last.end) {
    announcedEnd = last.end;
    feed.post({ kind: 'shock', text: `${SHOCKS.find(s => s.id === last.id)?.title ?? 'The shock'} is over. Prices drift back` });
  }
  if (activeShock() || Math.random() > chance) return;
  const options = SHOCKS.filter(s => s.id !== last?.id && s.shops.some(id => openShops.includes(id)));
  const pick = options[Math.floor(Math.random() * options.length)];
  if (!pick) return;
  shocks.push({ id: pick.id, start: now, end: now + pick.minutes * 60_000 });
  save();
  feed.post({ kind: 'shock', text: `${pick.title}! ${pick.blurb}` });
}

// ---------- boosts players burned MERI for (read from the contract) ----------

/** A rung market bell lifts demand for one good at every shop that buys it, for an hour. */
const BELL_MS = 60 * 60_000;
const BELL_BPS = 2000;
let bells: { item: string; until: number; who: string }[] = [];
let seenBoost = 0;
let primed = false;

/** Called with the contract's latest boosts (newest first). Announces new ones once. */
export function setBoosts(boosts: { who: string; kind: string; item?: string | null; text?: string | null; burned: string; at_ns: number }[]) {
  for (const b of [...boosts].reverse()) {
    if (b.at_ns <= seenBoost) continue;
    seenBoost = b.at_ns;
    const at = Math.floor(b.at_ns / 1e6);
    if (b.kind === 'bell' && b.item && at + BELL_MS > Date.now()) bells.push({ item: b.item, until: at + BELL_MS, who: b.who });
    if (!primed) continue; // on startup, don't re-announce what the feed already has
    const who = String(b.who).split('.')[0];
    const burned = (Number(b.burned) / 1e6).toFixed(0);
    if (b.kind === 'bell') feed.post({ kind: 'boost', text: `${who} rang the market bell for ${b.item}: every shop pays more for it for an hour (${burned} MERI burned)`, who: b.who });
    if (b.kind === 'fireworks') feed.post({ kind: 'boost', text: `${who} set off fireworks over the square (${burned} MERI burned)`, who: b.who });
    if (b.kind === 'banner') feed.post({ kind: 'boost', text: `${who} hung a banner on the Festival stage: “${b.text}” (${burned} MERI burned)`, who: b.who });
  }
  primed = true;
  bells = bells.filter(x => x.until > Date.now());
}

export const activeBells = () => bells.filter(x => x.until > Date.now());

/**
 * How demand for a shop's good is shifted right now: this week's event, any shock and any market
 * bell, as one pull in basis points, with the names of what's pulling.
 */
export function demandShift(week: number, shopId: string, item: string): { bps: number; titles: string[] } | null {
  const parts: { boostBps: number; title: string }[] = [eventFor(week), activeShock()].filter((e): e is NonNullable<typeof e> => !!e && e.item === item && e.shops.includes(shopId));
  for (const b of activeBells()) if (b.item === item) parts.push({ boostBps: BELL_BPS, title: 'The market bell' });
  if (!parts.length) return null;
  return { bps: parts.reduce((s, e) => s + e.boostBps, 0), titles: [...new Set(parts.map(e => e.title))] };
}

/** Kept for callers that only care about the weekly event. */
export function eventBoost(week: number, shopId: string, item: string): TownEvent | null {
  const e = eventFor(week);
  return e.item === item && e.shops.includes(shopId) ? e : null;
}
