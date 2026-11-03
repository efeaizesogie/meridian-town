// What you see and do at each place on the map. Shops, the notice board, the auction house,
// the guild hall and the caravan reuse their panels; the grounds, your cottage and the
// Festival stage are drawn here.
import type { Act, World } from './App';
import type { Config } from './near';
import { SPOTS, type Place } from './TownMap';
import { ShopCard } from './ShopCard';
import { Inventory, NoticeBoard, Deeds } from './Panels';
import { GuildHall } from './Guilds';
import { Caravan } from './Caravan';
import { ICON, KEEPERS, fmt, meri, type Item, type Job, type Shop } from './types';

export interface Actions {
  gather: (ground: string) => void;
  sell: (shop: Shop, item: Item, qty: number) => void;
  buy: (shop: Shop, item: Item, qty: number) => void;
  use: (item: 'bread' | 'tool') => void;
  build: (item: 'bread' | 'tool') => void;
  deliver: (job: Job, qty: number) => void;
  bid: (shopId: string, amount: bigint) => void;
  claim: () => void;
}

const GROUND: Record<string, { item: Item; idx: number; blurb: string }> = {
  'g:forest': { item: 'wood', idx: 0, blurb: 'Old oaks and fallen timber. The Forge and the Lumberyard buy wood.' },
  'g:mine': { item: 'ore', idx: 1, blurb: 'A cold shaft in the hill. The Forge and the Mine Office buy ore.' },
  'g:fields': { item: 'wheat', idx: 2, blurb: 'Golden rows to the horizon. The Bakery and the Granary buy wheat.' },
};

export function PlaceDrawer({ place, world, config, account, busy, act, actions, prevShops, onClose, onFastForward, onGo }: {
  place: Place;
  world: World;
  config: Config;
  account: string;
  busy: string | null;
  act: Act;
  actions: Actions;
  prevShops: Shop[] | undefined;
  onClose: () => void;
  onFastForward: () => void;
  onGo: (p: Place) => void;
}) {
  let body: React.ReactNode = null;
  if (place.startsWith('g:')) body = <Ground place={place} world={world} config={config} busy={busy} actions={actions} onGo={onGo} />;
  else if (place.startsWith('s:')) {
    const s = world.shops.find(x => x.shop.id === place.slice(2));
    if (s) body = (
      <ShopCard shop={s} agent={world.agents?.[s.shop.id]} explorer={config.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'}
        prev={prevShops?.find(p => p.shop.id === s.shop.id)} params={world.params} player={world.player} busy={busy} onSell={actions.sell} onBuy={actions.buy} />
    );
  } else if (place === 'board') body = <NoticeBoard world={world} busy={busy} onDeliver={actions.deliver} />;
  else if (place === 'auction') body = <Deeds world={world} account={account} busy={busy} onBid={actions.bid} />;
  else if (place === 'guildhall') body = <GuildHall world={world} account={account} busy={busy} act={act} town={config.town} />;
  else if (place === 'caravan') body = <Caravan world={world} />;
  else if (place === 'cottage') body = <Cottage world={world} busy={busy} actions={actions} />;
  else if (place === 'festival') body = <Festival world={world} onClaim={actions.claim} onFastForward={onFastForward} />;

  return (
    <aside className="drawer" aria-label={SPOTS[place]?.label}>
      <header className="drawer-head">
        <h2>{SPOTS[place]?.label}</h2>
        <button className="link" onClick={onClose} aria-label="Back to the map">✕</button>
      </header>
      <div className="drawer-body">{body}</div>
    </aside>
  );
}

function Ground({ place, world, config, busy, actions, onGo }: { place: Place; world: World; config: Config; busy: string | null; actions: Actions; onGo: (p: Place) => void }) {
  const g = GROUND[place];
  const cap = world.params.ground_regen_per_day[g.idx] * world.params.ground_capacity_days;
  const left = world.town.grounds[g.idx];
  const me = world.me;
  const tired = (me?.stamina ?? 0) < config.rules.swingCost;
  const have = world.player?.items[g.idx] ?? 0;
  const buyers = world.shops
    .map(s => ({ s, bid: meri(s.bid[g.idx]) }))
    .filter(x => x.bid > 0)
    .sort((a, b) => b.bid - a.bid);
  const best = buyers[0];
  return (
    <div className="ground-panel">
      <p className="hint">{g.blurb}</p>
      <div className="meter big" title={`${left} of ${cap} ${g.item} left`}>
        <div className={`meter-fill ${left / cap < 0.2 ? 'low' : ''}`} style={{ width: `${(left / cap) * 100}%` }} />
        <span>{left} {g.item} left · regrows through the day · shared by everyone</span>
      </div>
      <button className={`swing ${busy === 'Gather' ? 'swinging' : ''}`} disabled={!!busy || tired || left < 1} onClick={() => actions.gather(place.slice(2))}>
        <span className="swing-icon" aria-hidden>{place === 'g:forest' ? '🪓' : place === 'g:mine' ? '⛏️' : '🌾'}</span>
        {busy === 'Gather' ? 'Swinging…' : tired ? 'Too tired: eat or rest' : left < 1 ? 'Bare: try another ground' : `Swing ×${config.rules.maxSwingsPerRequest}`}
        <small>{config.rules.swingCost * config.rules.maxSwingsPerRequest} stamina · {(me?.toolUses ?? 0) > 0 ? 'tool doubles your yield' : '1 per swing, 2 with a tool'}</small>
      </button>
      <div className="tip-card">
        <strong>{ICON[g.item]} In your pack: {have}</strong>
        {best && (
          <p>
            Best buyer right now: <strong>{KEEPERS[best.s.shop.id]?.keeper}</strong> at {best.s.shop.name}, paying <strong>{best.bid.toFixed(2)}</strong>
            {buyers[1] ? <> (next best {buyers[1].bid.toFixed(2)})</> : null}.
          </p>
        )}
        {best && <button className="small" onClick={() => onGo(`s:${best.s.shop.id}`)}>Walk to {best.s.shop.name} →</button>}
      </div>
    </div>
  );
}

function Cottage({ world, busy, actions }: { world: World; busy: string | null; actions: Actions }) {
  const c = world.me?.cottage;
  const items = world.player?.items ?? [0, 0, 0, 0, 0];
  return (
    <div className="cottage-panel">
      <Inventory world={world} busy={busy} onUse={actions.use} />
      {c && (
        <div className="panel">
          <h2 className="section-title">Your cottage · level {c.level}</h2>
          <p className="hint">A bigger home holds more strength: your stamina cap is <strong>{c.maxStamina}</strong>. Building burns the tools and bread you bring, so the shops sell more and the town grows.</p>
          {c.next ? (
            <>
              <div className="build">
                <div>
                  <span>{ICON.tool} Tools</span>
                  <div className="bar"><div style={{ width: `${Math.min(100, (c.tool / Math.max(1, c.next.cost.tool)) * 100)}%` }} /></div>
                  <span className="muted">{c.tool} / {c.next.cost.tool}</span>
                </div>
                <div>
                  <span>{ICON.bread} Bread</span>
                  <div className="bar"><div style={{ width: `${Math.min(100, (c.bread / Math.max(1, c.next.cost.bread)) * 100)}%` }} /></div>
                  <span className="muted">{c.bread} / {c.next.cost.bread}</span>
                </div>
              </div>
              <p className="muted">Level {c.next.level} raises your stamina cap to {c.next.maxStamina}.</p>
              <div className="row">
                <button className="small" disabled={!!busy || items[4] < 1 || c.tool >= c.next.cost.tool} onClick={() => actions.build('tool')}>Add a tool</button>
                <button className="small" disabled={!!busy || items[3] < 1 || c.bread >= c.next.cost.bread} onClick={() => actions.build('bread')}>Add a loaf</button>
              </div>
            </>
          ) : <p>Your cottage is the finest in Meridian.</p>}
        </div>
      )}
      {world.me && (
        <p className="muted">Lifetime: {world.me.stats.gathered} gathered · {world.me.stats.sold} MERI from sales · {world.me.stats.delivered} MERI from contracts</p>
      )}
    </div>
  );
}

function Festival({ world, onClaim, onFastForward }: { world: World; onClaim: () => void; onFastForward: () => void }) {
  const counted = meri(world.town.week_counted);
  const target = meri(world.town.week_target);
  const claimable = BigInt(world.player?.claimable ?? '0');
  return (
    <div className="festival-panel">
      <p className="hint">
        Every market week the town has a trading target. Hit it and the Festival <strong>mints new MERI</strong> to everyone who traded,
        in proportion to how much they traded (up to 500 each). Miss it and <strong>5% of the treasury burns</strong>, and the town gets poorer.
      </p>
      <div className="meter big"><div className={`meter-fill ${counted >= target ? '' : 'amber'}`} style={{ width: `${Math.min(100, (counted / target) * 100)}%` }} /><span>{counted.toFixed(0)} of {target.toFixed(0)} MERI traded this week</span></div>
      <p>Streak: <strong>{world.town.streak}</strong> · best ever {world.town.best_streak}</p>
      {claimable > 0n && <button className="primary" onClick={onClaim}>🎁 Claim your Festival share: {fmt(claimable)} MERI</button>}
      <h3>Past weeks</h3>
      {world.weeks.length === 0 && <p className="empty-note">The first Festival hasn't happened yet.</p>}
      <ul className="weeks">
        {[...world.weeks].reverse().map(w => (
          <li key={w.week} className={w.hit ? 'good' : 'bad'}>
            Week {w.week + 1}: {w.hit ? `🎉 Festival · ${fmt(w.minted, 0)} MERI minted` : `🔥 missed · ${fmt(w.burned, 0)} MERI burned`} <span className="muted">({fmt(w.counted, 0)} of {fmt(w.target, 0)})</span>
          </li>
        ))}
      </ul>
      <button onClick={onFastForward}>⏩ What happens next week? Fast-forward it</button>
    </div>
  );
}

