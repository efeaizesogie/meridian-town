// Runs the town for 60 days under several scenarios and prints what happened to the
// coin supply, the treasury, shops, players and the Festival.
//   node sim/run.ts            all scenarios with default params
//   node sim/run.ts --sweep    also sweep targetGrowth
import { mkdirSync, writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, Town, type Params, type Strategy } from '../packages/economy/src/index.ts';

const DAYS = 60;
const MIX: Strategy[] = ['grinder', 'grinder', 'jobber', 'grinder', 'arbitrageur', 'jobber'];

interface Scenario {
  name: string;
  about: string;
  players: (day: number) => number;
  washers?: { count: number; capital: number; fromDay: number };
}

const SCENARIOS: Scenario[] = [
  { name: 'steady', about: '30 players all along', players: () => 30 },
  { name: 'boom', about: '10 players growing to 100', players: d => Math.round(10 + (90 * d) / DAYS) },
  { name: 'churn', about: '30 players, drops to 8 on day 20', players: d => (d < 20 ? 30 : 8) },
  { name: 'ghost', about: '5 players all along', players: () => 5 },
  { name: 'wash', about: 'steady + 10 sybils with 1,000 MERI each wash-trading', players: () => 30, washers: { count: 10, capital: 1000, fromDay: 7 } },
];

function run(sc: Scenario, p: Params, seed = 7) {
  const town = new Town(p, seed);
  const washers: ReturnType<Town['addPlayer']>[] = [];
  town.runDays(DAYS, (t, day) => {
    t.setActivePlayers(sc.players(day), MIX);
    if (sc.washers && day === sc.washers.fromDay) {
      for (let i = 0; i < sc.washers.count; i++) {
        const w = t.addPlayer('washer');
        // Attacker capital comes from outside: count it as a transfer from the outside pool.
        const c = Math.min(sc.washers.capital, t.outsideCash);
        t.outsideCash -= c;
        w.cash += c;
        w.spent -= c; // capital is not spending
        washers.push(w);
      }
    }
  });
  const drift = Math.abs(town.coinsAccountedFor() - town.supply);
  if (drift > 1e-6 * town.supply) throw new Error(`${sc.name}: coins don't add up (drift ${drift})`);

  const honest = town.players.filter(x => x.strategy !== 'washer');
  const washPnl = washers.length
    ? washers.reduce((s, w) => s + w.cash, 0) - sc.washers!.count * (sc.washers!.capital + p.starterCoins)
    : undefined;
  return { town, honest, washPnl };
}

const f = (n: number, d = 0) => n.toLocaleString('en-US', { maximumFractionDigits: d, minimumFractionDigits: d });

function report(sc: Scenario, p: Params) {
  const { town, honest, washPnl } = run(sc, p);
  const first = town.days[0], last = town.days.at(-1)!;
  const hits = town.weeks.filter(w => w.hit).length;
  const closures = town.days.reduce((s, d, i) => s + Math.max(0, (town.days[i - 1]?.openShops ?? 6) - d.openShops), 0);
  const perPlayerDay = honest.reduce((s, x) => s + x.earned, 0) / Math.max(1, town.days.reduce((s, d) => s + d.players, 0));
  return {
    scenario: sc.name,
    supply: `${f(first.supply)} -> ${f(last.supply)} (${f(((last.supply / first.supply) - 1) * 100, 1)}%)`,
    treasury: `${f(first.treasury)} -> ${f(last.treasury)}`,
    festivals: `${hits}/${town.weeks.length} hit, best streak ${town.bestStreak}`,
    weeks: town.weeks.map(w => (w.hit ? 'H' : '.')).join(''),
    shopClosures: closures,
    earnPerPlayerDay: f(perPlayerDay, 1),
    unmetBreadPerDay: f(town.days.reduce((s, d) => s + d.unmetBread, 0) / DAYS, 1),
    imports: town.days.reduce((s, d) => s + d.imported, 0),
    exports: town.days.reduce((s, d) => s + d.exported, 0),
    jobsFilled: `${town.days.reduce((s, d) => s + d.jobsFilled, 0)}/${town.days.reduce((s, d) => s + d.jobsPosted, 0)}`,
    oreBid: `${f(first.bestBid.ore, 2)} -> ${f(last.bestBid.ore, 2)}`,
    breadAsk: `${f(first.ask.bread, 2)} -> ${f(last.ask.bread, 2)}`,
    washPnl: washPnl === undefined ? '' : f(washPnl),
    _days: town.days,
    _weeks: town.weeks,
  };
}

function printRows(rows: Record<string, unknown>[]) {
  for (const r of rows) console.log('  ' + Object.entries(r).filter(([, v]) => v !== '').map(([k, v]) => `${k}=${v}`).join('  '));
}

const sweep = process.argv.includes('--sweep');
mkdirSync(new URL('./out/', import.meta.url), { recursive: true });

console.log(`\nMeridian Town economy — ${DAYS} days, default params\n`);
const rows = SCENARIOS.map(sc => report(sc, DEFAULT_PARAMS));
for (const sc of SCENARIOS) console.log(`  ${sc.name.padEnd(7)} ${sc.about}`);
printRows(rows.map(({ _days, _weeks, ...r }) => r));
writeFileSync(new URL('./out/default.json', import.meta.url), JSON.stringify(rows, null, 1));

if (sweep) {
  for (const growth of [0.9, 0.95, 1.0, 1.05]) {
    for (const burn of [0.05, 0.1]) {
      const p = { ...DEFAULT_PARAMS, targetGrowth: growth, missBurnRate: burn };
      console.log(`\ntargetGrowth ${growth}, missBurnRate ${burn}`);
      printRows(SCENARIOS.map(sc => report(sc, p)).map(r => ({
        scenario: r.scenario, supply: r.supply, treasury: r.treasury, festivals: r.festivals, weeks: r.weeks,
        closures: r.shopClosures, earn: r.earnPerPlayerDay, washPnl: r.washPnl,
      })));
    }
  }
}
