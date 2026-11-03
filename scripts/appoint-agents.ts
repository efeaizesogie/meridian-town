// Appoint the merchant agents to the shops the town still holds. Signed by the town owner;
// player-held shops are skipped (their holders appoint their own agents).
//   node scripts/appoint-agents.ts [owner] [town]      (game server must be running)
// Reads the owner's key from ~/.near-credentials/testnet/<owner>.json.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, FailoverRpcProvider, JsonRpcProvider, teraToGas } from 'near-api-js';

const [owner = 'efecode.testnet', town = 'town.efecode.testnet'] = process.argv.slice(2);
const API = process.env.API ?? 'http://localhost:8787';
const RPCS = ['https://near-testnet.drpc.org', 'https://testnet-rpc.intea.rs', 'https://test.rpc.fastnear.com'];

const { agents } = await (await fetch(`${API}/api/agents`)).json();
const key = JSON.parse(readFileSync(join(homedir(), '.near-credentials', 'testnet', `${owner}.json`), 'utf8')).private_key;
const account = new Account(owner, new FailoverRpcProvider(RPCS.map(url => new JsonRpcProvider({ url }))), key);

for (const [shop, agent] of Object.entries(agents as Record<string, string>)) {
  try {
    await account.callFunction({ contractId: town, methodName: 'set_agent', args: { shop_id: shop, agent }, gas: teraToGas(30) });
    console.log(`${shop}: appointed ${agent}`);
  } catch (e) {
    console.log(`${shop}: not appointed (${e instanceof Error ? e.message.slice(0, 140) : e})`);
  }
}
