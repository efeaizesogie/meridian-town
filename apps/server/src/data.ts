// Where the server keeps its small state files (players, agent keys, sealed bids).
// Defaults to apps/server/data; on a host, point MERIDIAN_DATA_DIR at a persistent volume.
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const DATA_DIR = process.env.MERIDIAN_DATA_DIR ?? fileURLToPath(new URL('../data/', import.meta.url));
mkdirSync(DATA_DIR, { recursive: true });

export const dataFile = (name: string) => join(DATA_DIR, name);
