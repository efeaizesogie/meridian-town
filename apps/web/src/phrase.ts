// Recovery phrases: 12 standard BIP-39 words that turn into the NEAR key which owns a player's
// account. The derivation is the one NEAR wallets use (SLIP-10 ed25519, path m/44'/397'/0'),
// so the same words import into Meteor, MyNearWallet and others.
import { generateMnemonic, mnemonicToSeedSync, validateMnemonic } from '@scure/bip39';
import { wordlist } from '@scure/bip39/wordlists/english.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha512 } from '@noble/hashes/sha2.js';
import { ed25519 } from '@noble/curves/ed25519.js';
import { base58 } from '@scure/base';

const NEAR_PATH = [44, 397, 0];
const HARDENED = 0x80000000;

/** SLIP-10 ed25519: every step is hardened. */
function derive(seed: Uint8Array): Uint8Array {
  let I = hmac(sha512, new TextEncoder().encode('ed25519 seed'), seed);
  let key = I.slice(0, 32);
  let chain = I.slice(32);
  for (const index of NEAR_PATH) {
    const data = new Uint8Array(37);
    data.set(key, 1);
    new DataView(data.buffer).setUint32(33, (index | HARDENED) >>> 0);
    I = hmac(sha512, chain, data);
    key = I.slice(0, 32);
    chain = I.slice(32);
  }
  return key;
}

export const newPhrase = () => generateMnemonic(wordlist, 128);

/** Tidy what a person typed: lower case, single spaces. */
export const normalise = (phrase: string) => phrase.trim().toLowerCase().split(/\s+/).join(' ');

export const isPhrase = (phrase: string) => validateMnemonic(normalise(phrase), wordlist);

/** The owner key for a phrase, in the `ed25519:…` form near-api-js and the wallets use. */
export function keyFromPhrase(phrase: string): { secretKey: string; publicKey: string } {
  const seed = derive(mnemonicToSeedSync(normalise(phrase), ''));
  const pub = ed25519.getPublicKey(seed);
  const secret = new Uint8Array(64);
  secret.set(seed);
  secret.set(pub, 32);
  return { secretKey: `ed25519:${base58.encode(secret)}`, publicKey: `ed25519:${base58.encode(pub)}` };
}
