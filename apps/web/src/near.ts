// The player's side of NEAR: a key kept in this browser, view calls over RPC, and
// transactions the player signs themselves. The key can only call the town contract.
import { Account, JsonRpcProvider, KeyPair, teraToGas } from 'near-api-js';

export interface Config {
  network: string;
  rpc: string;
  town: string;
  game: string;
  dayMs: number;
  rules: { maxStamina: number; swingCost: number; breadStamina: number; toolYield: number; toolDurability: number; maxSwingsPerRequest: number };
}

interface Session {
  accountId: string;
  secretKey: string;
}

const SESSION = 'meridian.session';
let config: Config;
let provider: JsonRpcProvider;
let session: Session | null = null;
let account: Account | null = null;

export async function loadConfig(): Promise<Config> {
  config = await (await fetch('/api/config')).json();
  provider = new JsonRpcProvider({ url: config.rpc });
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

export function signOut() {
  session = null;
  account = null;
  try {
    localStorage.removeItem(SESSION);
  } catch {}
}

export async function join(name: string): Promise<string> {
  const key = KeyPair.fromRandom('ed25519');
  const res = await fetch('/api/join', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ name, publicKey: key.getPublicKey().toString() }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error);
  setSession({ accountId: out.accountId, secretKey: key.toString() });
  try {
    localStorage.setItem(SESSION, JSON.stringify(session));
  } catch {}
  return out.accountId;
}

const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** Call the game server, signed with the player's key. */
export async function api<T>(path: string, body: object = {}): Promise<T> {
  if (!session) throw new Error('not signed in');
  const text = JSON.stringify(body);
  const ts = Date.now();
  const key = KeyPair.fromString(session.secretKey as any);
  const signature = key.sign(new TextEncoder().encode(`meridian|${session.accountId}|${ts}|${text}`)).signature;
  const auth = b64(new TextEncoder().encode(JSON.stringify({ accountId: session.accountId, publicKey: key.getPublicKey().toString(), ts, signature: b64(signature) })));
  const res = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-meridian-auth': auth }, body: text });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error);
  return out;
}

export async function view<T>(method: string, args: object = {}): Promise<T> {
  const res = await fetch(config.rpc, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 'm', method: 'query',
      params: { request_type: 'call_function', finality: 'optimistic', account_id: config.town, method_name: method, args_base64: b64(new TextEncoder().encode(JSON.stringify(args))) },
    }),
  });
  const body = await res.json();
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
  return JSON.parse(new TextDecoder().decode(new Uint8Array(body.result.result)));
}

/** Send a transaction to the town as the player. Returns the call's result and tx hash. */
export async function call<T = unknown>(methodName: string, args: object, tgas = 50): Promise<{ value: T; hash: string }> {
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
  const text = e instanceof Error ? e.message : JSON.stringify(e);
  const m = text.match(/Smart contract panicked: ([^"\\]+)/) ?? text.match(/panicked at [^:]+:\d+:\d+:\s*([^"\\]+)/);
  return m ? m[1].trim() : text.slice(0, 160);
}
