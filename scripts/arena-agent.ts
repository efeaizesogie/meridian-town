// A starter agent for the Meridian agent arena: run a shop you've been appointed to.
// Copy it, change `decide`, and compete on profit against the house merchants.
//
//   node scripts/arena-agent.ts <your-agent.testnet> <shop_id> [--dry]
//
// The agent account signs with a key saved by the NEAR CLI (~/.near-credentials/testnet/
// <account>.json), or the key in AGENT_KEY. The shop's deed holder must first appoint it, in
// the game (Auction House → Your shops → Appoint) or with `set_agent`. See docs/ARENA.md.
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, FailoverRpcProvider, JsonRpcProvider, teraToGas } from 'near-api-js';

const [agentId, shopId, flag] = process.argv.slice(2);
if (!agentId || !shopId) {
  console.error('usage: node scripts/arena-agent.ts <your-agent.testnet> <shop_id> [--dry]');
  process.exit(1);
}
const DRY = flag === '--dry';
const TOWN = process.env.TOWN_CONTRACT ?? 'town.efecode.testnet';
const RPCS = ['https://test.rpc.fastnear.com', 'https://testnet-rpc.intea.rs', 'https://near-testnet.drpc.org'];
const ITEMS = ['wood', 'ore', 'wheat', 'bread', 'tool'] as const;
type Item = (typeof ITEMS)[number];

const keyFile = join(homedir(), '.near-credentials', 'testnet', `${agentId}.json`);
const key = process.env.AGENT_KEY ?? (existsSync(keyFile) ? JSON.parse(readFileSync(keyFile, 'utf8')).private_key : null);
if (!key && !DRY) throw new Error(`no key for ${agentId}: set AGENT_KEY or save one with the NEAR CLI`);
const provider = new FailoverRpcProvider(RPCS.map(url => new JsonRpcProvider({ url }, { retries: 1, wait: 400, backoff: 1.5 })));
const agent = key ? new Account(agentId, provider, key) : null;
const view = <T>(method: string, args: object = {}) => provider.callFunction<T>({ contractId: TOWN, method, args }) as Promise<T>;

interface ShopView {
  shop: { id: string; name: string; open: boolean; agent: string | null; buys: Item[]; sells: Item[]; target: number[]; genesis_target?: number[] };
  cash: string;
  stock: number[];
  bid: string[];
  ask: string[];
}
interface Params { agent_target_band_bps: number; job_trigger_bps: number; job_premium_bps: number }
type Move =
  | { kind: 'set_target'; item: Item; target: number }
  | { kind: 'post_job'; item: Item; quantity: number; unit_price: string };

/**
 * Your strategy. This starter does two things a good shopkeeper does:
 * - when a raw good it buys runs low, it posts a delivery contract at its current bid plus a premium;
 * - when a good piles up, it lowers that good's target so it stops overpaying for more.
 * Every move must fit the town's rules (the contract rejects anything else).
 */
function decide(s: ShopView, params: Params, genesis: number[]): Move[] {
  const moves: Move[] = [];
  for (const item of s.shop.buys) {
    const i = ITEMS.indexOf(item);
    const target = s.shop.target[i];
    const stock = s.stock[i];
    const band = Math.floor((genesis[i] * params.agent_target_band_bps) / 10_000);
    if (['wood', 'ore', 'wheat'].includes(item) && stock * 10_000 < target * params.job_trigger_bps) {
      const quantity = Math.max(1, Math.floor(target * 0.6) - stock);
      const premium = (BigInt(s.bid[i]) * BigInt(10_000 + Math.floor(params.job_premium_bps / 2))) / 10_000n;
      moves.push({ kind: 'post_job', item, quantity, unit_price: String(premium) });
    } else if (stock > target * 1.5 && target > genesis[i] - band) {
      moves.push({ kind: 'set_target', item, target: Math.max(genesis[i] - band, Math.floor(target * 0.9)) });
    }
  }
  return moves;
}

async function tick() {
  const shops = await view<ShopView[]>('get_shops');
  const s = shops.find(x => x.shop.id === shopId);
  if (!s) throw new Error(`no shop called ${shopId}`);
  if (s.shop.agent !== agentId && !DRY) {
    console.log(`${s.shop.name} is run by ${s.shop.agent ?? 'nobody'}, not ${agentId}. Ask its deed holder to appoint you.`);
    return;
  }
  const params = await view<Params>('get_params');
  // The ±band is measured from the shop's opening targets; until you've moved one, they're the current ones.
  const genesis = s.shop.genesis_target ?? s.shop.target;
  const moves = decide(s, params, genesis);
  if (!moves.length) return console.log(`${s.shop.name}: nothing to do (till ${(Number(s.cash) / 1e6).toFixed(1)} MERI)`);
  for (const m of moves) {
    const args = m.kind === 'set_target' ? { shop_id: shopId, item: m.item, target: m.target } : { shop_id: shopId, item: m.item, quantity: m.quantity, unit_price: m.unit_price, hours: 1 };
    console.log(`${DRY ? '[dry] ' : ''}${m.kind}`, JSON.stringify(args));
    if (DRY || !agent) continue;
    try {
      await agent.callFunction({ contractId: TOWN, methodName: m.kind, args, gas: teraToGas(40) });
    } catch (e) {
      console.log('  refused:', e instanceof Error ? e.message.slice(0, 160) : e);
    }
  }
}

console.log(`${agentId} running ${shopId} on ${TOWN}${DRY ? ' (dry run, nothing is sent)' : ''}`);
await tick();
if (!DRY) setInterval(() => tick().catch(e => console.error(e instanceof Error ? e.message : e)), 60_000);
