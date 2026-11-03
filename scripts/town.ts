// Read a deployed town over plain RPC.
//   node scripts/town.ts [contract] [testnet|mainnet]
// Defaults to town.efecode.testnet on testnet.
const contract = process.argv[2] ?? 'town.efecode.testnet';
const network = process.argv[3] ?? 'testnet';
const RPC = network === 'mainnet' ? 'https://rpc.mainnet.fastnear.com' : 'https://test.rpc.fastnear.com';
const ITEMS = ['wood', 'ore', 'wheat', 'bread', 'tool'];
const meri = (x: string | number) => Number(x) / 1e6;

export async function view<T>(method: string, args: object = {}): Promise<T> {
  const res = await fetch(RPC, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0', id: 1, method: 'query',
      params: { request_type: 'call_function', finality: 'final', account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString('base64') },
    }),
  });
  const body = await res.json();
  if (body.error || body.result?.error) throw new Error(JSON.stringify(body.error ?? body.result.error));
  return JSON.parse(Buffer.from(body.result.result).toString());
}

if (import.meta.main) {
  const town = await view<any>('get_town');
  console.log(`${contract} — day ${town.day} (processed ${town.processed_days}), week ${town.week}`);
  console.log(`  supply ${meri(town.supply)} MERI, treasury ${meri(town.treasury)}, festival pool ${meri(town.festival_pool)}`);
  console.log(`  week target ${meri(town.week_target)}, counted ${meri(town.week_counted)}, streak ${town.streak} (best ${town.best_streak})`);
  console.log(`  grounds: forest ${town.grounds[0]} wood, mine ${town.grounds[1]} ore, fields ${town.grounds[2]} wheat\n`);
  const fmt = (a: string[]) => a.map((x, i) => (Number(x) ? `${ITEMS[i]} ${meri(x).toFixed(2)}` : '')).filter(Boolean).join(', ');
  for (const s of await view<any[]>('get_shops')) {
    const stock = s.stock.map((x: number, i: number) => (x ? `${ITEMS[i]} ${x}` : '')).filter(Boolean).join(', ');
    console.log(`  ${s.shop.name.padEnd(24)} ${s.shop.open ? 'open  ' : 'CLOSED'} cash ${meri(s.cash).toFixed(0).padStart(6)} | ${stock}`);
    console.log(`  ${''.padEnd(24)}        sells: ${fmt(s.ask) || '-'} | buys: ${fmt(s.bid) || '-'}`);
  }
  const jobs = await view<any[]>('get_jobs');
  if (jobs.length) console.log(`\n  contracts: ${jobs.map(j => `#${j.id} ${j.shop_id} wants ${j.remaining} ${j.item} @ ${meri(j.unit_price)}`).join('; ')}`);
}
