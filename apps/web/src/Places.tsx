// What you see and do at each place on the map. Shops, the notice board, the auction house,
// the guild hall and the caravan reuse their panels; the grounds, your cottage and the
// Festival stage are drawn here.
import { useEffect, useRef, useState } from 'react';
import type { Act, World } from './App';
import { reducedMotion } from './juice';
import { DeedPerks } from './Crier';
import { FestivalExtras, Forge, ShopCoinPanel, latestBanner, toolFor } from './Market';
import type { Config } from './near';
import { SPOTS, type Place } from './TownMap';
import { ShopCard } from './ShopCard';
import { Inventory, NoticeBoard, Deeds } from './Panels';
import { GuildHall } from './Guilds';
import { Caravan } from './Caravan';
import { KEEPERS, fmt, meri, type Item, type Job, type Shop, type SwingTiming } from './types';
import { Icon } from './Icon';

export interface Actions {
  gather: (ground: string, timing?: SwingTiming) => void;
  sell: (shop: Shop, item: Item, qty: number) => void;
  buy: (shop: Shop, item: Item, qty: number) => void;
  use: (item: 'bread' | 'tool') => void;
  build: (item: 'bread' | 'tool') => void;
  deliver: (job: Job, qty: number) => void;
  bid: (shopId: string, amount: bigint) => void;
  appoint: (shopId: string, agent: string | null) => void;
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
  // On phones the drawer is a bottom sheet: drag its handle down to put it away.
  const sheet = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; id: number } | null>(null);
  const isSheet = () => !!sheet.current && getComputedStyle(sheet.current).position === 'fixed';
  const dragStart = (e: React.PointerEvent) => {
    if (!isSheet() || (e.target as HTMLElement).closest('button')) return;
    drag.current = { y: e.clientY, id: e.pointerId };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const dragMove = (e: React.PointerEvent) => {
    if (!drag.current || !sheet.current) return;
    const dy = Math.max(0, e.clientY - drag.current.y);
    sheet.current.style.transform = `translateY(${dy}px)`;
    sheet.current.style.transition = 'none';
  };
  const dragEnd = (e: React.PointerEvent) => {
    if (!drag.current || !sheet.current) return;
    const dy = e.clientY - drag.current.y;
    drag.current = null;
    sheet.current.style.transition = 'transform 0.2s ease-out';
    sheet.current.style.transform = '';
    if (dy > 70) onClose();
  };

  let body: React.ReactNode = null;
  if (place.startsWith('g:')) body = <Ground place={place} world={world} config={config} busy={busy} actions={actions} onGo={onGo} />;
  else if (place.startsWith('s:')) {
    const s = world.shops.find(x => x.shop.id === place.slice(2));
    if (s) body = (
      <ShopCard shop={s} agent={world.agents?.[s.shop.id]} explorer={config.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'}
        prev={prevShops?.find(p => p.shop.id === s.shop.id)} params={world.params} player={world.player} busy={busy} onSell={actions.sell} onBuy={actions.buy} />
    );
    if (s) body = <>{body}<ShopCoinPanel shopId={s.shop.id} world={world} act={act} busy={busy} /></>;
  } else if (place === 'board') body = <NoticeBoard world={world} busy={busy} onDeliver={actions.deliver} />;
  else if (place === 'auction') body = (
    <>
      <DeedPerks world={world} account={account} act={act} />
      <Deeds world={world} account={account} busy={busy} onBid={actions.bid} onAppoint={actions.appoint} />
    </>
  );
  else if (place === 'guildhall') body = <GuildHall world={world} account={account} busy={busy} act={act} town={config.town} />;
  else if (place === 'caravan') body = <Caravan world={world} />;
  else if (place === 'cottage') body = (
    <>
      <Cottage world={world} busy={busy} actions={actions} />
      <Forge world={world} act={act} busy={busy} explorer={config.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'} town={config.town} />
    </>
  );
  else if (place === 'festival') body = (
    <>
      <Festival world={world} onClaim={actions.claim} onFastForward={onFastForward} />
      <FestivalExtras world={world} act={act} busy={busy} />
    </>
  );

  return (
    <aside className="drawer" aria-label={SPOTS[place]?.label} ref={sheet}>
      <header className="drawer-head" onPointerDown={dragStart} onPointerMove={dragMove} onPointerUp={dragEnd} onPointerCancel={dragEnd}>
        <span className="grab" aria-hidden />
        <h2>{SPOTS[place]?.label}</h2>
        <button className="link" onClick={onClose} aria-label="Back to the map"><Icon name="close" /></button>
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
      {world.event?.item === g.item && <EventCard world={world} compact />}
      {(() => {
        const t = toolFor(world, g.item);
        const name = t ? ({ axe: 'Silver Axe', pick: 'Iron Pick', sickle: 'Golden Sickle' } as Record<string, string>)[t.kind] ?? 'tool' : '';
        return t ? <p className="tool-note with-icon"><Icon name="tool" /> Your {name} adds one {g.item} a swing ({t.uses_left} swings left).</p> : null;
      })()}
      <div className="meter big" title={`${left} of ${cap} ${g.item} left`}>
        <div className={`meter-fill ${left / cap < 0.2 ? 'low' : ''}`} style={{ width: `${(left / cap) * 100}%` }} />
        <span>{left} {g.item} left. Regrows through the day, shared by everyone</span>
      </div>
      <SwingButton
        icon={place === 'g:forest' ? 'axe' : place === 'g:mine' ? 'pick' : 'sickle'}
        busy={busy === 'Gather'}
        disabled={!!busy || tired || left < 1}
        label={busy === 'Gather' ? 'Swinging…' : tired ? 'Too tired: eat or rest' : left < 1 ? 'Bare: try another ground' : `Swing ×${config.rules.maxSwingsPerRequest}`}
        sub={`${config.rules.swingCost * config.rules.maxSwingsPerRequest} stamina, ${(me?.toolUses ?? 0) > 0 ? 'tool doubles your yield' : '1 per swing, 2 with a tool'}`}
        run={me?.perfect ? undefined : 'Tap again as your tool crosses the gold notch for bonus XP'}
        onSwing={timing => actions.gather(place.slice(2), timing)}
      />
      <div className="tip-card">
        <strong className="with-icon"><Icon name={g.item as Item} /> In your pack: {have}</strong>
        {best && (
          <p>
            Best buyer right now: <strong>{KEEPERS[best.s.shop.id]?.keeper}</strong> at {best.s.shop.name}, paying <strong>{best.bid.toFixed(2)}</strong>
            {buyers[1] ? <> (next best {buyers[1].bid.toFixed(2)})</> : null}.
          </p>
        )}
        {best && <button className="small" onClick={() => onGo(`s:${best.s.shop.id}`)}>Walk to {best.s.shop.name}</button>}
      </div>
    </div>
  );
}

/** This week's town event: what it is, who's paying more, and what they pay now. */
export function EventCard({ world, compact = false }: { world: World; compact?: boolean }) {
  const e = world.event;
  if (!e) return null;
  const i = ['wood', 'ore', 'wheat'].indexOf(e.item);
  const buyers = world.shops.filter(s => e.shops.includes(s.shop.id) && s.shop.open);
  return (
    <div className={`event-card ${compact ? 'compact' : ''}`}>
      <span className="event-kicker with-icon"><Icon name={e.item as Item} /> This week’s event</span>
      <strong>{e.title}</strong>
      <p>{e.blurb}</p>
      {!compact && buyers.length > 0 && (
        <p className="muted">
          Paying for {e.item} now: {buyers.map(s => `${KEEPERS[s.shop.id]?.keeper} ${meri(s.bid[i]) > 0 ? meri(s.bid[i]).toFixed(2) : '(full right now)'}`).join(', ')}. The shopkeepers raise their targets through the week, so the price climbs while stock stays short.
        </p>
      )}
    </div>
  );
}

// ---------- the swing meter: tap to heft the tool, tap again as it crosses the gold notch ----------

const METER_MS = 1400; // the tool's run along the plank
const NOTCH = 0.7; // where the gold notch sits on the plank (0 to 1)
const HIT_MS = NOTCH * METER_MS;

function SwingButton({ icon, busy, disabled, label, sub, run, onSwing }: {
  icon: 'axe' | 'pick' | 'sickle';
  busy: boolean;
  disabled: boolean;
  label: string;
  sub: string;
  run?: string;
  onSwing: (timing: SwingTiming) => void;
}) {
  const [aim, setAim] = useState<number | null>(null);
  const timer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(timer.current), []);

  const strike = (timing: SwingTiming) => {
    window.clearTimeout(timer.current);
    setAim(null);
    onSwing(timing);
  };
  const press = () => {
    if (aim == null) {
      // With reduced motion there's no meter to watch: swing straight away.
      if (reducedMotion()) return onSwing('ok');
      setAim(performance.now());
      timer.current = window.setTimeout(() => strike('ok'), METER_MS + 60);
      return;
    }
    const off = Math.abs(performance.now() - aim - HIT_MS);
    strike(off < 110 ? 'perfect' : off < 260 ? 'good' : 'ok');
  };

  return (
    <button className={`swing ${busy ? 'swinging' : ''} ${aim != null ? 'aiming' : ''}`} disabled={disabled && aim == null} onClick={press}>
      {aim != null ? (
        <span className="plank" aria-hidden>
          <i className="notch" style={{ left: `${NOTCH * 100}%` }} />
          <span className="heft" style={{ animationDuration: `${METER_MS}ms` }}><Icon name={icon} size={28} /></span>
        </span>
      ) : (
        <span className="swing-icon" aria-hidden><Icon name={icon} size={36} /></span>
      )}
      {aim != null ? 'Strike!' : label}
      <small>{aim != null ? 'Stop it on the gold notch' : run ?? sub}</small>
    </button>
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
          <h2 className="section-title">Your cottage, level {c.level}</h2>
          <p className="hint">A bigger home holds more strength: your stamina cap is <strong>{c.maxStamina}</strong>. Building burns the tools and bread you bring, so the shops sell more and the town grows.</p>
          {c.next ? (
            <>
              <div className="build">
                <div>
                  <span className="with-icon"><Icon name="tool" /> Tools</span>
                  <div className="bar"><div style={{ width: `${Math.min(100, (c.tool / Math.max(1, c.next.cost.tool)) * 100)}%` }} /></div>
                  <span className="muted">{c.tool} / {c.next.cost.tool}</span>
                </div>
                <div>
                  <span className="with-icon"><Icon name="bread" /> Bread</span>
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
        <p className="muted">Lifetime: {world.me.stats.gathered} gathered, {world.me.stats.sold} MERI from sales, {world.me.stats.delivered} MERI from contracts</p>
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
      {latestBanner(world) && <div className="fest-banner" title={`Hung by ${latestBanner(world)!.who}`}>“{latestBanner(world)!.text}”</div>}
      {world.event && <EventCard world={world} />}
      <p className="hint">
        Every market week the town has a trading target. Hit it and the Festival <strong>mints new MERI</strong> to everyone who traded,
        in proportion to how much they traded (up to 500 each). Miss it and <strong>5% of the treasury burns</strong>, and the town gets poorer.
      </p>
      <div className="meter big"><div className={`meter-fill ${counted >= target ? '' : 'amber'}`} style={{ width: `${Math.min(100, (counted / target) * 100)}%` }} /><span>{counted.toFixed(0)} of {target.toFixed(0)} MERI traded this week</span></div>
      <p>Streak: <strong>{world.town.streak}</strong>, best ever {world.town.best_streak}</p>
      {claimable > 0n && <button className="primary" onClick={onClaim}>Claim your Festival share: {fmt(claimable)} MERI</button>}
      <h3>Past weeks</h3>
      {world.weeks.length === 0 && <p className="empty-note">The first Festival hasn’t happened yet.</p>}
      <ul className="weeks">
        {[...world.weeks].reverse().map(w => (
          <li key={w.week} className={w.hit ? 'good' : 'bad'}>
            Week {w.week + 1}: {w.hit ? `Festival, ${fmt(w.minted, 0)} MERI minted` : `missed, ${fmt(w.burned, 0)} MERI burned`} <span className="muted">({fmt(w.counted, 0)} of {fmt(w.target, 0)})</span>
          </li>
        ))}
      </ul>
      <button onClick={onFastForward}><Icon name="forward" /> See next week, fast-forwarded</button>
    </div>
  );
}

