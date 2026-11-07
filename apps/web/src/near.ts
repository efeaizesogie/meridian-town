// The player's side of NEAR: a key kept in this browser, view calls over RPC, and
// transactions the player signs themselves. The key can only call the town contract.
import { Account, FailoverRpcProvider, JsonRpcProvider, KeyPair, PublicKey, actions, nearToYocto, teraToGas } from 'near-api-js';
import { keyFromPhrase, newPhrase, normalise, isPhrase } from './phrase';

export interface Config {
  network: string;
  rpcs: string[];
  town: string;
  game: string;
  dayMs: number;
  guilds: string[];
  rules: { maxStamina: number; swingCost: number; breadStamina: number; toolYield: number; toolDurability: number; maxSwingsPerRequest: number };
}

interface Session {
  accountId: string;
  secretKey: string;
  /** One key per guild DAO, able only to propose and vote there. */
  guildKeys?: Record<string, string>;
  /** The recovery phrase that owns the account, kept so the player can see it again here. */
  phrase?: string;
}

const SESSION = 'meridian.session';
let config: Config;
let provider: FailoverRpcProvider;
let rpcIndex = 0;
let session: Session | null = null;
let account: Account | null = null;

export async function loadConfig(): Promise<Config> {
  config = await (await fetch('/api/config')).json();
  // One quick retry per endpoint, then the next: a stuck RPC must not leave a player waiting.
  provider = new FailoverRpcProvider(config.rpcs.map(url => new JsonRpcProvider({ url }, { retries: 1, wait: 400, backoff: 1.5 })));
  try {
    const saved = localStorage.getItem(SESSION);
    if (saved) setSession(JSON.parse(saved));
  } catch {
    // Private mode or blocked storage: the player just signs up again.
  }
  return config;
}

function setSession(s: Session) {
  session = s;
  account = new Account(s.accountId, provider, s.secretKey as any);
}

export const me = () => session?.accountId ?? null;

/** What the player can back up: the recovery phrase (accounts made since phrases arrived) and the play key. */
export const backup = () => (session ? { accountId: session.accountId, phrase: session.phrase ?? null, playKey: session.secretKey } : null);

function save(s: Session) {
  setSession(s);
  try {
    localStorage.setItem(SESSION, JSON.stringify(s));
  } catch {}
}

const GUILD_METHODS = ['add_proposal', 'act_proposal'];

/** `ada` or `ada.game.efecode.testnet` → the full account id. */
export const accountFor = (name: string) => {
  const n = name.trim().toLowerCase();
  return n.includes('.') ? n : `${n}.${config.game}`;
};

/**
 * Which Meridian account a key belongs to, so players log back in with their words alone.
 * FastNEAR indexes every key on chain; `all` includes limited play keys, not just full access.
 */
async function accountsForKey(publicKey: string, all = false): Promise<string[]> {
  const base = config.network === 'mainnet' ? 'https://api.fastnear.com' : 'https://test.api.fastnear.com';
  try {
    const res = await fetch(`${base}/v0/public_key/${publicKey}${all ? '/all' : ''}`);
    const out = await res.json();
    return (out.account_ids ?? []).filter((id: string) => id.endsWith(`.${config.game}`));
  } catch {
    return [];
  }
}

/** The account to log into: the one named, or the one the key belongs to. */
async function findAccount(name: string, publicKey: string, all: boolean): Promise<string> {
  if (name.trim()) return accountFor(name);
  const ids = await accountsForKey(publicKey, all);
  if (ids.length === 0) throw new Error('We couldn’t find a Meridian account for those words. Check them, or add your name below.');
  return ids[0];
}

async function accessKey(accountId: string, publicKey: string): Promise<any | null> {
  for (let attempt = 0; attempt < config.rpcs.length * 2; attempt++) {
    const url = config.rpcs[rpcIndex % config.rpcs.length];
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'm', method: 'query', params: { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey } }) });
      const body = await res.json();
      if (res.status === 429 || res.status >= 500) throw new Error('rpc busy');
      if (body.result && !body.result.error) return body.result;
      return null;
    } catch {
      rpcIndex++;
    }
  }
  throw new Error('the network is busy; try again in a moment');
}

/**
 * Log back in with a recovery phrase: prove the phrase owns the account, then have it add a fresh
 * play key (and guild keys) for this browser. Coins, goods and deeds were on chain all along.
 */
export async function restoreWithPhrase(name: string, phrase: string): Promise<string> {
  if (!isPhrase(phrase)) throw new Error('Those aren’t 12 valid recovery words. Check the spelling and the order.');
  const owner = keyFromPhrase(phrase);
  const accountId = await findAccount(name, owner.publicKey, false);
  const found = await accessKey(accountId, owner.publicKey);
  if (!found || found.permission !== 'FullAccess') throw new Error(`Those words don’t own ${accountId}.`);
  const play = KeyPair.fromRandom('ed25519');
  const guildKeys = Object.fromEntries(config.guilds.map(g => [g, KeyPair.fromRandom('ed25519')]));
  const ownerAccount = new Account(accountId, provider, owner.secretKey as any);
  try {
    await ownerAccount.signAndSendTransaction({
      receiverId: accountId,
      actions: [
        actions.addFunctionCallAccessKey(PublicKey.fromString(play.getPublicKey().toString()), config.town, [], nearToYocto('1')),
        ...Object.entries(guildKeys).map(([g, k]) => actions.addFunctionCallAccessKey(PublicKey.fromString(k.getPublicKey().toString()), g, GUILD_METHODS, nearToYocto('1'))),
      ],
    });
  } catch (e) {
    throw new Error(readablePanic(e));
  }
  save({ accountId, secretKey: play.toString(), guildKeys: Object.fromEntries(Object.entries(guildKeys).map(([g, k]) => [g, k.toString()])), phrase: normalise(phrase) });
  return accountId;
}

/** Log back in with a saved play key (characters made before recovery phrases). */
export async function restoreWithKey(name: string, secretKey: string): Promise<string> {
  let key: KeyPair;
  try {
    key = KeyPair.fromString(secretKey.trim() as any);
  } catch {
    throw new Error('That doesn’t look like a saved key. It starts with ed25519:');
  }
  const accountId = await findAccount(name, key.getPublicKey().toString(), true);
  if (!(await accessKey(accountId, key.getPublicKey().toString()))) throw new Error(`That key isn’t on ${accountId}.`);
  save({ accountId, secretKey: key.toString() });
  return accountId;
}

export function signOut() {
  session = null;
  account = null;
  try {
    localStorage.removeItem(SESSION);
  } catch {}
}

export async function join(name: string): Promise<string> {
  const key = KeyPair.fromRandom('ed25519');
  const phrase = newPhrase();
  const owner = keyFromPhrase(phrase);
  const guildKeys = Object.fromEntries(config.guilds.map(g => [g, KeyPair.fromRandom('ed25519')]));
  const res = await reach('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name,
      publicKey: key.getPublicKey().toString(),
      ownerKey: owner.publicKey,
      guildKeys: Object.fromEntries(Object.entries(guildKeys).map(([g, k]) => [g, k.getPublicKey().toString()])),
    }),
  });
  const out = await res.json().catch(() => ({ error: 'The town is restarting. Try again in a minute.' }));
  if (!res.ok) throw new Error(out.error);
  save({ accountId: out.accountId, secretKey: key.toString(), guildKeys: Object.fromEntries(Object.entries(guildKeys).map(([g, k]) => [g, k.toString()])), phrase });
  return out.accountId;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Call the game server, signed with the player's key. */
export async function api<T>(path: string, body: object = {}): Promise<T> {
  if (!session) throw new Error('not signed in');
  const text = JSON.stringify(body);
  // The wall clock, even when a recording tool slows the page's clock (see brand/video tooling).
  const ts = (globalThis as { __realNow?: () => number }).__realNow?.() ?? Date.now();
  const key = KeyPair.fromString(session.secretKey as any);
  const signature = key.sign(new TextEncoder().encode(`meridian|${session.accountId}|${ts}|${text}`)).signature;
  const auth = b64(new TextEncoder().encode(JSON.stringify({ accountId: session.accountId, publicKey: key.getPublicKey().toString(), ts, signature: b64(signature) })));
  const res = await reach(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-meridian-auth': auth }, body: text });
  const out = await res.json().catch(() => ({ error: 'The town is restarting. Try again in a minute.' }));
  if (!res.ok) throw new Error(out.error);
  return out;
}

/** A view call on the town, moving to the next RPC when one is rate-limited. */
export async function view<T>(method: string, args: object = {}): Promise<T> {
  return viewOn<T>(config.town, method, args);
}

/** A view call on any contract (Rhea's exchange, wrapped NEAR…). */
export async function viewOn<T>(contract: string, method: string, args: object = {}): Promise<T> {
  let last: unknown;
  for (let attempt = 0; attempt < config.rpcs.length * 2; attempt++) {
    const url = config.rpcs[rpcIndex % config.rpcs.length];
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 'm', method: 'query',
          params: { request_type: 'call_function', finality: 'optimistic', account_id: contract, method_name: method, args_base64: b64(new TextEncoder().encode(JSON.stringify(args))) },
        }),
      });
      const body = await res.json();
      if (res.status === 429 || res.status >= 500 || body.error?.code === -429) throw new Error(`rpc busy (${res.status})`);
      if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
      return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
    } catch (e) {
      last = e;
      if (e instanceof Error && !e.message.startsWith('rpc busy') && !(e instanceof TypeError)) throw e;
      rpcIndex++;
    }
  }
  throw last;
}

/** Shared town snapshot and this player's balances, read by the game server. */
export async function getJSON<T>(path: string): Promise<T> {
  const res = await reach(path);
  const out = await res.json().catch(() => ({ error: 'The town is restarting. Try again in a minute.' }));
  if (!res.ok) throw new Error(out.error);
  return out;
}

export const canUseGuild = (guild: string) => !!session?.guildKeys?.[guild];

/** Propose or vote in a guild DAO, with that guild's key. */
export async function guildCall(guild: string, methodName: string, args: object, tgas = 150): Promise<string> {
  const secret = session?.guildKeys?.[guild];
  if (!session || !secret) throw new Error('this character joined before the guilds opened');
  try {
    const res: any = await new Account(session.accountId, provider, secret as any).callFunctionRaw({ contractId: guild, methodName, args, gas: teraToGas(tgas) });
    return res.transaction.hash;
  } catch (e) {
    throw new Error(readablePanic(e));
  }
}

/** Send a transaction to the town as the player. Returns the call's result and tx hash. */
// A transaction needs its full prepaid gas available up front at the worst-case gas price
// (~0.001 NEAR per Tgas); unused gas is refunded. Players start with 0.1 NEAR, so keep this low.
export async function call<T = unknown>(methodName: string, args: object, tgas = 30): Promise<{ value: T; hash: string }> {
  if (!account) throw new Error('not signed in');
  try {
    const res: any = await account.callFunctionRaw({ contractId: config.town, methodName, args, gas: teraToGas(tgas) });
    const raw = res.status?.SuccessValue;
    const value = raw ? JSON.parse(atob(raw)) : undefined;
    return { value, hash: res.transaction.hash };
  } catch (e) {
    throw new Error(readablePanic(e));
  }
}

function readablePanic(e: unknown): string {
  const inner: string[] = (e as any)?.errors?.map((x: any) => x?.message).filter(Boolean) ?? [];
  const text = e instanceof Error ? [e.name, e.message, ...inner].join(' ') : JSON.stringify(e);
  if (/doesn.t have enough balance|not enough (coins|MERI)/i.test(text)) return 'You don’t have enough MERI for that. Sell some goods first.';
  if (/NotEnoughBalance|not enough balance|LackBalance/i.test(text)) return 'Your account is out of NEAR for transaction fees, so the town can’t take this action yet.';
  if (/Exceeded \d+ providers|RetriesExceeded|Failed to fetch|NetworkError|429|timeout/i.test(text)) return 'The NEAR network is busy right now. Wait a few seconds and try again; nothing was lost.';
  if (/InvalidNonce|nonce/i.test(text)) return 'That clashed with another action from you. Try it once more.';
  const m = text.match(/Smart contract panicked: ([^"\\]+)/) ?? text.match(/panicked at [^:]+:\d+:\d+:\s*([^"\\]+)/);
  if (m) return m[1].replace(/\s*\[\]\s*$/, '').trim();
  console.error(e);
  return 'That didn’t go through. Try again in a moment; nothing was lost.';
}

/** fetch, but a dropped connection reads as a sentence a player understands. */
async function reach(path: string, init?: RequestInit): Promise<Response> {
  try {
    return await fetch(path, init);
  } catch {
    throw new Error('Can’t reach the town right now. Check your connection and try again.');
  }
}

// ---------- cashing out: MERI → wNEAR on Rhea → NEAR, signed with the recovery words ----------

export interface Pool { exchange: string; poolId: number; meri: string; wnear: string }

/** What `meriMicro` would fetch in NEAR (yocto) from the pool right now. */
export async function quoteCashOut(pool: Pool, meriMicro: bigint): Promise<bigint> {
  if (meriMicro <= 0n) return 0n;
  const out = await viewOn<string>(pool.exchange, 'get_return', { pool_id: pool.poolId, token_in: pool.meri, amount_in: String(meriMicro), token_out: pool.wnear });
  return BigInt(out);
}

/** The NEAR this account holds (yocto), for the ledger. */
export async function nearBalance(accountId: string): Promise<bigint> {
  for (let attempt = 0; attempt < config.rpcs.length; attempt++) {
    try {
      const res = await fetch(config.rpcs[rpcIndex % config.rpcs.length], { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 'm', method: 'query', params: { request_type: 'view_account', finality: 'optimistic', account_id: accountId } }) });
      const body = await res.json();
      if (body.result) return BigInt(body.result.amount);
    } catch {}
    rpcIndex++;
  }
  return 0n;
}

/**
 * Swap MERI for NEAR: sell it into the MERI/wNEAR pool on Rhea, then unwrap. Token transfers
 * need a 1-yoctoNEAR deposit, which the play key can't attach, so this signs with the key from
 * the player's recovery words. Returns the NEAR received, in yocto.
 */
export async function cashOut(pool: Pool, meriMicro: bigint): Promise<bigint> {
  if (!session?.phrase) throw new Error('Cashing out needs your 12 recovery words, and this character was made before them.');
  const owner = new Account(session.accountId, provider, keyFromPhrase(session.phrase).secretKey as any);
  const quote = await quoteCashOut(pool, meriMicro);
  if (quote <= 0n) throw new Error('The pool can’t take that much MERI right now. Try a smaller amount.');
  const minOut = (quote * 97n) / 100n;
  const before = BigInt(await viewOn<string>(pool.wnear, 'ft_balance_of', { account_id: session.accountId }));
  const call = (contractId: string, methodName: string, args: object, deposit: bigint, tgas: number) =>
    owner.callFunction({ contractId, methodName, args, deposit, gas: teraToGas(tgas) });
  try {
    if (!(await viewOn<unknown>(pool.wnear, 'storage_balance_of', { account_id: session.accountId }))) {
      await call(pool.wnear, 'storage_deposit', { account_id: session.accountId }, nearToYocto('0.00125'), 30);
    }
    const msg = JSON.stringify({ force: 0, actions: [{ pool_id: pool.poolId, token_in: pool.meri, token_out: pool.wnear, amount_in: String(meriMicro), min_amount_out: String(minOut) }] });
    // 75 Tgas covers a one-pool swap; a transaction must be able to afford its gas at a pessimistic
    // price (about 0.001 NEAR per Tgas), and players start with 0.1 NEAR.
    await call(pool.meri, 'ft_transfer_call', { receiver_id: pool.exchange, amount: String(meriMicro), msg }, 1n, 75);
    const got = BigInt(await viewOn<string>(pool.wnear, 'ft_balance_of', { account_id: session.accountId })) - before;
    if (got <= 0n) throw new Error('The swap didn’t go through, so nothing was spent. Try again in a moment.');
    await call(pool.wnear, 'near_withdraw', { amount: String(got) }, 1n, 30);
    return got;
  } catch (e) {
    throw new Error(e instanceof Error && !/Smart contract panicked|Exceeded|NotEnough/.test(e.message) ? e.message : readablePanic(e));
  }
}

export const canCashOut = () => !!session?.phrase;
