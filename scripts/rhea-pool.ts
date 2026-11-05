// Open a MERI/wNEAR pool on Rhea (Ref Finance's exchange contract) so MERI has a market price.
// Signed by the town owner, who seeds it with MERI and wrapped NEAR. Safe to re-run: steps that
// are already done are skipped, and an existing MERI/wNEAR pool is reused.
//   node scripts/rhea-pool.ts [owner] [meri] [near]
//   e.g. node scripts/rhea-pool.ts efecode.testnet 150 0.8
import { readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, FailoverRpcProvider, JsonRpcProvider, nearToYocto, teraToGas } from 'near-api-js';

const [owner = 'efecode.testnet', meriArg = '150', nearArg = '0.8'] = process.argv.slice(2);
const TOWN = process.env.TOWN_CONTRACT ?? 'town.efecode.testnet';
const EXCHANGE = process.env.RHEA_EXCHANGE ?? 'ref-finance-101.testnet';
const WNEAR = process.env.WNEAR ?? 'wrap.testnet';
const FEE = 30; // 0.3%, the usual fee for a volatile pair
const RPCS = ['https://test.rpc.fastnear.com', 'https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs'];

const key = JSON.parse(readFileSync(join(homedir(), '.near-credentials', 'testnet', `${owner}.json`), 'utf8')).private_key;
const provider = new FailoverRpcProvider(RPCS.map(url => new JsonRpcProvider({ url })));
const me = new Account(owner, provider, key);
const meri = BigInt(Math.round(Number(meriArg) * 1e6)).toString();
const wnear = nearToYocto(nearArg).toString();
const ONE_YOCTO = 1n;

const view = <T>(contractId: string, methodName: string, args: object = {}) => provider.callFunction<T>({ contractId, method: methodName, args }) as Promise<T>;
const call = (contractId: string, methodName: string, args: object, deposit: bigint | string = 0n, tgas = 100) =>
  me.callFunction({ contractId, methodName, args, deposit: BigInt(deposit), gas: teraToGas(tgas) });
const step = (s: string) => console.log(`- ${s}`);

// 1. Storage: the exchange must be registered on both tokens, and we on wNEAR and the exchange.
if (!(await view(TOWN, 'storage_balance_of', { account_id: EXCHANGE }))) { await call(TOWN, 'storage_deposit', { account_id: EXCHANGE }, nearToYocto('0.00125'), 30); step('registered the exchange on MERI'); }
if (!(await view(WNEAR, 'storage_balance_of', { account_id: owner }))) { await call(WNEAR, 'storage_deposit', { account_id: owner }, nearToYocto('0.00125'), 30); step('registered on wNEAR'); }
if (!(await view(EXCHANGE, 'get_user_storage_state', { account_id: owner }).catch(() => null))) { await call(EXCHANGE, 'storage_deposit', { account_id: owner }, nearToYocto('0.1'), 30); step('registered on the exchange'); }
await call(EXCHANGE, 'register_tokens', { token_ids: [TOWN, WNEAR] }, ONE_YOCTO, 30);
step('registered MERI and wNEAR in our exchange account');

// 2. Wrap NEAR, then deposit both tokens into the exchange.
await call(WNEAR, 'near_deposit', {}, wnear, 30);
step(`wrapped ${nearArg} NEAR`);
await call(TOWN, 'ft_transfer_call', { receiver_id: EXCHANGE, amount: meri, msg: '' }, ONE_YOCTO, 100);
await call(WNEAR, 'ft_transfer_call', { receiver_id: EXCHANGE, amount: wnear, msg: '' }, ONE_YOCTO, 100);
step(`deposited ${meriArg} MERI and ${nearArg} wNEAR`);

// 3. Find or create the pool, then add the liquidity.
const pools = Number(await view(EXCHANGE, 'get_number_of_pools'));
let poolId = -1;
for (let from = Math.max(0, pools - 2000); from < pools && poolId < 0; from += 200) {
  const page = await view<any[]>(EXCHANGE, 'get_pools', { from_index: from, limit: 200 });
  const i = page.findIndex(p => p.token_account_ids.includes(TOWN) && p.token_account_ids.includes(WNEAR));
  if (i >= 0) poolId = from + i;
}
if (poolId < 0) {
  const res: any = await me.callFunctionRaw({ contractId: EXCHANGE, methodName: 'add_simple_pool', args: { tokens: [TOWN, WNEAR], fee: FEE }, deposit: nearToYocto('0.1'), gas: teraToGas(100) });
  poolId = JSON.parse(Buffer.from(res.status.SuccessValue, 'base64').toString());
  step(`created pool ${poolId}`);
} else {
  step(`reusing pool ${poolId}`);
}
await call(EXCHANGE, 'add_liquidity', { pool_id: poolId, amounts: [meri, wnear] }, nearToYocto('0.01'), 100);
step('added the liquidity');

const pool: any = await view(EXCHANGE, 'get_pool', { pool_id: poolId });
writeFileSync('apps/server/rhea-pool.json', JSON.stringify({ exchange: EXCHANGE, poolId, meri: TOWN, wnear: WNEAR }, null, 1) + '\n');
console.log(`pool ${poolId} on ${EXCHANGE}: ${pool.amounts.join(' / ')} (${pool.token_account_ids.join(' / ')}); saved apps/server/rhea-pool.json`);
