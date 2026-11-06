// The town crier: what just happened in Meridian (contracts, closures, records, shocks, the
// Festival), plain headlines about the market, a price chart with shocks shaded, the daily
// chest, and the deed holders' perks (name and decorate a shop, vote on next week's event).
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Act, World } from './App';
import { api } from './near';
import { ITEMS, KEEPERS, type Item } from './types';
import { Icon } from './Icon';

export interface FeedItem { id: number; at: number; kind: string; text: string; who?: string; tx?: string }
export interface FeedView { items: FeedItem[]; standout: string[]; shock: ShockView | null; nextWeek: number; vote: { id: string; title: string; votes: number }[] }
export interface ShockView { id: string; title: string; blurb: string; item: Item; shops: string[]; boostBps: number; start: number; end: number }
export interface ShopStyle { holder: string; title: string; color: string; flag: string }

/** The crier's feed, refreshed every 15 seconds. */
export function useFeed() {
  const [feed, setFeed] = useState<FeedView | null>(null);
  useEffect(() => {
    let live = true;
    const load = () => fetch('/api/feed').then(r => (r.ok ? r.json() : null)).then(f => live && f && setFeed(f)).catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => { live = false; clearInterval(t); };
  }, []);
  return feed;
}

const ago = (at: number) => {
  const s = Math.max(0, Math.round((Date.now() - at) / 1000));
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : `${Math.round(s / 86_400)} d ago`;
};

const KIND_ICON: Record<string, Parameters<typeof Icon>[0]['name']> = {
  contract: 'scroll', closed: 'door', opened: 'house', deed: 'key', festival: 'flag', shock: 'bell', record: 'rosette', sale: 'coin', perfect: 'axe', chest: 'chest',
};

/** A slim live strip: an active shock first, then the latest moments, one at a time. */
export function CrierTicker({ world, feed, onOpen, showShock = true }: { world: World; feed: FeedView | null; onOpen: () => void; showShock?: boolean }) {
  const [i, setI] = useState(0);
  const items = feed?.items.slice(0, 6) ?? [];
  useEffect(() => {
    if (items.length < 2) return;
    const t = setInterval(() => setI(n => n + 1), 5000);
    return () => clearInterval(t);
  }, [items.length]);
  const shock = world.shock ?? feed?.shock ?? null;
  const it = items.length ? items[i % items.length] : null;
  return (
    <div className="crier-strip">
      {shock && showShock && <ShockBanner shock={shock} />}
      <button className="crier-line" onClick={onOpen} aria-label="Open the town crier">
        <span className="crier-tag"><Icon name="crier" size={16} /> Town crier</span>
        {it ? (
          <span key={it.id} className="crier-text"><Icon name={KIND_ICON[it.kind] ?? 'scroll'} size={16} /> {it.text} <small className="muted">{ago(it.at)}</small></span>
        ) : (
          <span className="crier-text muted">{feed?.standout[0] ?? 'Listening for news…'}</span>
        )}
      </button>
    </div>
  );
}

/**
 * On the full-screen map, news comes up on its own: each new crier item shows for a few seconds
 * at the bottom of the screen, then gets out of the way.
 */
export function CrierPop({ feed, onOpen }: { feed: FeedView | null; onOpen: () => void }) {
  const newest = feed?.items[0];
  const seen = useRef<number | null>(null);
  const [shown, setShown] = useState<FeedItem | null>(null);
  useEffect(() => {
    if (!newest) return;
    // The first read is old news; only items that arrive while you play pop up.
    if (seen.current !== null && newest.id !== seen.current) {
      setShown(newest);
      const t = setTimeout(() => setShown(null), 7000);
      seen.current = newest.id;
      return () => clearTimeout(t);
    }
    seen.current = newest.id;
  }, [newest?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!shown) return null;
  return (
    <button key={shown.id} className="crier-pop" onClick={onOpen} aria-live="polite">
      <span className="crier-tag"><Icon name="crier" size={16} /> Town crier</span>
      <span className="crier-text"><Icon name={KIND_ICON[shown.kind] ?? 'scroll'} size={16} /> {shown.text}</span>
    </button>
  );
}

export function ShockBanner({ shock }: { shock: ShockView }) {
  const [, tick] = useState(0);
  useEffect(() => {
    const t = setInterval(() => tick(n => n + 1), 1000);
    return () => clearInterval(t);
  }, []);
  const left = Math.max(0, shock.end - Date.now());
  const up = shock.boostBps > 0;
  return (
    <div className={`shock-banner ${up ? 'up' : 'down'}`} role="status">
      <Icon name="bell" size={18} />
      <span><strong>{shock.title}.</strong> {shock.item[0].toUpperCase() + shock.item.slice(1)} {up ? 'pays more' : 'pays less'} at {shock.shops.map(id => KEEPERS[id]?.keeper ?? id).join(' and ')}</span>
      <span className="shock-time">{Math.floor(left / 60_000)}:{String(Math.floor((left % 60_000) / 1000)).padStart(2, '0')}</span>
    </div>
  );
}

/** The full crier, for the Town books: headlines, a price chart with shocks shaded, and the feed. */
export function CrierPanel({ feed, explorer }: { feed: FeedView | null; explorer: string }) {
  if (!feed) return <p className="empty-note">Listening for news…</p>;
  return (
    <div className="crier-panel">
      <section>
        <h3 className="section-title">Talk of the market</h3>
        <ul className="standout">{feed.standout.map((s, i) => <li key={i}>{s}</li>)}</ul>
      </section>
      <PriceChart />
      <section>
        <h3 className="section-title">Heard around town</h3>
        {feed.items.length === 0 && <p className="empty-note">Quiet so far.</p>}
        <ul className="crier-list">
          {feed.items.map(it => (
            <li key={it.id}>
              <Icon name={KIND_ICON[it.kind] ?? 'scroll'} size={18} />
              <span>{it.text}{it.tx && <> · <a className="text-link" href={`${explorer}/txns/${it.tx}`} target="_blank" rel="noreferrer">tx</a></>}</span>
              <small className="muted">{ago(it.at)}</small>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// ---------- prices over the last day, with shocks shaded ----------

interface Prices { items: Item[]; points: { at: number; price: (number | null)[] }[]; shocks: { id: string; title: string; start: number; end: number }[] }

function PriceChart() {
  const [data, setData] = useState<Prices | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  useEffect(() => {
    fetch('/api/prices').then(r => (r.ok ? r.json() : null)).then(setData).catch(() => {});
  }, []);
  const W = 720, H = 220, L = 40, R = 70, T = 12, B = 24;
  const view = useMemo(() => {
    if (!data || data.points.length < 2) return null;
    const pts = data.points.filter(p => p.at > Date.now() - 86_400_000);
    if (pts.length < 2) return null;
    const t0 = pts[0].at, t1 = pts.at(-1)!.at;
    // Index each good to its own first value, so goods with different prices share one axis.
    const first = ITEMS.map((_, i) => pts.find(p => p.price[i] != null)?.price[i] ?? null);
    const idx = (p: (typeof pts)[number], i: number) => (p.price[i] != null && first[i] ? p.price[i]! / first[i]! : null);
    const all = pts.flatMap(p => ITEMS.map((_, i) => idx(p, i))).filter((v): v is number => v != null);
    const lo = Math.min(0.8, ...all), hi = Math.max(1.2, ...all);
    const x = (t: number) => L + ((t - t0) / Math.max(1, t1 - t0)) * (W - L - R);
    const y = (v: number) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
    const paths = ITEMS.map((_, i) => {
      let d = '', pen = false;
      for (const p of pts) {
        const v = idx(p, i);
        if (v == null) { pen = false; continue; }
        d += `${pen ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(v).toFixed(1)}`;
        pen = true;
      }
      return d;
    });
    const shocks = data.shocks.filter(s => s.end > t0 && s.start < t1).map(s => ({ ...s, x0: x(Math.max(t0, s.start)), x1: x(Math.min(t1, s.end)) }));
    return { pts, first, idx, x, y, paths, shocks, lo, hi, t0, t1 };
  }, [data]);
  if (!view) return <p className="empty-note">The price chart fills in as the day goes on.</p>;
  const hp = hover != null ? view.pts[hover] : null;
  return (
    <figure className="chart crier-chart">
      <figcaption>
        <strong>Prices over the last day</strong>
        <span className="muted">Each good against where it started the day (1× = unchanged). Raw goods show what shops pay you; bread and tools what you pay. A red pennant marks where a market shock began; its rope runs as long as it lasted.</span>
      </figcaption>
      <div className="legend">{ITEMS.map(i => <span key={i}><i className={`sw s-${i}`} />{i}</span>)}</div>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Prices over the last day, with market shocks marked"
        onPointerMove={e => {
          const r = e.currentTarget.getBoundingClientRect();
          const t = view.t0 + ((((e.clientX - r.left) / r.width) * W - L) / (W - L - R)) * (view.t1 - view.t0);
          let best = 0;
          view.pts.forEach((p, n) => { if (Math.abs(p.at - t) < Math.abs(view.pts[best].at - t)) best = n; });
          setHover(best);
        }}
        onPointerLeave={() => setHover(null)}>
        {view.shocks.map(s => (
          <g key={s.start} className="shock-flag">
            {/* A pennant where the shock began, and a rope along the top for as long as it lasted. */}
            <line className="shock-pole" x1={s.x0} x2={s.x0} y1={T} y2={H - B} />
            <line className="shock-rope" x1={s.x0} x2={Math.max(s.x0 + 2, s.x1)} y1={T + 1} y2={T + 1} />
            <path className="shock-pennant" d={`M${s.x0},${T} l12,5 l-12,5 z`} />
            <text className="axis" x={s.x0 + 15} y={T + 9}>{s.title}</text>
          </g>
        ))}
        <line className="ref" x1={L} x2={W - R} y1={view.y(1)} y2={view.y(1)} />
        <text className="axis" x={L - 6} y={view.y(1) + 4} textAnchor="end">1×</text>
        <text className="axis" x={L - 6} y={view.y(view.hi) + 8} textAnchor="end">{view.hi.toFixed(1)}×</text>
        <text className="axis" x={L - 6} y={view.y(view.lo)} textAnchor="end">{view.lo.toFixed(1)}×</text>
        {view.paths.map((d, i) => <path key={i} className={`line s-${ITEMS[i]}`} d={d} />)}
        {ITEMS.map((item, i) => {
          const last = [...view.pts].reverse().find(p => p.price[i] != null);
          const v = last && view.idx(last, i);
          return v != null ? <text key={item} className="direct" x={W - R + 6} y={view.y(v) + 4}>{item} {last!.price[i]!.toFixed(2)}</text> : null;
        })}
        {hp && <line className="crosshair" x1={view.x(hp.at)} x2={view.x(hp.at)} y1={T} y2={H - B} />}
      </svg>
      {hp && (
        <div className="tip">
          <strong>{new Date(hp.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</strong>
          {ITEMS.map((it, i) => <div key={it}><i className={`sw s-${it}`} /> {it}: {hp.price[i] == null ? 'none' : `${hp.price[i]!.toFixed(2)} MERI`}</div>)}
        </div>
      )}
    </figure>
  );
}

// ---------- the daily chest ----------

export function ChestButton({ world, act, onOpened }: { world: World; act: Act; onOpened: (r: ChestResult) => void }) {
  const c = world.me?.chest;
  if (!c) return null;
  return (
    <button className={`chest-btn ${c.available ? 'ready' : ''}`} disabled={!c.available}
      title={c.available ? `Today’s chest: +${c.next.stamina} stamina, +${c.next.xp} XP${c.next.toolUses ? `, ${c.next.toolUses} swings with a borrowed tool` : ''}` : `Come back tomorrow to keep your ${c.streak}-day streak`}
      onClick={() => act('Chest', async () => {
        const r = await api<ChestResult>('/api/chest', {});
        onOpened(r);
        return `Day ${r.streak} chest: +${r.stamina} stamina, +${r.xp} XP${r.toolUses ? `, and a borrowed tool for ${r.toolUses} swings` : ''}.`;
      })}>
      <Icon name="chest" size={22} />
      <span className="lbl">{c.available ? 'Daily chest' : 'Opened'}</span>
      {c.streak > 0 && <span className="streak"><Icon name="flame" size={14} />{c.streak}</span>}
    </button>
  );
}
export interface ChestResult { streak: number; stamina: number; xp: number; toolUses: number; levelUp?: { level: number; title: string } | null }

// ---------- deed perks: name and decorate your shop, vote on next week's event ----------

const COLORS = ['gold', 'crimson', 'teal', 'violet', 'forest', 'sky'];
const FLAGS = ['none', 'banner', 'bunting', 'lanterns', 'flowers'];

export function DeedPerks({ world, account, act }: { world: World; account: string; act: Act }) {
  const feed = useFeed();
  const mine = world.shops.filter(s => s.deed_holder === account);
  if (!mine.length) {
    return (
      <div className="tip-card perks-teaser">
        <strong className="with-icon"><Icon name="key" /> What a deed gets you</strong>
        <p>Half the shop’s daily profit, the right to choose the AI that runs it, a name and colours for it on the island, and a vote on each week’s town event.</p>
      </div>
    );
  }
  return (
    <div className="panel perks">
      <h2 className="section-title">Your shops</h2>
      {mine.map(s => <ShopStyler key={s.shop.id} shopId={s.shop.id} name={s.shop.name} style={world.styles?.[s.shop.id]} act={act} />)}
      {feed && (
        <div className="vote">
          <strong>Choose next week’s event</strong>
          <p className="hint">Deed holders pick what moves the market in week {feed.nextWeek + 1}. Most votes wins; a tie or no votes falls back to the usual rotation.</p>
          <div className="vote-options">
            {feed.vote.map(v => (
              <button key={v.id} className="small" onClick={() => act('Vote', async () => {
                await api('/api/deed/vote', { eventId: v.id });
                return `You voted for the ${v.title} next week.`;
              })}>{v.title} <span className="xp-pill">{v.votes}</span></button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function ShopStyler({ shopId, name, style, act }: { shopId: string; name: string; style?: ShopStyle; act: Act }) {
  const [title, setTitle] = useState(style?.title ?? name);
  const [color, setColor] = useState(style?.color ?? 'gold');
  const [flag, setFlag] = useState(style?.flag ?? 'banner');
  return (
    <form className="styler" onSubmit={e => {
      e.preventDefault();
      act('Decorate', async () => {
        await api('/api/deed/style', { shopId, title, color, flag });
        return `${title} now shows on the island.`;
      });
    }}>
      <label>Shop name <input value={title} maxLength={28} onChange={e => setTitle(e.target.value)} /></label>
      <div className="swatches" role="radiogroup" aria-label="Colour">
        {COLORS.map(c => <button type="button" key={c} role="radio" aria-checked={color === c} aria-label={c} className={`swatch deco-${c} ${color === c ? 'on' : ''}`} onClick={() => setColor(c)} />)}
      </div>
      <div className="seg" role="radiogroup" aria-label="Decoration">
        {FLAGS.map(f => <button type="button" key={f} role="radio" aria-checked={flag === f} className={flag === f ? 'on' : ''} onClick={() => setFlag(f)}>{f}</button>)}
      </div>
      <button className="primary small">Save</button>
    </form>
  );
}
