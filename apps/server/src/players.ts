// Off-chain player state the chain doesn't need to see every second: stamina and tool wear.
// Everything of value (coins, goods, deeds) lives on chain.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS as P } from '@meridian/economy';
import { freshProgress, maxStamina, type Progress } from './progression.ts';

const DIR = new URL('../data/', import.meta.url);
const FILE = new URL('players.json', DIR);

export interface PlayerState {
  name: string;
  stamina: number;
  staminaAt: number; // ms timestamp the stamina value was measured
  toolUses: number;
  usedTx: string[]; // use_item transactions already credited
  joinedAt: number;
  progress: Progress;
}

let players: Record<string, PlayerState> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};
let dirty = false;

setInterval(() => {
  if (!dirty) return;
  mkdirSync(DIR, { recursive: true });
  writeFileSync(FILE, JSON.stringify(players, null, 1));
  dirty = false;
}, 2000).unref();

export const RULES = {
  maxStamina: P.maxStamina,
  staminaRegenPerDay: P.staminaRegenPerDay,
  swingCost: P.swingCost,
  breadStamina: P.breadStamina,
  toolYield: P.toolYield,
  toolDurability: P.toolDurability,
  maxSwingsPerRequest: P.swingsPerActiveTick,
};

export function get(accountId: string): PlayerState | undefined {
  const p = players[accountId];
  if (p && !p.progress) p.progress = freshProgress(); // players from before progression
  return p;
}

export const all = () => Object.keys(players).map(id => ({ accountId: id, ...get(id)! }));

export function add(accountId: string, name: string) {
  players[accountId] = { name, stamina: P.maxStamina, staminaAt: Date.now(), toolUses: 0, usedTx: [], joinedAt: Date.now(), progress: freshProgress() };
  dirty = true;
}

/** Stamina now, including regrowth since it was last measured. */
export function staminaNow(p: PlayerState, dayMs: number): number {
  const grown = (P.staminaRegenPerDay * (Date.now() - p.staminaAt)) / dayMs;
  return Math.min(maxStamina(p.progress), p.stamina + grown);
}

export function setStamina(p: PlayerState, value: number) {
  p.stamina = Math.max(0, value);
  p.staminaAt = Date.now();
  dirty = true;
}

export function save() {
  dirty = true;
}
