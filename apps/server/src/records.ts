// Town records: the biggest single moments, kept across restarts. Each comes from a transaction
// the server checked on chain (or, for swings, from its own gather queue), so none is self-reported.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataFile } from './data.ts';

const FILE = dataFile('records.json');

export interface Rec { who: string; value: number; detail: string; tx?: string; at: number }
export type RecordId = 'sale' | 'delivery' | 'bid' | 'gather' | 'perfectRun';

export const RECORD_LABELS: Record<RecordId, { title: string; unit: string }> = {
  sale: { title: 'Biggest single sale', unit: 'MERI' },
  delivery: { title: 'Biggest contract delivery', unit: 'MERI' },
  bid: { title: 'Highest bid for a deed', unit: 'MERI' },
  gather: { title: 'Most gathered by one player', unit: 'goods' },
  perfectRun: { title: 'Longest run of perfect swings', unit: 'in a row' },
};

let records: Partial<Record<RecordId, Rec>> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

let dirty = false;
setInterval(() => {
  if (!dirty) return;
  writeFileSync(FILE, JSON.stringify(records, null, 1));
  dirty = false;
}, 2000).unref();

/**
 * Offer a new value; keeps it if it beats the record. Returns true only when the record changes
 * hands (or is set for the first time), so a holder improving their own record isn't announced
 * on every action.
 */
export function offer(id: RecordId, rec: Omit<Rec, 'at'>): boolean {
  const cur = records[id];
  if (cur && cur.value >= rec.value) return false;
  records[id] = { ...rec, at: Date.now() };
  dirty = true;
  return !cur || cur.who !== rec.who;
}

export const all = () => records;
