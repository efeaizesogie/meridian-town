// Checks phrase.ts against near-seed-phrase, the derivation NEAR wallets use.
//   node apps/web/src/phrase.check.ts
import { createRequire } from 'node:module';
import { isPhrase, keyFromPhrase, newPhrase } from './phrase.ts';

const require = createRequire(import.meta.url);
const ref = require('near-seed-phrase');
let ok = 0;
for (let i = 0; i < 5; i++) {
  const p = newPhrase();
  const mine = keyFromPhrase(p);
  const theirs = ref.parseSeedPhrase(p);
  if (mine.secretKey === theirs.secretKey && mine.publicKey === theirs.publicKey && isPhrase(p)) ok++;
  else console.log('MISMATCH', mine.publicKey, theirs.publicKey);
}
console.log(`${ok}/5 phrases match NEAR's reference derivation`);
if (ok !== 5) process.exit(1);
