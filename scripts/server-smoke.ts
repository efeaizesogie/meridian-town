// End-to-end check of the game server against testnet: join, signed /me, gather, sell.
//   node scripts/server-smoke.ts <name>   (server must be running on :8787)
import { Account, JsonRpcProvider, KeyPair, teraToGas } from 'near-api-js';

const API = process.env.API ?? 'http://localhost:8787';
const name = process.argv[2] ?? `smoke${Date.now() % 100000}`;
const key = KeyPair.fromRandom('ed25519');

async function api(path: string, body: object, accountId?: string) {
  const text = JSON.stringify(body);
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (accountId) {
    const ts = Date.now();
    const sig = key.sign(new TextEncoder().encode(`meridian|${accountId}|${ts}|${text}`)).signature;
    headers['x-meridian-auth'] = Buffer.from(JSON.stringify({ accountId, publicKey: key.getPublicKey().toString(), ts, signature: Buffer.from(sig).toString('base64') })).toString('base64');
  }
  const res = await fetch(API + path, { method: 'POST', headers, body: text });
  const out = await res.json();
  if (!res.ok) throw new Error(`${path} ${res.status}: ${out.error}`);
  return out;
}

const cfg = await (await fetch(API + '/api/config')).json();
console.log('config', cfg.town, cfg.game, 'dayMs', cfg.dayMs);
const { accountId } = await api('/api/join', { name, publicKey: key.getPublicKey().toString() });
console.log('joined as', accountId);
console.log('me', await api('/api/me', {}, accountId));
const [g1, g2] = await Promise.all([api('/api/gather', { ground: 'mine', swings: 4 }, accountId), api('/api/gather', { ground: 'mine', swings: 4 }, accountId)]);
console.log('gathered (two requests in one batch):', g1.gathered, g2.gathered, '| stamina', g2.stamina);

const player = new Account(accountId, new JsonRpcProvider({ url: cfg.rpc }), key.toString() as any);
const got = await player.callFunction({ contractId: cfg.town, methodName: 'sell', args: { shop_id: 'mine', item: 'ore', quantity: g1.gathered + g2.gathered, min_total: '0' }, gas: teraToGas(50) });
console.log('sold ore with the player key, received', Number(got) / 1e6, 'MERI');
