// Fast-forward: replay the next market week in about a minute, on a copy of the live town,
// with the same price, contract, caravan and Festival rules (packages/economy, which the
// contract tests are pinned to). Nothing here touches the chain.
import { useEffect, useMemo, useRef, useState } from 'react';
import { DEFAULT_PARAMS, ITEMS, RAW, Town, type Item, type Strategy, type TownEvent } from '@meridian/economy';
import type { World } from './App';
import { meri } from './types';
import { Icon } from './Icon';

const DAYS = 7;
const TICKS = DAYS * DEFAULT_PARAMS.ticksPerDay;
const MIX: Strategy[] = ['grinder', 'grinder', 'jobber', 'grinder', 'arbitrageur', 'jobber'];
const PLAYER_CHOICES = [5, 30, 100];
const SPEEDS = [{ label: '1 min', ms: 60_000 }, { label: '15 s', ms: 15_000 }];
const KIND_LABEL: Record<TownEvent['kind'], string> = {
  contract: 'Contract', filled: 'Filled', closed: 'Closed', auction: 'Auction', rescue: 'Rescue', caravan: 'Caravan', festival: 'Festival',
};

interface Sample {
  tick: number;
  price: Record<Item, number | null>; // × reference price
  cash: Record<string, number>;
  open: Record<string, boolean>;
  volume: number;
}

/** The price a player meets: what gatherers are paid for raw goods, what buyers pay for bread and tools. */
function playerPrice(t: Town, item: Item): number | null {
  const q = RAW.includes(item) ? t.bestBuyer(item)?.price : t.cheapestSeller(item)?.price;
  return q ? q / DEFAULT_PARAMS.base[item] : null;
}

function sample(t: Town): Sample {
  const p = DEFAULT_PARAMS;
  const counted = t.players.reduce((sum, x) => sum + (x.weekVolume >= p.minQualifyingVolume ? Math.min(x.weekVolume, p.playerVolumeCap) : 0), 0);
  return {
    tick: t.tick,
    price: Object.fromEntries(ITEMS.map(i => [i, playerPrice(t, i)])) as Record<Item, number | null>,
    cash: Object.fromEntries(t.shops.map(s => [s.id, s.cash])),
    open: Object.fromEntries(t.shops.map(s => [s.id, s.open])),
    volume: counted,
  };
}

function seed(world: World, players: number) {
  const town = Town.fromLive(DEFAULT_PARAMS, {
    treasury: meri(world.town.treasury),
    grounds: world.town.grounds,
    weekTarget: meri(world.town.week_target),
    shops: world.shops.map(s => ({
      id: s.shop.id, cash: meri(s.cash), stock: s.stock, target: s.shop.target, open: s.shop.open, owner: s.deed_holder,
    })),
  }, Date.now() % 100_000);
  town.setActivePlayers(players, MIX);
  return town;
}

export function FastForward({ world, onClose }: { world: World; onClose: () => void }) {
  const [players, setPlayers] = useState(30);
  const [speed, setSpeed] = useState(SPEEDS[0].ms);
  const [running, setRunning] = useState(false);
  const [, setFrame] = useState(0);
  const town = useRef<Town | null>(null);
  const samples = useRef<Sample[]>([]);
  const startSupply = useRef(0);

  const reset = (n = players) => {
    town.current = seed(world, n);
    samples.current = [sample(town.current)];
    startSupply.current = town.current.supply;
    setFrame(f => f + 1);
  };

  useEffect(() => {
    reset();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // Seed once from the world as it was when the panel opened.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => {
      const t = town.current!;
      if (t.tick >= TICKS) {
        setRunning(false);
        return;
      }
      t.step();
      samples.current.push(sample(t));
      setFrame(f => f + 1);
    }, speed / TICKS);
    return () => clearInterval(timer);
  }, [running, speed]);

  // Stress tests: push the simulated town somewhere uncomfortable and watch the rules respond.
  const [pokes, setPokes] = useState<{ tick: number; text: string }[]>([]);
  const poke = (text: string, run: (t: Town) => void) => {
    const t = town.current!;
    run(t);
    samples.current.push(sample(t));
    setPokes(p => [...p, { tick: t.tick, text }]);
    setFrame(f => f + 1);
  };
  const flood = () => poke('A grain barge unloaded 300 wheat at the Granary and the Bakery. Watch what they pay for wheat fall.', t => {
    for (const id of ['granary', 'baker']) {
      const shop = t.shops.find(x => x.id === id);
      if (shop) shop.stock.wheat += 150;
    }
  });
  const bankrupt = () => poke('Oswin’s till and shelves ran dry after a missed upkeep. He can’t pay tonight, so the Bakery closes and its deed goes to auction.', t => {
    const shop = t.shops.find(x => x.id === 'baker');
    if (!shop) return;
    shop.cash = 0;
    shop.stock.bread = 0;
    shop.stock.wheat = 0;
    shop.missedUpkeep = Math.max(shop.missedUpkeep, DEFAULT_PARAMS.missedUpkeepToClose - 1);
  });
  const famine = () => poke('Drought: the Fields are bare. Wheat gets scarce, prices rise, and shops post contracts to get it.', t => {
    t.ground.wheat = 0;
    for (const id of ['granary', 'baker']) {
      const shop = t.shops.find(x => x.id === id);
      if (shop) shop.stock.wheat = 0;
    }
  });
  const skip = () => {
    setRunning(false);
    const t = town.current!;
    while (t.tick < TICKS) {
      t.step();
      samples.current.push(sample(t));
    }
    setFrame(f => f + 1);
  };

  const t = town.current;
  if (!t) return null;
  const s = samples.current;
  const last = s[s.length - 1];
  const done = t.tick >= TICKS;
  const day = Math.min(DAYS, Math.floor(t.tick / DEFAULT_PARAMS.ticksPerDay) + 1);
  const target = t.weeks.at(-1)?.target ?? t.weekTarget;
  const festival = t.weeks.at(-1);
  const events: { tick: number; kind: TownEvent['kind'] | 'you'; text: string }[] = [...t.events, ...pokes.map(p => ({ ...p, kind: 'you' as const }))]
    .sort((a, b) => b.tick - a.tick);

  return (
    <div className="ff-backdrop" role="dialog" aria-modal="true" aria-labelledby="ff-title" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="ff">
        <header className="ff-head">
          <div>
            <h2 id="ff-title">Next week, fast-forwarded to {speed === 60_000 ? 'a minute' : '15 seconds'}</h2>
            <p className="hint">
              A copy of the town as it is right now, run on the same rules the contract enforces: prices, contracts, the caravan, upkeep, auctions and the Festival.
              Merchants follow their strategy rules here. Nothing is sent to the chain.
            </p>
          </div>
          <button className="link" onClick={onClose} aria-label="Close fast-forward"><Icon name="close" /></button>
        </header>

        <div className="ff-controls">
          <div className="seg" role="group" aria-label="Simulated players">
            <span className="muted">Players</span>
            {PLAYER_CHOICES.map(n => (
              <button key={n} className={players === n ? 'on' : ''} disabled={running} onClick={() => { setPlayers(n); reset(n); }}>{n}</button>
            ))}
          </div>
          <div className="seg" role="group" aria-label="Speed">
            <span className="muted">Speed</span>
            {SPEEDS.map(o => (
              <button key={o.ms} className={speed === o.ms ? 'on' : ''} onClick={() => setSpeed(o.ms)}>{o.label}</button>
            ))}
          </div>
          <div className="row">
            {!done && <button className="primary" onClick={() => setRunning(r => !r)}>{running ? 'Pause' : t.tick ? 'Resume' : '▶ Run the week'}</button>}
            {(t.tick > 0) && <button disabled={running} onClick={() => { setPokes([]); reset(); }}>Start over</button>}
          </div>
        </div>

        <div className="ff-stress" role="group" aria-label="What if">
          <span className="muted">What if…</span>
          <button disabled={done} onClick={flood}>A grain barge docks</button>
          <button disabled={done} onClick={famine}>Drought on the Fields</button>
          <button disabled={done} onClick={bankrupt}>Oswin’s till runs dry</button>
          <button disabled={done} onClick={skip}>Jump to Festival night</button>
        </div>

        <div className="ff-status">
          <div>
            <strong>Day {day} of {DAYS}</strong>
            <div className="sun"><div className="sun-fill" style={{ width: `${(t.tick / TICKS) * 100}%` }} /></div>
          </div>
          <div>
            <strong>Festival</strong> <span className="muted">{(festival?.volume ?? last.volume).toFixed(0)} / {target.toFixed(0)} MERI traded</span>
            <div className="mood"><div className={`mood-fill ${(festival?.hit ?? last.volume >= target) ? 'hit' : ''}`} style={{ width: `${Math.min(100, ((festival?.volume ?? last.volume) / target) * 100)}%` }} /></div>
          </div>
        </div>

        <div className="ff-grid">
          <PriceChart samples={s} />
          <Tills world={world} samples={s} />
        </div>

        {done && <Summary town={t} startSupply={startSupply.current} />}

        <section className="ff-events" aria-live="polite">
          <h3>What happened</h3>
          {events.length === 0 && <p className="empty-note">{t.tick ? 'Quiet so far.' : 'Press run to start the week.'}</p>}
          <ul>
            {events.slice(0, 60).map((e, i) => (
              <li key={`${e.tick}-${i}`} className={`ev ${e.kind}`}>
                <span className="ev-day">Day {Math.floor(e.tick / DEFAULT_PARAMS.ticksPerDay) + 1}</span>
                <span className={`ev-kind ${e.kind}`}>{e.kind === 'you' ? 'What if' : KIND_LABEL[e.kind]}</span>
                {e.text}
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}

// ---------- price chart: one axis, prices indexed to each good's reference price ----------

const W = 720, H = 260, PAD = { l: 40, r: 78, t: 14, b: 26 };

function PriceChart({ samples }: { samples: Sample[] }) {
  const [hover, setHover] = useState<number | null>(null);
  // Fit the axis to the week so far: at least 0–1.5×, in half steps, never above 4×.
  const peak = Math.max(0, ...samples.flatMap(p => ITEMS.map(i => p.price[i] ?? 0)));
  const yMax = Math.min(4, Math.max(1.5, Math.ceil((peak * 1.1) / 0.5) * 0.5));
  const ticks = Array.from({ length: Math.round(yMax / 0.5) }, (_, i) => (i + 1) * 0.5).filter(v => yMax <= 2 || v % 1 === 0 || v === 0.5);
  const x = (tick: number) => PAD.l + (tick / TICKS) * (W - PAD.l - PAD.r);
  const y = (v: number) => PAD.t + (1 - Math.min(v, yMax) / yMax) * (H - PAD.t - PAD.b);
  const paths = useMemo(() => ITEMS.map(item => {
    let d = '';
    let pen = false;
    for (const p of samples) {
      const v = p.price[item];
      if (v == null) { pen = false; continue; }
      d += `${pen ? 'L' : 'M'}${x(p.tick).toFixed(1)},${y(v).toFixed(1)}`;
      pen = true;
    }
    return d;
  }), [samples.length, yMax]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastOf = (item: Item) => [...samples].reverse().find(p => p.price[item] != null);
  // Direct labels at line ends, nudged apart so they don't collide.
  const labels = ITEMS.map(item => ({ item, p: lastOf(item) })).filter(l => l.p).map(l => ({ ...l, y: y(l.p!.price[l.item]!) })).sort((a, b) => a.y - b.y);
  for (let i = 1; i < labels.length; i++) if (labels[i].y - labels[i - 1].y < 13) labels[i].y = labels[i - 1].y + 13;

  const hoverSample = hover != null ? samples[Math.min(samples.length - 1, hover)] : null;
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const tick = Math.round((((e.clientX - r.left) / r.width) * W - PAD.l) / (W - PAD.l - PAD.r) * TICKS);
    setHover(tick >= 0 && tick < samples.length ? tick : null);
  };

  return (
    <figure className="chart">
      <figcaption>
        <strong>Prices players meet</strong>
        <span className="muted">As a multiple of each good’s reference price. Raw goods show what shops pay you; bread and tools show what you pay.</span>
      </figcaption>
      <div className="legend">
        {ITEMS.map(i => <span key={i}><i className={`sw s-${i}`} />{i}</span>)}
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Price of each good over the simulated week" onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {ticks.map(v => (
          <g key={v}>
            <line className={v === 1 ? 'ref' : 'grid'} x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} />
            <text className="axis" x={PAD.l - 6} y={y(v) + 4} textAnchor="end">{v}×</text>
          </g>
        ))}
        {Array.from({ length: DAYS + 1 }, (_, d) => (
          <text key={d} className="axis" x={x(d * DEFAULT_PARAMS.ticksPerDay)} y={H - 8} textAnchor="middle">{d < DAYS ? `day ${d + 1}` : ''}</text>
        ))}
        {ITEMS.map((item, i) => <path key={item} className={`line s-${item}`} d={paths[i]} />)}
        {labels.map(l => (
          <g key={l.item}>
            <circle className={`dot s-${l.item}`} cx={x(l.p!.tick)} cy={y(l.p!.price[l.item]!)} r={4} />
            <text className="direct" x={W - PAD.r + 8} y={l.y + 4}>{l.item} {l.p!.price[l.item]!.toFixed(2)}×</text>
          </g>
        ))}
        {hoverSample && (
          <line className="crosshair" x1={x(hoverSample.tick)} x2={x(hoverSample.tick)} y1={PAD.t} y2={H - PAD.b} />
        )}
      </svg>
      {hoverSample && (
        <div className="tip">
          <strong>Day {Math.floor(hoverSample.tick / DEFAULT_PARAMS.ticksPerDay) + 1}, hour {(hoverSample.tick % DEFAULT_PARAMS.ticksPerDay) * 2}</strong>
          {ITEMS.map(i => (
            <div key={i}><i className={`sw s-${i}`} /> {i}: {hoverSample.price[i] == null ? 'none for sale' : `${(hoverSample.price[i]! * DEFAULT_PARAMS.base[i]).toFixed(2)} MERI (${hoverSample.price[i]!.toFixed(2)}×)`}</div>
          ))}
        </div>
      )}
    </figure>
  );
}

// ---------- shop tills ----------

function Tills({ world, samples }: { world: World; samples: Sample[] }) {
  const last = samples[samples.length - 1];
  const first = samples[0];
  const max = Math.max(...samples.flatMap(s => Object.values(s.cash)), 1);
  return (
    <section className="tills">
      <h3>Shop tills</h3>
      {world.shops.map(s => {
        const id = s.shop.id;
        const cash = last.cash[id] ?? 0;
        const delta = cash - (first.cash[id] ?? 0);
        return (
          <div className="till-row" key={id}>
            <div className="till-name">
              <span>{s.shop.name}</span>
              {!last.open[id] && <span className="status closed">closed</span>}
            </div>
            <div className="till-bar"><div style={{ width: `${(cash / max) * 100}%` }} /></div>
            <div className="till-num">{cash.toFixed(0)} <small className={delta >= 0 ? 'good' : 'bad'}>{delta >= 0 ? '+' : ''}{delta.toFixed(0)}</small></div>
          </div>
        );
      })}
    </section>
  );
}

function Summary({ town, startSupply }: { town: Town; startSupply: number }) {
  const w = town.weeks.at(-1);
  const count = (k: TownEvent['kind']) => town.events.filter(e => e.kind === k).length;
  const change = ((town.supply / startSupply) - 1) * 100;
  return (
    <section className={`ff-summary ${w?.hit ? 'hit' : 'miss'}`}>
      <h3>{w?.hit ? 'The town held its Festival' : 'No Festival this week'}</h3>
      <p>
        {w ? <>Players traded {w.volume.toFixed(0)} MERI against a target of {w.target.toFixed(0)}. </> : null}
        {w?.hit ? `${w.minted.toFixed(0)} new MERI were minted to the traders` : `${(w?.burned ?? 0).toFixed(0)} MERI of the treasury burned`}, so the coin supply moved {change >= 0 ? '+' : ''}{change.toFixed(1)}%.
      </p>
      <p className="muted">
        {count('contract')} contracts posted, {count('filled')} filled, {count('caravan')} caravan deliveries, {count('closed')} shops closed, {count('auction')} won at auction, {count('rescue')} rescued
      </p>
    </section>
  );
}
