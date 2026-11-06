// The town's books: where every MERI sits, what each week minted or burned, and the town's
// records and your marks. Everything here is read from the chain (through /api/world) or from
// transactions the server checked, so anyone can verify it.
import { useEffect, useState } from 'react';
import type { World } from './App';
import { ITEMS, KEEPERS, fmt, meri, short, type Item, type MarkDef } from './types';
import { Icon, type IconName } from './Icon';
import { CrierPanel, type FeedView } from './Crier';
import { CoinBoard, Collection, hasV4 } from './Market';

export type BooksTab = 'crier' | 'books' | 'records' | 'marks';

interface RecordsView {
  records: { id: string; title: string; unit: string; who: string; value: number; detail: string; tx?: string; at: number }[];
  bestWeek: { week: number; traded: number; target: number; hit: boolean } | null;
  bestStreak: number;
  topSellers: { who: string; value: number }[];
  topGatherers: { who: string; value: number }[];
  topMarks: { who: string; value: number }[];
  marks: MarkDef[];
}

export function TownBooks({ world, account, explorer, town, start = 'books', feed, onClose }: {
  feed: FeedView | null;
  world: World;
  account: string | null;
  explorer: string;
  town: string;
  start?: BooksTab;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<BooksTab>(start);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="books-title" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="book books">
        <header>
          <h2 id="books-title">The town’s books</h2>
          <button className="link" onClick={onClose} aria-label="Close the town’s books"><Icon name="close" /></button>
        </header>
        <div className="tabs" role="tablist" aria-label="Town books">
          {(['crier', 'books', 'records', 'marks'] as const).filter(t => t !== 'marks' || account).map(t => (
            <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>
              {t === 'crier' ? 'Town crier' : t === 'books' ? 'Where the coin is' : t === 'records' ? 'Records' : 'Your marks'}
            </button>
          ))}
        </div>
        {tab === 'crier' && <CrierPanel feed={feed} explorer={explorer} />}
        {tab === 'books' && (
          <>
            <Ledger world={world} explorer={explorer} town={town} />
            {hasV4(world) && (
              <>
                <h3 className="section-title">Shop coins</h3>
                <p className="hint">Each shop’s coin on its bonding curve. The reserve backs every coin in circulation; holders share 20% of the shop’s profit.</p>
                <CoinBoard world={world} />
              </>
            )}
          </>
        )}
        {tab === 'records' && <Records account={account} explorer={explorer} />}
        {tab === 'marks' && (
          <>
            <Marks world={world} />
            {account && hasV4(world) && (
              <>
                <h3 className="section-title">Your collection on chain</h3>
                <Collection account={account} explorer={explorer} town={town} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ---------- where the coin is ----------

export function Ledger({ world, explorer, town }: { world: World; explorer: string; town: string }) {
  const supply = meri(world.town.supply);
  const treasury = meri(world.town.treasury);
  const tills = world.shops.reduce((s, x) => s + meri(x.cash), 0);
  const escrow = world.jobs.reduce((s, j) => s + j.remaining * meri(j.unit_price), 0);
  const pool = meri(world.town.festival_pool);
  const held = Math.max(0, supply - treasury - tills - escrow - pool);
  const parts = [
    { key: 'treasury', label: 'Town treasury', value: treasury, note: 'Trade tax, rent and auction money. It pays for the residents’ bread and tools, and 5% burns when a Festival is missed.' },
    { key: 'tills', label: 'Shop tills', value: tills, note: `${world.shops.filter(s => s.shop.open).length} of ${world.shops.length} shops open. A shop that can’t pay its upkeep closes and its deed goes to auction.` },
    { key: 'escrow', label: 'Contract escrow', value: escrow, note: `${world.jobs.length} open delivery contract${world.jobs.length === 1 ? '' : 's'}, paid in advance and locked until filled or expired.` },
    { key: 'pool', label: 'Festival pool', value: pool, note: 'Minted at a Festival and waiting for traders to claim their share.' },
    { key: 'held', label: 'Players and residents', value: held, note: 'Everything else: purses of players, townsfolk, agents and the Rhea pool.' },
  ];
  const weeks = world.weeks.slice(-12);
  const peak = Math.max(1, ...weeks.map(w => Math.max(meri(w.minted), meri(w.burned))));
  const minted = world.weeks.reduce((s, w) => s + meri(w.minted), 0);
  const burned = world.weeks.reduce((s, w) => s + meri(w.burned), 0);
  const stock = (i: number) => world.shops.reduce((s, x) => s + x.stock[i], 0);

  return (
    <div className="ledger-books">
      <div className="supply-line">
        <div>
          <span className="muted">MERI in existence</span>
          <strong>{supply.toLocaleString('en-US', { maximumFractionDigits: 0 })}</strong>
        </div>
        <a className="text-link" href={`${explorer}/address/${town}`} target="_blank" rel="noreferrer">Check it on chain</a>
      </div>
      <div className="stackbar" role="img" aria-label={parts.map(p => `${p.label} ${p.value.toFixed(0)}`).join(', ')}>
        {parts.map(p => <i key={p.key} className={`sb-${p.key}`} style={{ width: `${(p.value / Math.max(1, supply)) * 100}%` }} />)}
      </div>
      <table className="books-table">
        <tbody>
          {parts.map(p => (
            <tr key={p.key}>
              <td><i className={`sw sb-${p.key}`} /> <strong>{p.label}</strong><br /><span className="muted">{p.note}</span></td>
              <td className="num">{p.value.toLocaleString('en-US', { maximumFractionDigits: 0 })}<br /><span className="muted">{((p.value / Math.max(1, supply)) * 100).toFixed(1)}%</span></td>
            </tr>
          ))}
        </tbody>
      </table>

      <h3 className="section-title">Minted and burned, week by week</h3>
      <p className="hint">New MERI only appears when the town hits its Festival target; a missed week burns 5% of the treasury. In all: <strong>{minted.toFixed(0)}</strong> minted, <strong>{burned.toFixed(0)}</strong> burned.</p>
      <div className="mintburn" role="img" aria-label="Minted and burned MERI for the last 12 weeks">
        {weeks.map(w => (
          <div key={w.week} className="mb-col" title={`Week ${w.week + 1}: traded ${fmt(w.counted, 0)} of ${fmt(w.target, 0)}; ${w.hit ? `${fmt(w.minted, 0)} minted` : `${fmt(w.burned, 0)} burned`}`}>
            <div className="mb-up">{w.hit && <i style={{ height: `${(meri(w.minted) / peak) * 100}%` }} />}</div>
            <div className="mb-down">{!w.hit && <i style={{ height: `${(meri(w.burned) / peak) * 100}%` }} />}</div>
            <span>{w.week + 1}</span>
          </div>
        ))}
        {weeks.length === 0 && <p className="empty-note">The first market week hasn’t ended yet.</p>}
      </div>

      <h3 className="section-title">Goods</h3>
      <p className="hint">Goods only enter the town when someone gathers them, or a shop bakes or forges them. They leave for good when eaten, used up as tools, built into a cottage, or bought by the residents.</p>
      <table className="books-table goods">
        <thead><tr><th>Good</th><th className="num">On shop shelves</th><th className="num">Left on the ground</th></tr></thead>
        <tbody>
          {ITEMS.map((item, i) => (
            <tr key={item}>
              <td className="with-icon"><Icon name={item as Item} /> {item}</td>
              <td className="num">{stock(i)}</td>
              <td className="num">{i < 3 ? world.town.grounds[i] : <span className="muted">made in town</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {world.market && (
        <p className="hint">On Rhea, 1 MERI trades for <strong>{world.market.nearPerMeri.toFixed(4)} NEAR</strong> (pool {world.market.poolId}: {world.market.meriInPool.toFixed(0)} MERI and {world.market.nearInPool.toFixed(2)} NEAR). On testnet this is a working market, not a valuation.</p>
      )}
    </div>
  );
}

// ---------- records ----------

function Records({ account, explorer }: { account: string | null; explorer: string }) {
  const [r, setR] = useState<RecordsView | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    fetch('/api/records').then(x => (x.ok ? x.json() : Promise.reject())).then(setR).catch(() => setFailed(true));
  }, []);
  if (failed) return <p className="empty-note">The record book is out of reach right now. Try again in a moment.</p>;
  if (!r) return <p className="empty-note">Opening the record book…</p>;
  const you = (who: string) => (who === account ? ' (you)' : '');
  return (
    <div className="records">
      <div className="record-grid">
        {r.records.length === 0 && <p className="empty-note">No records yet. The first big sale sets one.</p>}
        {r.records.map(x => (
          <div key={x.id} className="record">
            <span className="muted">{x.title}</span>
            <strong>{x.value.toLocaleString('en-US', { maximumFractionDigits: x.unit === 'MERI' ? 2 : 0 })} <small>{x.unit}</small></strong>
            <span>{short(x.who)}{you(x.who)}, {x.detail}</span>
            {x.tx && <a className="text-link" href={`${explorer}/txns/${x.tx}`} target="_blank" rel="noreferrer">See the transaction</a>}
          </div>
        ))}
        {r.bestWeek && (
          <div className="record">
            <span className="muted">Busiest market week</span>
            <strong>{r.bestWeek.traded.toFixed(0)} <small>MERI traded</small></strong>
            <span>Week {r.bestWeek.week + 1}, against a target of {r.bestWeek.target.toFixed(0)}{r.bestWeek.hit ? ': a Festival' : ''}</span>
          </div>
        )}
        <div className="record">
          <span className="muted">Longest Festival streak</span>
          <strong>{r.bestStreak} <small>weeks</small></strong>
          <span>{r.bestStreak ? 'Weeks in a row the town hit its target.' : 'Still waiting for the first one.'}</span>
        </div>
      </div>
      <div className="top-lists">
        <Top title="Top sellers" unit="MERI" rows={r.topSellers} account={account} />
        <Top title="Top gatherers" unit="goods" rows={r.topGatherers} account={account} />
        <Top title="Most marks" unit={`of ${r.marks.length}`} rows={r.topMarks} account={account} />
      </div>
    </div>
  );
}

function Top({ title, unit, rows, account }: { title: string; unit: string; rows: { who: string; value: number }[]; account: string | null }) {
  return (
    <section>
      <h3 className="section-title">{title}</h3>
      {rows.length === 0 ? <p className="empty-note">Nobody yet.</p> : (
        <ol className="top-list">
          {rows.map(x => <li key={x.who} className={x.who === account ? 'me' : ''}><span>{short(x.who)}</span><span>{x.value.toLocaleString('en-US')} {unit}</span></li>)}
        </ol>
      )}
    </section>
  );
}

// ---------- your marks: a collection to complete ----------

const MARK_ICON: Record<string, IconName> = {
  wood: 'wood', ore: 'ore', wheat: 'wheat', perfect: 'axe', perfect10: 'pick', buyers: 'coin', bread: 'bread', tool: 'tool',
  contract: 'scroll', cottage: 'house', deed: 'key', festival: 'flag',
};

function Marks({ world }: { world: World }) {
  const me = world.me;
  const marks = me?.marks ?? [];
  const got = marks.filter(m => m.done).length;
  return (
    <div className="marks">
      <p className="hint">
        Marks of the trade: one for each part of town life. Each is worth XP, and the full set of {marks.length} raises your stamina cap by <strong>{me?.fullSetBonus ?? 25}</strong> for good.
        You have <strong>{got}</strong>{me?.perfect ? <>, with {me.perfect} perfect swings (best run {me.bestPerfectRun})</> : null}.
      </p>
      <div className="meter"><div className="meter-fill" style={{ width: `${(got / Math.max(1, marks.length)) * 100}%` }} /><span>{got} of {marks.length}</span></div>
      <ul className="mark-grid">
        {marks.map(m => (
          <li key={m.id} className={m.done ? 'done' : ''}>
            <span className="mark-badge" aria-hidden><Icon name={MARK_ICON[m.id] ?? 'rosette'} size={26} /></span>
            <strong>{m.title}</strong>
            <span className="muted">{m.done ? 'Earned' : m.hint}</span>
          </li>
        ))}
      </ul>
      <p className="muted">Shopkeepers you’ve sold to: {me?.soldTo?.map(id => KEEPERS[id]?.keeper ?? id).join(', ') || 'none yet'}.</p>
    </div>
  );
}
