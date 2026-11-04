// The island's layout, in world units. Places sit where they do on the 2D map
// (TownMap.SPOTS, 1000 × 680), scaled down and centred on the fountain.
import { SPOTS, type Place } from '../TownMap';

export const SCALE = 1 / 19;
export const CENTRE = { x: 500, y: 355 };

export function at(place: string): [number, number, number] {
  const s = SPOTS[place];
  return [(s.x - CENTRE.x) * SCALE, 0, (s.y - CENTRE.y) * SCALE];
}

export const ISLAND_RADIUS = 31;

/** Market-day progress 0..1 → sun height, warmth and how dark it is. */
export function daylight(intoDay: number) {
  // Morning to evening across the first 85% of the day, night for the rest.
  const dayPart = Math.min(1, intoDay / 0.85);
  const angle = Math.PI * (0.08 + 0.84 * dayPart);
  const night = intoDay < 0.7 ? 0 : intoDay < 0.85 ? (intoDay - 0.7) / 0.15 : 1;
  // A low sun that rises in front of the island and sets behind it: long shadows by day,
  // and the sunset glows across the horizon the camera looks at.
  const sun: [number, number, number] = [Math.cos(angle) * 60, Math.max(4, Math.sin(angle) * 36) * (1 - night * 0.85), 40 - 85 * dayPart];
  return { sun, night, golden: Math.max(0, 1 - Math.abs(dayPart - 0.85) / 0.2) * (1 - night) };
}

export const PALETTE = {
  grass: '#7fb069',
  grassDark: '#5f9150',
  cliff: '#a98b6b',
  cliffDark: '#7a6248',
  sand: '#e8d4a2',
  path: '#e3cf9d',
  cobble: '#cdb98f',
  water: '#3f8fb8',
  waterDeep: '#1f5f86',
  wall: '#f1e6cc',
  wood: '#7a5230',
  woodDark: '#4e321c',
  stone: '#a9a49b',
  window: '#9cc3dd',
  windowLit: '#ffcf70',
};

export const ROOFS: Record<string, string> = {
  lumberyard: '#9a5b2e',
  mine: '#5d6875',
  granary: '#c9932f',
  smith: '#454c57',
  baker: '#c45a2c',
  store: '#7a58b8',
  guildhall: '#2f6a8e',
  auction: '#8e3030',
  cottage: '#a8463f',
};

export type { Place };
