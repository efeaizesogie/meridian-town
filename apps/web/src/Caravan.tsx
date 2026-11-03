// The caravan board: today's sealed-bid import round. Shops' orders are public; suppliers'
// prices stay hidden (only a count of sealed bids) until they reveal in the second half.
import { useEffect, useState } from 'react';
import type { World } from './App';
import { ICON, KEEPERS, fmt, type CaravanRound } from './types';

const RAW = ['wood', 'ore', 'wheat'] as const;

function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  return now;
}

const supplierName = (world: World, account: string) =>
  Object.values(world.suppliers ?? {}).find(s => s.accountId === account)?.name ?? account.split('.')[0];

export function Caravan({ world }: { world: World }) {
  const now = useNow() - world.clock.skewMs;
  const c = world.caravan;
  const r = c?.round;
  const left = Math.max(0, Math.round(((c?.phase_ends_ms ?? 0) - now) / 1000));
  const mmss = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;

  return (
    <div className="panel caravan">
      <div className="square-head">
        <h2 className="section-title">The caravan</h2>
        {r && (
          <span className={`status ${c!.phase === 'commit' ? 'at-auction' : c!.phase === 'reveal' ? 'open' : 'closed'}`}>
            {c!.phase === 'commit' ? `sealed bids · ${mmss}` : c!.phase === 'reveal' ? `revealing · ${mmss}` : 'closed'}
          </span>
        )}
      </div>
      <p className="hint">
        Shops short of raw goods pool their orders. Outside suppliers seal their prices, then reveal; the lowest price fills every order it's within.
        Anyone can bid: the market doesn't know who runs a supplier.
      </p>
      {!r && <p className="empty-note">No caravan today: no shop is short enough to order.</p>}
      {r && (
        <div className="caravan-goods">
          {RAW.map((item, i) => {
            const orders = r.orders.filter(o => o.item === item);
            if (!orders.length) return null;
            const bids = r.bids.filter(b => b.item === item).sort((a, b) => Number(BigInt(a.price) - BigInt(b.price)));
            return (
              <div className="good" key={item}>
                <div className="good-head">
                  <strong>{ICON[item]} {item}</strong>
                  <span className="muted">cost floor {fmt(c!.import_cost[i])}</span>
                </div>
                {orders.map(o => (
                  <div key={o.shop_id} className="muted">{KEEPERS[o.shop_id]?.keeper ?? o.shop_id} wants {o.quantity}, pays up to {fmt(o.max_price)}</div>
                ))}
                <div className="sealed">
                  {r.commits[i]} sealed bid{r.commits[i] === 1 ? '' : 's'}
                  {bids.length > 0 && <> · revealed: {bids.map((b, j) => <span key={b.supplier} className={j === 0 ? 'lead' : ''}>{supplierName(world, b.supplier)} {fmt(b.price)}</span>).reduce<React.ReactNode[]>((a, x, j) => (j ? [...a, ', ', x] : [x]), [])}</>}
                </div>
              </div>
            );
          })}
        </div>
      )}
      {c?.last && <LastRound world={world} round={c.last} />}
    </div>
  );
}

function LastRound({ world, round }: { world: World; round: CaravanRound }) {
  if (!round.settled) return null;
  return (
    <div className="last-round">
      <h4>Yesterday's caravan</h4>
      {round.fills.length === 0 && <p className="empty-note">No bid was low enough to fill an order.</p>}
      {round.fills.map((f, i) => (
        <div key={i} className="muted">
          {supplierName(world, f.supplier)} delivered {f.quantity} {ICON[f.item]} {f.item} to {KEEPERS[f.shop_id]?.keeper ?? f.shop_id} at {fmt(f.price)}
        </div>
      ))}
    </div>
  );
}
