import { useCallback, useEffect, useRef, useState } from 'react';
import { api, call, getJSON, loadConfig, me, signOut, view, type Config } from './near';
import { ITEMS, fmt, type AgentReport, type Auction, type CaravanView, type Earned, type GuildView, type Item, type Job, type Me, type Params, type Player, type Shop, type SupplierInfo, type SwingTiming, type TownEventView, type TownView, type WeekResult } from './types';
export type { Params };
import { Join } from './Join';
import { AccountPanel, Earnings } from './Account';
import { Hud, QuestTracker } from './Hud';
import { nextStep } from './quest';
import { TownMap, SPOTS, W, H, type Place, type View } from './TownMap';
import { TabBar, type Tab } from './Tabs';
import { buzz, usePhone, useWide } from './phone';
import { PlaceDrawer, type Actions } from './Places';
import { TownLog } from './Panels';
import { FastForward } from './FastForward';
import { Guide, Leaders } from './Guide';
import { play, reducedMotion, startAmbience, startMusic } from './juice';
import { World3D } from './world/World3D';
import { Icon } from './Icon';
import { TownBooks, type BooksTab } from './Books';
import { Judge } from './Judge';
import { EventCard } from './Places';
import { ChestButton, CrierPop, CrierTicker, ShockBanner, useFeed, type ShockView, type ShopStyle } from './Crier';
import { toolFor } from './Market';

const savedGfx = (): '3d' | '2d' => {
  try {
    return localStorage.getItem('meridian.gfx') === '2d' ? '2d' : '3d';
  } catch {
    return '3d';
  }
};

export interface World {
  town: TownView;
  shops: Shop[];
  jobs: Job[];
  auctions: Auction[];
  weeks: WeekResult[];
  params: Params;
  clock: { genesisMs: number; dayMs: number; skewMs: number };
  agents: Record<string, AgentReport>;
  caravan: CaravanView | null;
  suppliers: Record<string, SupplierInfo>;
  guildViews: GuildView[];
  player?: Player;
  me?: Me;
  /** MERI's price in the MERI/wNEAR pool on Rhea, read by the server. */
  market?: { exchange: string; poolId: number; meri: string; wnear: string; nearPerMeri: number; meriInPool: number; nearInPool: number } | null;
  /** What the game-run residents did last; shown so players can see the town is busy. */
  townsfolk?: { id: string; name: string; did: string; at: number }[];
  /** This week's town event (from the server; older servers don't send one). */
  event?: TownEventView;
  /** A market shock running right now, if any. */
  shock?: ShockView | null;
  /** Deed holders' names and colours for their shops. */
  styles?: Record<string, ShopStyle>;
  /** Each guild's bounty this week. */
  bounties?: Record<string, { week: number; item: Item; qty: number; done: number; met: boolean; contributors: { who: string; qty: number }[]; pot: string; recipients: [string, string][] }>;
}

export interface LogLine {
  at: number;
  text: string;
  tone?: 'good' | 'bad';
}

export type Act = (label: string, run: () => Promise<string | void>) => Promise<void>;

interface Floater { id: number; x: number; y: number; text: string; kind: 'gain' | 'coin' | 'xp' | 'bad' }
interface Toast { id: number; text: string; kind: 'quest' | 'level' | 'bad' | 'good' }

/** Where a quest's marker points on the map. */
function questPlace(world: World): Place | null {
  const q = world.me?.current;
  if (!q) return null;
  if (q.place === 'grounds') {
    // The ground with the most left, scaled by what it sells for.
    const best = (['g:forest', 'g:mine', 'g:fields'] as const)
      .map((p, i) => ({ p, v: world.town.grounds[i] * Math.max(0, ...world.shops.map(s => Number(s.bid[i]))) }))
      .sort((a, b) => b.v - a.v)[0];
    return best.p;
  }
  if (q.place === 'square') {
    // The shop paying most, relative to reference, for something in the player's pack.
    const items = world.player?.items ?? [];
    const best = world.shops
      .flatMap(s => [0, 1, 2].filter(i => items[i] > 0).map(i => ({ s, v: Number(s.bid[i]) / Number(world.params.base[i]) })))
      .sort((a, b) => b.v - a.v)[0];
    return best ? (`s:${best.s.shop.id}` as Place) : 's:mine';
  }
  if (q.place === 'baker') return 's:baker';
  return q.place as Place;
}

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [prev, setPrev] = useState<World | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [place, setPlace] = useState<Place | null>(null);
  const [here, setHere] = useState<Place | null>(null);
  const [modal, setModal] = useState<'guide' | 'leaders' | 'ff' | 'account' | 'earnings' | 'books' | null>(null);
  const [booksTab, setBooksTab] = useState<BooksTab>('books');
  const openBooks = (t: BooksTab = 'books') => { setBooksTab(t); setModal('books'); };
  // Looking around before picking a name: the live town, read-only.
  const [guest, setGuest] = useState(false);
  const feed = useFeed();
  // Wide screens: the map fills the window; the log opens on demand.
  const wide = useWide();
  const [logOpen, setLogOpen] = useState(false);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const phone = usePhone();
  const immersive = wide && !phone;
  const [mapView, setMapView] = useState<View | null>(null);
  const nextId = useRef(1);
  const purseRef = useRef<HTMLDivElement | null>(null);
  const worldRef = useRef<World | null>(null);
  worldRef.current = world;
  const [gfx, setGfx] = useState<'3d' | '2d'>(savedGfx);
  const switchGfx = (g: '3d' | '2d') => {
    setGfx(g);
    try {
      localStorage.setItem('meridian.gfx', g);
    } catch {}
  };

  useEffect(() => {
    loadConfig().then(c => {
      setConfig(c);
      setAccount(me());
    });
  }, []);

  const refresh = useCallback(async (fresh = false) => {
    const w = await getJSON<Omit<World, 'clock' | 'player' | 'me'> & { clock: [number, number, number]; readAt: number }>('/api/world');
    const acc = me();
    const [player, mine] = acc
      ? await Promise.all([
          getJSON<Player>(`/api/player?account=${encodeURIComponent(acc)}${fresh ? '&fresh=1' : ''}`),
          api<Me>('/api/me').catch(() => undefined),
        ])
      : [undefined, undefined];
    // The snapshot's clock was read at w.readAt; use it to estimate chain time locally.
    const skewMs = w.readAt - w.clock[2];
    setWorld(prevWorld => {
      setPrev(prevWorld);
      return { ...w, clock: { genesisMs: w.clock[0], dayMs: w.clock[1], skewMs }, player, me: mine };
    });
  }, []);

  // Ambience starts with the first click (browsers only allow sound after a gesture).
  useEffect(() => {
    const night = () => {
      const w = worldRef.current;
      if (!w) return 0;
      const forced = { day: 0, dusk: 0, night: 1 }[new URLSearchParams(location.search).get('time') ?? ''];
      if (forced !== undefined) return forced;
      const { genesisMs, dayMs, skewMs } = w.clock;
      const into = (((Date.now() - skewMs - genesisMs) % dayMs) + dayMs) % dayMs / dayMs;
      return into < 0.7 ? 0 : into < 0.85 ? (into - 0.7) / 0.15 : 1;
    };
    const begin = () => {
      startAmbience(night);
      startMusic(night);
      play('swing'); // wakes the audio context on this gesture; quiet thunk as a welcome
    };
    window.addEventListener('pointerdown', begin, { once: true });
    return () => window.removeEventListener('pointerdown', begin);
  }, []);

  useEffect(() => {
    if (!config) return;
    refresh().catch(() => {}); // the server may still be reading the town; the next poll retries
    const t = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [config, account, refresh]);

  const say = (text: string, tone?: LogLine['tone']) => setLog(l => [{ at: Date.now(), text, tone }, ...l].slice(0, 40));

  /** A number that rises from a spot on the map and fades. */
  const float = (at: Place | null, text: string, kind: Floater['kind']) => {
    const spot = at ? SPOTS[at] : null;
    const id = nextId.current++;
    // On the 3D island gains rise from the middle of the view; on the 2D map, from the place.
    const x = gfx === '3d' ? W / 2 + ((id % 5) - 2) * 40 : spot ? spot.x : W - 60;
    const y = gfx === '3d' ? H * 0.42 : spot ? spot.y - 30 : 20;
    setFloaters(f => [...f, { id, x, y, text, kind }]);
    setTimeout(() => setFloaters(f => f.filter(x => x.id !== id)), reducedMotion() ? 1200 : 1600);
  };

  const toast = (text: string, kind: Toast['kind']) => {
    const id = nextId.current++;
    setToasts(t => [...t, { id, text, kind }]);
    // A new result replaces an older one of the same kind, so quick actions don't stack up.
    setToasts(t => (kind === 'good' ? t.filter(x => x.kind !== 'good' || x.id === id) : t));
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'good' ? 2600 : kind === 'quest' ? 3200 : 4500);
  };

  /** Celebrate what the server says an action earned. */
  const celebrate = (e: Earned | undefined, at: Place | null) => {
    if (!e) return;
    if (e.xp) float(at, `+${e.xp} XP`, 'xp');
    for (const q of e.quests ?? []) {
      toast(`Quest complete: ${q}`, 'quest');
      play('quest');
    }
    for (const m of e.marks ?? []) toast(`New mark: ${m}`, 'quest');
    if (e.record) {
      toast(`Town record! ${e.record}`, 'level');
      play('level');
    }
    if (e.levelUp) {
      const newTitle = e.levelUp.title !== world?.me?.title;
      toast(newTitle ? `Level ${e.levelUp.level}! You are now a ${e.levelUp.title}.` : `Level ${e.levelUp.level}!`, 'level');
      play('level');
    }
  };

  /** Tell the server about a transaction so it can award XP once it's confirmed on chain. */
  const report = (hash: string, at: Place | null) =>
    api<Earned>('/api/report', { txHash: hash }).then(e => celebrate(e, at)).catch(() => {});

  const act: Act = async (label, run) => {
    if (busy) return;
    setBusy(label);
    try {
      const msg = await run();
      if (msg) {
        say(msg, 'good');
        toast(msg, 'good');
        buzz(12);
      }
      // The action is done once run() returns; a failed refresh afterwards isn't the action failing,
      // and the regular poll picks the new state up a few seconds later.
      await refresh(true).catch(() => {});
    } catch (e) {
      const why = e instanceof Error ? e.message : String(e);
      say(`${label}: ${why}`, 'bad');
      toast(why, 'bad');
      play('error');
      buzz([30, 60, 30]);
    } finally {
      setBusy(null);
    }
  };

  if (!config) return <div className="loading">Opening the town gates…</div>;
  if (location.pathname.replace(/\/+$/, '') === '/judge') {
    return <Judge config={config} world={world} account={account} onJoined={id => { setAccount(id); refresh(true).catch(() => {}); }} refresh={() => refresh(true)} />;
  }
  if (!account && guest && world) {
    return <GuestTown world={world} gfx={gfx} phone={phone} onGfx={() => switchGfx(gfx === '3d' ? '2d' : '3d')} onPlay={() => setGuest(false)} onBooks={openBooks} books={modal === 'books' ? (
      <TownBooks world={world} account={null} explorer={explorerFor(config.network)} town={config.town} start={booksTab} feed={feed} onClose={() => setModal(null)} />
    ) : null} />;
  }
  if (!account) {
    return (
      <Join onLookAround={() => setGuest(true)} onJoined={(id, isNew) => {
        setAccount(id);
        if (isNew) setModal('guide');
        say(isNew ? `Welcome to Meridian, ${id.split('.')[0]}. Follow the quest scroll to get started.` : `Welcome back, ${id.split('.')[0]}.`, 'good');
      }} />
    );
  }
  if (!world) return <div className="loading">Reading the market…</div>;

  const open = (p: Place) => {
    setPlace(p);
    setHere(p);
  };

  const actions: Actions = {
    gather: (ground, timing = 'ok') => {
      const p = `g:${ground}` as Place;
      play('swing');
      buzz(timing === 'perfect' ? [10, 40, 10] : 8);
      if (timing !== 'ok') float(p, timing === 'perfect' ? 'Perfect!' : 'Good', 'xp');
      return act('Gather', async () => {
        const tool = toolFor(world, ({ forest: 'wood', mine: 'ore', fields: 'wheat' } as Record<string, Item>)[ground]);
        const r = await api<{ item: Item; gathered: number; wanted: number; bonusXp?: number; perfectRun?: number } & Earned>('/api/gather', { ground, swings: config.rules.maxSwingsPerRequest, timing, tool: tool?.token_id });
        if (r.gathered) float(p, `+${r.gathered} ${r.item}`, 'gain');
        else float(p, 'bare!', 'bad');
        if ((r.perfectRun ?? 0) >= 3) toast(`${r.perfectRun} perfect swings in a row!`, 'quest');
        celebrate(r, p);
        return r.gathered
          ? `You gathered ${r.gathered} ${r.item}${r.gathered < r.wanted ? '. The ground is nearly bare' : ''}.`
          : `The ground is bare. Try another one.`;
      });
    },
    sell: (shop, item, qty) =>
      act('Sell', async () => {
        const cap = await view<number>('sell_capacity', { shop_id: shop.shop.id, item });
        const n = Math.min(qty, cap, 100); // ~0.2 Tgas per unit; 100 fits the gas below
        if (n < 1) throw new Error(`${shop.shop.name} won't take any more ${item}`);
        const quote = BigInt(await view<string>('quote_sell', { shop_id: shop.shop.id, item, quantity: n }));
        const { value, hash } = await call<string>('sell', { shop_id: shop.shop.id, item, quantity: n, min_total: String((quote * 97n) / 100n) }, 40);
        play('coin');
        float(`s:${shop.shop.id}`, `+${fmt(value)} MERI`, 'coin');
        report(hash, `s:${shop.shop.id}`);
        return `Sold ${n} ${item} to ${shop.shop.name} for ${fmt(value)} MERI.`;
      }),
    buy: (shop, item, qty) =>
      act('Buy', async () => {
        const quote = BigInt(await view<string>('quote_buy', { shop_id: shop.shop.id, item, quantity: qty }));
        const { value } = await call<string>('buy', { shop_id: shop.shop.id, item, quantity: qty, max_total: String((quote * 103n) / 100n) }, 40);
        play('coin');
        float(`s:${shop.shop.id}`, `+${qty} ${item}`, 'gain');
        return `Bought ${qty === 1 && item === 'bread' ? 'a loaf' : `${qty} ${item}`} from ${shop.shop.name} for ${fmt(value)} MERI.`;
      }),
    use: item =>
      act(item === 'bread' ? 'Eat' : 'Equip', async () => {
        const { hash } = await call('use_item', { item, quantity: 1 });
        const r = await api<{ stamina: number; toolUses: number } & Earned>('/api/use', { txHash: hash });
        play(item === 'bread' ? 'eat' : 'build');
        float('cottage', item === 'bread' ? '+25 stamina' : 'Double yield', 'gain');
        celebrate(r, 'cottage');
        return item === 'bread' ? `You eat the loaf. Stamina is back to ${Math.round(r.stamina)}.` : `Tool in hand: ${r.toolUses} swings at double yield.`;
      }),
    build: item =>
      act('Build', async () => {
        const { hash } = await call('use_item', { item, quantity: 1 });
        const r = await api<{ built: number; cottage: { level: number } } & Earned>('/api/use', { txHash: hash, purpose: 'cottage' });
        play('build');
        float('cottage', r.built ? `Cottage level ${r.cottage.level}` : `+1 ${item}`, 'gain');
        celebrate(r, 'cottage');
        return r.built ? `Your cottage is now level ${r.cottage.level}.` : `You add a ${item === 'tool' ? 'tool' : 'loaf'} to the cottage.`;
      }),
    deliver: (job, qty) =>
      act('Deliver', async () => {
        const { value, hash } = await call<string>('deliver', { job_id: job.id, quantity: qty });
        play('coin');
        float('board', `+${fmt(value)} MERI`, 'coin');
        report(hash, 'board');
        return `Delivered ${qty} ${job.item} and got ${fmt(value)} MERI from escrow.`;
      }),
    appoint: (shopId, agent) =>
      act('Appoint', async () => {
        await call('set_agent', { shop_id: shopId, agent }, 30);
        return agent ? `${agent} now runs your ${world.shops.find(x => x.shop.id === shopId)?.shop.name ?? 'shop'}.` : 'Your shop has no agent now.';
      }),
    bid: (shopId, amountMicro) =>
      act('Bid', async () => {
        const { hash } = await call('bid_for_deed', { shop_id: shopId, amount: String(amountMicro) });
        play('bid');
        float('auction', 'Top bid!', 'gain');
        report(hash, 'auction');
        return `You lead the auction for ${shopId} at ${fmt(amountMicro)} MERI.`;
      }),
    claim: () =>
      act('Claim', async () => {
        const { value, hash } = await call<string>('claim_festival', {});
        play('level');
        float('festival', `+${fmt(value ?? 0)} MERI`, 'coin');
        report(hash, 'festival');
        return `You claimed your Festival share: ${fmt(value ?? 0)} MERI.`;
      }),
  };

  const step = nextStep(world);
  const qp = step?.place ?? questPlace(world);

  // A gain rises from its place; on a phone's zoomed map, from where that place is in view.
  const floatAt = (f: Floater) => {
    const v = gfx === '2d' && phone && mapView ? mapView : { x: 0, y: 0, w: W, h: H };
    return { left: `${((f.x - v.x) / v.w) * 100}%`, top: `${((f.y - v.y) / v.h) * 100}%` };
  };

  const tab: Tab | null = modal === 'earnings' ? 'ledger' : place === 'cottage' ? 'pack' : place && place === qp ? 'quest' : place ? null : 'town';
  const onTab = (t: Tab) => {
    if (t === 'town') { setPlace(null); setModal(null); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (t === 'quest') { setModal(null); if (qp) open(qp); }
    else if (t === 'pack') { setModal(null); open('cottage'); }
    else setModal('earnings');
  };

  return (
    <div className={`game ${phone ? 'phone' : ''} ${immersive ? 'immersive' : ''} ${logOpen ? 'log-open' : ''}`}>
      <Hud world={world} account={account} purseRef={purseRef}
        onAccount={() => setModal('account')} onEarnings={() => setModal('earnings')}
        onGuide={() => setModal('guide')} onLeaders={() => setModal('leaders')} onFestival={() => open('festival')} onBooks={() => openBooks()}
        gfx={gfx} onGfx={() => switchGfx(gfx === '3d' ? '2d' : '3d')} />
      <main className={`stage ${place ? 'with-drawer' : ''}`}>
        <div className={`map-wrap ${gfx === '2d' ? 'flat' : ''}`}>
          {gfx === '3d'
            ? <World3D world={world} onOpen={open} selected={place} questPlace={qp} account={account} working={busy === 'Gather'} onFail={() => switchGfx('2d')} />
            : <TownMap world={world} onOpen={open} selected={place} questPlace={qp} here={here} phone={phone} onView={setMapView} />}
          <div className="floaters" aria-hidden>
            {floaters.map(f => (
              <span key={f.id} className={`floater ${f.kind}`} style={floatAt(f)}>{f.text}</span>
            ))}
          </div>
          <QuestTracker world={world} step={step} onGo={() => qp && open(qp)} />
          {world.shock && <div className="map-shock"><ShockBanner shock={world.shock} /></div>}
          <div className="map-tools">
            <ChestButton world={world} act={act} onOpened={r => {
              float('cottage', `+${r.stamina} stamina`, 'gain');
              play('level');
              celebrate({ xp: r.xp, levelUp: r.levelUp }, null);
            }} />
            <button className="log-toggle" aria-expanded={logOpen} onClick={() => setLogOpen(o => !o)} title="Your trades, the town crier and who’s about">
              <Icon name="scroll" /> Log{log.length > 0 && !logOpen ? <span className="dot" aria-hidden /> : null}
            </button>
            <button onClick={() => setModal('ff')} title="Replay the next market week in a minute"><Icon name="forward" /> Fast-forward</button>
          </div>
          {immersive && !logOpen && <CrierPop feed={feed} onOpen={() => openBooks('crier')} />}
        </div>
        <div className="ticker" aria-hidden={immersive && !logOpen}>
          {immersive && (
            <header className="log-head">
              <strong>Town log</strong>
              <button className="link" onClick={() => setLogOpen(false)} aria-label="Close the log"><Icon name="close" /></button>
            </header>
          )}
          <CrierTicker world={world} feed={feed} onOpen={() => openBooks('crier')} showShock={false} />
          <TownLog log={log} busy={busy} />
          {(world.townsfolk?.length ?? 0) > 0 && (
            <p className="around" title="Townsfolk are residents the game runs. They trade by the same rules as you.">
              <strong>Around town:</strong>{' '}
              {[...world.townsfolk!].sort((a, b) => b.at - a.at).slice(0, 3).map(t => `${t.name} ${t.did}`).join('. ')}.
            </p>
          )}
        </div>
        {place && <div className="sheet-backdrop" onClick={() => setPlace(null)} aria-hidden />}
        {place && (
          <PlaceDrawer place={place} world={world} config={config} account={account} busy={busy} act={act} actions={actions}
            prevShops={prev?.shops} onClose={() => setPlace(null)} onFastForward={() => setModal('ff')} onGo={open} />
        )}
      </main>
      {phone && (
        <TabBar active={tab} onTab={onTab} gfx={gfx} onGfx={() => switchGfx(gfx === '3d' ? '2d' : '3d')}
          onGuide={() => setModal('guide')} onLeaders={() => setModal('leaders')} onAccount={() => setModal('account')} onFastForward={() => setModal('ff')}
          onBooks={() => openBooks()} onMarks={() => openBooks('marks')} />
      )}
      <div className="toasts" aria-live="assertive">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
      </div>
      {modal === 'books' && <TownBooks world={world} account={account} explorer={explorerFor(config.network)} town={config.town} start={booksTab} feed={feed} onClose={() => setModal(null)} />}
      {modal === 'ff' && <FastForward world={world} onClose={() => setModal(null)} />}
      {modal === 'guide' && <Guide onClose={() => setModal(null)} />}
      {modal === 'leaders' && <Leaders account={account} world={world} onClose={() => setModal(null)} act={act} busy={busy} />}
      {modal === 'account' && <AccountPanel network={config.network} onClose={() => setModal(null)} onSignOut={() => { signOut(); setModal(null); setAccount(null); }} />}
      {modal === 'earnings' && <Earnings world={world} account={account} network={config.network} onClose={() => setModal(null)} act={act} busy={busy} />}
    </div>
  );
}

export const itemIndex = (item: Item) => ITEMS.indexOf(item);
export const explorerFor = (network: string) => (network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io');

/** The live town, read-only, for someone who hasn't picked a name yet. */
function GuestTown({ world, gfx, phone, onGfx, onPlay, onBooks, books }: {
  world: World;
  gfx: '3d' | '2d';
  phone: boolean;
  onGfx: () => void;
  onPlay: () => void;
  onBooks: (t?: BooksTab) => void;
  books: React.ReactNode;
}) {
  const [peek, setPeek] = useState<Place | null>(null);
  const shop = peek?.startsWith('s:') ? world.shops.find(s => s.shop.id === peek.slice(2)) : null;
  const said = shop ? world.agents?.[shop.shop.id] : null;
  const counted = Number(world.town.week_counted) / 1e6;
  const target = Number(world.town.week_target) / 1e6;
  return (
    <div className={`game guest ${phone ? 'phone' : ''}`}>
      <header className="guest-bar">
        <a className="gate-back" href="/">Meridian</a>
        <span className="muted">You’re looking around the live town. Day {world.town.day + 1}, {counted.toFixed(0)} of {target.toFixed(0)} MERI traded toward this week’s Festival.</span>
        <div className="row">
          <button className="small" onClick={() => onBooks('books')}>Town books</button>
          <button className="small" onClick={onGfx}>{gfx === '3d' ? 'Flat map' : '3D island'}</button>
          <button className="small primary" onClick={onPlay}>Pick a name and play</button>
        </div>
      </header>
      <main className="stage">
        <div className={`map-wrap ${gfx === '2d' ? 'flat' : ''}`}>
          {gfx === '3d'
            ? <World3D world={world} onOpen={setPeek} selected={peek} questPlace={null} account="visitor" working={false} onFail={onGfx} />
            : <TownMap world={world} onOpen={setPeek} selected={peek} questPlace={null} here={peek} phone={phone} />}
          {peek && (
            <aside className="guest-peek" aria-live="polite">
              <header>
                <strong>{SPOTS[peek]?.label}</strong>
                <button className="link" onClick={() => setPeek(null)} aria-label="Close"><Icon name="close" /></button>
              </header>
              {shop ? (
                <>
                  <p className="muted">{shop.shop.open ? `Run by ${shop.shop.agent ? 'an AI shopkeeper with its own NEAR account' : 'nobody'}. Till: ${fmt(shop.cash, 0)} MERI.` : 'Closed: its deed is up for auction.'}</p>
                  {said && <blockquote>“{said.say}”<footer>{said.mode === 'llm' ? 'thinking with NEAR AI' : 'by its strategy rules'}</footer></blockquote>}
                  <p className="muted">
                    {ITEMS.flatMap((it, i) => [
                      shop.shop.buys.includes(it) ? (BigInt(shop.bid[i]) > 0n ? `pays ${fmt(shop.bid[i])} for ${it}` : `full of ${it}`) : null,
                      shop.shop.sells.includes(it) && shop.stock[i] > 0 ? `sells ${it} at ${fmt(shop.ask[i])}` : null,
                    ]).filter(Boolean).join(' · ')}
                  </p>
                </>
              ) : (
                <p className="muted">{peek.startsWith('g:') ? 'Anyone can gather here. Every swing mints real goods into your NEAR account.' : peek === 'festival' ? 'Where the town celebrates when it hits its weekly target.' : 'Pick a name to step inside.'}</p>
              )}
              <button className="primary small" onClick={onPlay}>Pick a name to trade here</button>
            </aside>
          )}
        </div>
        <div className="ticker">
          {world.event && <EventCard world={world} compact />}
          {(world.townsfolk?.length ?? 0) > 0 && (
            <p className="around"><strong>Around town:</strong> {[...world.townsfolk!].sort((a, b) => b.at - a.at).slice(0, 3).map(t => `${t.name} ${t.did}`).join('. ')}.</p>
          )}
        </div>
      </main>
      {books}
    </div>
  );
}
