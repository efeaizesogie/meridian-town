// Collect what a host needs into deploy.env (git-ignored), to paste into its settings.
//   node --env-file-if-exists=.env scripts/export-secrets.ts
// Contains private keys: never commit it or share it.
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const GAME = process.env.GAME_ACCOUNT ?? 'game.efecode.testnet';
const data = (f: string) => join('apps', 'server', 'data', f);
const read = (f: string) => (existsSync(f) ? readFileSync(f, 'utf8') : null);

const gameKey = JSON.parse(readFileSync(join(homedir(), '.near-credentials', 'testnet', `${GAME}.json`), 'utf8')).private_key;
const agents = read(data('agents.json'));
const suppliers = read(data('suppliers.json'));
const townsfolk = read(data('townsfolk.json'));
const lines = [
  `GAME_PRIVATE_KEY=${gameKey}`,
  agents && `MERIDIAN_KEYS_AGENTS=${JSON.stringify(JSON.parse(agents))}`,
  suppliers && `MERIDIAN_KEYS_SUPPLIERS=${JSON.stringify(JSON.parse(suppliers))}`,
  townsfolk && `MERIDIAN_KEYS_TOWNSFOLK=${JSON.stringify(JSON.parse(townsfolk))}`,
  process.env.NEARAI_API_KEY && `NEARAI_API_KEY=${process.env.NEARAI_API_KEY}`,
  process.env.NEAR_RPCS && `NEAR_RPCS=${process.env.NEAR_RPCS}`,
].filter(Boolean);
writeFileSync('deploy.env', lines.join('\n') + '\n');
console.log(`wrote deploy.env with ${lines.length} variables: ${lines.map(l => (l as string).split('=')[0]).join(', ')}`);
