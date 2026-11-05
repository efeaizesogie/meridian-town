import { useState } from 'react';
import type { LogLine, World } from './App';
import { ITEMS, KEEPERS, fmt, meri, short, type Job } from './types';
import { Icon } from './Icon';

export function Inventory({ world, busy, onUse }: { world: World; busy: string | null; onUse: (item: 'bread' | 'tool') => void }) {
  const items = world.player?.items ?? [0, 0, 0, 0, 0];
  const toolUses = world.me?.toolUses ?? 0;
  return (
    <div className="panel">
      <h2 className="section-title">Your pack</h2>
      <div className="pack">
        {ITEMS.map((item, i) => (
          <div key={item} className={`slot ${items[i] ? '' : 'empty'}`}>
            <span className="slot-icon"><Icon name={item} size={28} /></span>
            <span className="slot-count">{items[i]}</span>
            <span className="slot-name">{item}</span>
          </div>
        ))}
      </div>
      <div className="pack-actions">
        <button disabled={!!busy || items[3] < 1} onClick={() => onUse('bread')} title="Burns one bread on chain; restores 25 stamina">Eat bread</button>
        <button disabled={!!busy || items[4] < 1} onClick={() => onUse('tool')} title="Burns one tool on chain; 25 swings at double yield">Use a tool</button>
      </div>
      <p className="hint">{toolUses > 0 ? `Tool in hand: ${toolUses} swings at double yield.` : 'No tool in hand: each swing yields 1.'}</p>
    </div>
  );
}

export function NoticeBoard({ world, busy, onDeliver }: { world: World; busy: string | null; onDeliver: (job: Job, qty: number) => void }) {
  const now = Date.now() - world.clock.skewMs;
  return (
    <div className="panel">
      <h2 className="section-title">Notice board</h2>
      <p className="hint">Delivery contracts. The shop locks the money when it posts; each unit you deliver pays out on the spot.</p>
      {world.jobs.length === 0 && <p className="empty-note">No contracts posted. Shops post one when their stock runs low.</p>}
      {world.jobs.map(job => {
        const i = ITEMS.indexOf(job.item);
        const have = world.player?.items[i] ?? 0;
        const mins = Math.max(0, Math.round((job.deadline_ns / 1e6 - now) / 60000));
        const keeper = KEEPERS[job.shop_id]?.keeper ?? job.shop_id;
        return (
          <div className="job" key={job.id}>
            <div>
              <strong>{keeper}</strong> needs {job.remaining} {job.item} at <strong>{fmt(job.unit_price)}</strong>
              <div className="muted">{fmt(BigInt(job.unit_price) * BigInt(job.remaining))} MERI held in escrow, {mins} min left</div>
            </div>
            <button className="small" disabled={!!busy || have < 1} onClick={() => onDeliver(job, Math.min(have, job.remaining))}>
              Deliver {Math.min(have, job.remaining) || ''}
            </button>
          </div>
        );
      })}
    </div>
  );
}

export function Deeds({ world, account, busy, onBid }: { world: World; account: string; busy: string | null; onBid: (shopId: string, amount: bigint) => void }) {
  const [amount, setAmount] = useState<Record<string, string>>({});
  const reserve = BigInt(world.params.auction_reserve);
  const mine = world.shops.filter(s => s.deed_holder === account);
  return (
    <div className="panel">
      <h2 className="section-title">Deeds &amp; auctions</h2>
      <p className="hint">A deed is the shop. Its holder appoints the shop’s agent and collects its dividends. Broke shops are auctioned; the winning bid refills the till.</p>
      {world.auctions.length === 0 && <p className="empty-note">No deeds for sale right now.</p>}
      {world.auctions.map(a => {
        const shop = world.shops.find(s => s.shop.id === a.shop_id);
        const high = BigInt(a.high_bid);
        const min = a.high_bidder ? (high * BigInt(10_000 + world.params.auction_min_raise_bps)) / 10_000n : reserve;
        const value = amount[a.shop_id] ?? (meri(min) + 0.01).toFixed(2);
        const leading = a.high_bidder === account;
        return (
          <div className="auction" key={a.shop_id}>
            <div className="auction-head">
              <strong>{shop?.shop.name}</strong>
              <span className={`status ${a.kind === 'bankruptcy' ? 'closed' : 'at-auction'}`}>{a.kind === 'bankruptcy' ? 'bankrupt' : 'town sale'}</span>
            </div>
            <div className="muted">
              {a.high_bidder ? <>High bid {fmt(high)} by {leading ? 'you' : short(a.high_bidder)}</> : <>Reserve {fmt(reserve, 0)}</>}. Settles after day {a.ends_day + 1}
              {shop && <>. Till {fmt(shop.cash, 0)}, {fmt(shop.shop.dividends_paid, 0)} paid out so far</>}
            </div>
            <div className="row">
              <input className="small" inputMode="decimal" value={value} onChange={e => setAmount({ ...amount, [a.shop_id]: e.target.value })} />
              <button className="small primary" disabled={!!busy || leading} onClick={() => onBid(a.shop_id, BigInt(Math.round(Number(value) * 1e6)))}>
                {leading ? 'You lead' : 'Bid'}
              </button>
            </div>
          </div>
        );
      })}
      {mine.length > 0 && (
        <div className="owned">
          <h3>Your deeds</h3>
          {mine.map(s => (
            <div key={s.shop.id} className="muted">
              {s.shop.name}: till {fmt(s.cash, 0)}, {fmt(s.shop.dividends_paid)} paid to you so far
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function TownLog({ log, busy }: { log: LogLine[]; busy: string | null }) {
  return (
    <div className="panel log">
      <h2 className="section-title">Town log</h2>
      {busy && <p className="pending">{busy}… waiting for the chain</p>}
      {log.length === 0 && !busy && <p className="empty-note">Your trades and their results appear here.</p>}
      <ul>
        {log.map(l => (
          <li key={l.at} className={l.tone}>
            <time>{new Date(l.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</time> {l.text}
          </li>
        ))}
      </ul>
    </div>
  );
}
