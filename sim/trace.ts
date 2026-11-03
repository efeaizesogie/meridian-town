// Prints where the money sits every 6 days: node sim/trace.ts [players]
import { DEFAULT_PARAMS, Town, type Strategy } from '../packages/economy/src/index.ts';
const MIX: Strategy[] = ['grinder', 'grinder', 'jobber', 'grinder', 'arbitrageur', 'jobber'];
const n = Number(process.argv[2] ?? 30);
const t = new Town({ ...DEFAULT_PARAMS }, 7);
t.runDays(60, tw => tw.setActivePlayers(n, MIX));
for (const d of t.days.filter(d => d.day % 6 === 0 || d.day === 59)) {
  console.log(`d${String(d.day).padStart(2)} treas ${d.treasury.toFixed(0).padStart(6)} res ${d.residentsCash.toFixed(0).padStart(5)} shops ${d.shopCash.toFixed(0).padStart(6)} players ${d.playerCash.toFixed(0).padStart(6)} outside ${d.outsideCash.toFixed(0).padStart(6)} | open ${d.openShops} imp ${d.imported} exp ${d.exported} unmetBread ${d.unmetBread} | bid w/o/wh ${d.bestBid.wood.toFixed(2)}/${d.bestBid.ore.toFixed(2)}/${d.bestBid.wheat.toFixed(2)} ask bread ${d.ask.bread.toFixed(2)} tool ${d.ask.tool.toFixed(2)}`);
}
console.log(t.shops.map(s => `${s.id} cash ${s.cash.toFixed(0)} stock ${JSON.stringify(s.stock)}`).join('\n'));
const top = [...t.players].sort((a, b) => b.cash - a.cash).slice(0, 3).map(p => `${p.id}/${p.strategy} ${p.cash.toFixed(0)}`);
console.log('richest', top.join(', '));
