// Bring the town clock up to today after downtime: calls `advance` (2 days per call) until no
// market days are left to process. The game server's keeper does the same every 30 seconds;
// this just does it back to back. Signed by the game account.
//   node scripts/catch-up.ts [game account]
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Account, FailoverRpcProvider, JsonRpcProvider, teraToGas } from 'near-api-js';

const [gameId = 'game.efecode.testnet'] = process.argv.slice(2);
const TOWN = process.env.TOWN_CONTRACT ?? 'town.efecode.testnet';
const RPCS = ['https://test.rpc.fastnear.com', 'https://testnet-rpc.intea.rs', 'https://near-testnet.drpc.org'];
const key = JSON.parse(readFileSync(join(homedir(), '.near-credentials', 'testnet', `${gameId}.json`), 'utf8')).private_key;
const provider = new FailoverRpcProvider(RPCS.map(url => new JsonRpcProvider({ url }, { retries: 1, wait: 400, backoff: 1.5 })));
const game = new Account(gameId, provider, key);

for (;;) {
  const town = await provider.callFunction<{ day: number; processed_days: number }>({ contractId: TOWN, method: 'get_town', args: {} });
  if (!town || town.processed_days >= town.day) {
    console.log(`caught up: day ${town?.day}`);
    break;
  }
  try {
    const done = await game.callFunction<number>({ contractId: TOWN, methodName: 'advance', args: {}, gas: teraToGas(150) });
    console.log(`processed through day ${done} of ${town.day}`);
  } catch (e) {
    console.error('advance failed, retrying:', e instanceof Error ? e.message.slice(0, 160) : e);
    await new Promise(r => setTimeout(r, 3000));
  }
}
