// Talking to NEAR: the game account (creates players, mints gathered goods) and views.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, FailoverRpcProvider, JsonRpcProvider, PublicKey, actions, nearToYocto, teraToGas } from 'near-api-js';

export const NETWORK = process.env.NEAR_NETWORK ?? 'testnet';
/** RPC endpoints, tried in turn. Free public RPCs rate-limit, so one is never enough. */
export const RPCS = (process.env.NEAR_RPCS ?? (NETWORK === 'mainnet'
  ? 'https://rpc.mainnet.fastnear.com,https://archival-rpc.mainnet.fastnear.com,https://rpc.mainnet.near.org'
  : 'https://near-testnet.drpc.org,https://testnet-rpc.intea.rs,https://test.rpc.fastnear.com,https://archival-rpc.testnet.fastnear.com,https://archival-rpc.testnet.near.org')).split(',');
export const RPC = RPCS[0];
export const TOWN = process.env.TOWN_CONTRACT ?? 'town.efecode.testnet';
export const GAME = process.env.GAME_ACCOUNT ?? 'game.efecode.testnet';

/** NEAR given to each new player for gas, and how much gas their key may spend in total. */
const PLAYER_GAS_MONEY = nearToYocto('0.1');
const PLAYER_KEY_ALLOWANCE = nearToYocto('1');

export const provider = new FailoverRpcProvider(RPCS.map(url => new JsonRpcProvider({ url })));

function loadGameKey(): string {
  if (process.env.GAME_PRIVATE_KEY) return process.env.GAME_PRIVATE_KEY;
  const file = process.env.GAME_KEY_FILE ?? join(homedir(), '.near-credentials', NETWORK, `${GAME}.json`);
  const json = JSON.parse(readFileSync(file, 'utf8'));
  return json.private_key ?? json.secret_key;
}

export const game = new Account(GAME, provider, loadGameKey() as any);

let rpcIndex = 0;
const benchedUntil = new Map<string, number>(); // endpoint -> ms timestamp it may be used again

/** A JSON-RPC call that skips endpoints which recently rate-limited us. */
export async function rpc(method: string, params: unknown): Promise<any> {
  let lastError: unknown;
  for (let attempt = 0; attempt < RPCS.length * 2; attempt++) {
    const url = RPCS[rpcIndex % RPCS.length];
    if ((benchedUntil.get(url) ?? 0) > Date.now() && attempt < RPCS.length) {
      rpcIndex++;
      continue;
    }
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
        signal: AbortSignal.timeout(10_000),
      });
      const body = await res.json();
      if (res.status === 429 || res.status >= 500 || body.error?.code === -429) throw new Error(`${url} ${res.status}`);
      return body;
    } catch (e) {
      lastError = e;
      benchedUntil.set(url, Date.now() + 30_000);
      rpcIndex++;
    }
  }
  throw lastError;
}

export async function view<T>(method: string, args: object = {}): Promise<T> {
  const body = await rpc('query', { request_type: 'call_function', finality: 'optimistic', account_id: TOWN, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') });
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
  return JSON.parse(Buffer.from(body.result.result).toString());
}

export async function accountExists(accountId: string): Promise<boolean> {
  const body = await rpc('query', { request_type: 'view_account', finality: 'final', account_id: accountId });
  if (body.result) return true;
  const cause = body.error?.cause?.name;
  if (cause === 'UNKNOWN_ACCOUNT') return false;
  throw new Error(`could not check ${accountId}: ${JSON.stringify(body.error)}`);
}

/** Create `<name>.<game>` whose only key can call the town contract and nothing else. */
export async function createPlayer(accountId: string, publicKey: string) {
  await game.signAndSendTransaction({
    receiverId: accountId,
    actions: [
      actions.createAccount(),
      actions.transfer(PLAYER_GAS_MONEY),
      actions.addFunctionCallAccessKey(PublicKey.fromString(publicKey), TOWN, [], PLAYER_KEY_ALLOWANCE),
    ],
  });
}

export async function hasKey(accountId: string, publicKey: string): Promise<boolean> {
  const body = await rpc('query', { request_type: 'view_access_key', finality: 'final', account_id: accountId, public_key: publicKey });
  return !!body.result && !body.result.error;
}

export interface GatherOrder {
  player: string;
  item: 'wood' | 'ore' | 'wheat';
  quantity: number;
}

export async function gatherBatch(orders: GatherOrder[]): Promise<number[]> {
  return game.callFunction<number[]>({
    contractId: TOWN,
    methodName: 'gather_batch',
    args: { orders },
    gas: teraToGas(150),
  });
}

export async function advanceTown() {
  await game.callFunction({ contractId: TOWN, methodName: 'advance', args: {}, gas: teraToGas(300) });
}

/** A finished, successful `use_item` call by `accountId` on the town, or null. */
export async function verifyUseItem(txHash: string, accountId: string): Promise<{ item: string; quantity: number } | null> {
  const res: any = await provider.viewTransactionStatus({ txHash, accountId, waitUntil: 'FINAL' } as any);
  const tx = res.transaction;
  if (tx.signer_id !== accountId || tx.receiver_id !== TOWN) return null;
  if (!res.status || !('SuccessValue' in res.status)) return null;
  const call = tx.actions?.[0]?.FunctionCall;
  if (!call || call.method_name !== 'use_item') return null;
  const args = JSON.parse(Buffer.from(call.args, 'base64').toString());
  return { item: args.item, quantity: Number(args.quantity) };
}
