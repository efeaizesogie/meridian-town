// Deed perks, the off-chain part: a deed holder names their shop and picks its colours and flag.
// It's checked against the deed on chain every time it's shown, so a style lapses the moment the
// deed changes hands.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dataFile } from './data.ts';

const FILE = dataFile('deed-styles.json');

export const COLORS = ['gold', 'crimson', 'teal', 'violet', 'forest', 'sky'] as const;
export const FLAGS = ['none', 'banner', 'bunting', 'lanterns', 'flowers'] as const;

export interface ShopStyle { holder: string; title: string; color: (typeof COLORS)[number]; flag: (typeof FLAGS)[number]; at: number }

let styles: Record<string, ShopStyle> = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {};

export function set(shopId: string, holder: string, s: { title?: unknown; color?: unknown; flag?: unknown }) {
  const title = String(s.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 28);
  if (title.length < 3) throw new Error('A shop name needs at least 3 letters');
  if (/https?:|www\.|<|>/i.test(title)) throw new Error('Links and tags aren’t allowed in a shop name');
  const color = COLORS.includes(s.color as any) ? (s.color as ShopStyle['color']) : 'gold';
  const flag = FLAGS.includes(s.flag as any) ? (s.flag as ShopStyle['flag']) : 'none';
  styles[shopId] = { holder, title, color, flag, at: Date.now() };
  writeFileSync(FILE, JSON.stringify(styles, null, 1));
}

/** Styles whose holder still holds the deed. */
export function current(shops: { shop: { id: string }; deed_holder: string }[]): Record<string, ShopStyle> {
  const out: Record<string, ShopStyle> = {};
  for (const s of shops) {
    const st = styles[s.shop.id];
    if (st && st.holder === s.deed_holder) out[s.shop.id] = st;
  }
  return out;
}
