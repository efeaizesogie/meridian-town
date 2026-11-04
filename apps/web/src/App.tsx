import { useCallback, useEffect, useRef, useState } from 'react';
import { api, call, getJSON, loadConfig, me, signOut, view, type Config } from './near';
import { ITEMS, fmt, type AgentReport, type Auction, type CaravanView, type Earned, type GuildView, type Item, type Job, type Me, type Params, type Player, type Shop, type SupplierInfo, type TownView, type WeekResult } from './types';
export type { Params };
import { Join } from './Join';
import { Hud, QuestTracker } from './Hud';
import { TownMap, SPOTS, W, H, type Place } from './TownMap';
import { PlaceDrawer, type Actions } from './Places';
import { TownLog } from './Panels';
import { FastForward } from './FastForward';
import { Guide, Leaders } from './Guide';
import { play, reducedMotion, startAmbience } from './juice';
import { World3D } from './world/World3D';

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
}

export interface LogLine {
  at: number;
  text: string;
  tone?: 'good' | 'bad';
}

export type Act = (label: string, run: () => Promise<string | void>) => Promise<void>;

interface Floater { id: number; x: number; y: number; text: string; kind: 'gain' | 'coin' | 'xp' | 'bad' }
interface Toast { id: number; text: string; kind: 'quest' | 'level' }

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
  const [modal, setModal] = useState<'guide' | 'leaders' | 'ff' | null>(null);
  const [floaters, setFloaters] = useState<Floater[]>([]);
  const [toasts, setToasts] = useState<Toast[]>([]);
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
    const begin = () => {
      startAmbience(() => {
        const w = worldRef.current;
        if (!w) return 0;
        const { genesisMs, dayMs, skewMs } = w.clock;
        const into = (((Date.now() - skewMs - genesisMs) % dayMs) + dayMs) % dayMs / dayMs;
        return into < 0.7 ? 0 : into < 0.85 ? (into - 0.7) / 0.15 : 1;
      });
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
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'level' ? 4000 : 3200);
  };

  /** Celebrate what the server says an action earned. */
  const celebrate = (e: Earned | undefined, at: Place | null) => {
    if (!e) return;
    if (e.xp) float(at, `+${e.xp} XP`, 'xp');
    for (const q of e.quests ?? []) {
      toast(`Quest complete: ${q}`, 'quest');
      play('quest');
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
      if (msg) say(msg, 'good');
      await refresh(true);
    } catch (e) {
      say(`${label}: ${e instanceof Error ? e.message : e}`, 'bad');
      play('error');
    } finally {
      setBusy(null);
    }
  };

  if (!config) return <div className="loading">Opening the town gates…</div>;
  if (!account) {
    return (
      <Join onJoined={id => {
        setAccount(id);
        setModal('guide');
        say(`Welcome to Meridian, ${id.split('.')[0]}. Follow the quest scroll to get started.`, 'good');
      }} />
    );
  }
  if (!world) return <div className="loading">Reading the market…</div>;

  const open = (p: Place) => {
    setPlace(p);
    setHere(p);
  };

  const actions: Actions = {
    gather: ground => {
      const p = `g:${ground}` as Place;
      play('swing');
      return act('Gather', async () => {
        const r = await api<{ item: Item; gathered: number; wanted: number } & Earned>('/api/gather', { ground, swings: config.rules.maxSwingsPerRequest });
        if (r.gathered) float(p, `+${r.gathered} ${r.item}`, 'gain');
        else float(p, 'bare!', 'bad');
        celebrate(r, p);
        return r.gathered
          ? `+${r.gathered} ${r.item}${r.gathered < r.wanted ? ' (the ground is nearly bare)' : ''}`
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
        float(`s:${shop.shop.id}`, `+${fmt(value)} 🪙`, 'coin');
        report(hash, `s:${shop.shop.id}`);
        return `Sold ${n} ${item} to ${shop.shop.name} for ${fmt(value)} MERI`;
      }),
    buy: (shop, item, qty) =>
      act('Buy', async () => {
        const quote = BigInt(await view<string>('quote_buy', { shop_id: shop.shop.id, item, quantity: qty }));
        const { value } = await call<string>('buy', { shop_id: shop.shop.id, item, quantity: qty, max_total: String((quote * 103n) / 100n) }, 40);
        play('coin');
        float(`s:${shop.shop.id}`, `+${qty} ${item}`, 'gain');
        return `Bought ${qty} ${item} from ${shop.shop.name} for ${fmt(value)} MERI`;
      }),
    use: item =>
      act(item === 'bread' ? 'Eat' : 'Equip', async () => {
        const { hash } = await call('use_item', { item, quantity: 1 });
        const r = await api<{ stamina: number; toolUses: number } & Earned>('/api/use', { txHash: hash });
        play(item === 'bread' ? 'eat' : 'build');
        float('cottage', item === 'bread' ? '+25 ⚡' : '🔨 ×2', 'gain');
        celebrate(r, 'cottage');
        return item === 'bread' ? `You eat. Stamina ${Math.round(r.stamina)}.` : `Tool in hand: ${r.toolUses} swings at double yield.`;
      }),
    build: item =>
      act('Build', async () => {
        const { hash } = await call('use_item', { item, quantity: 1 });
        const r = await api<{ built: number; cottage: { level: number } } & Earned>('/api/use', { txHash: hash, purpose: 'cottage' });
        play('build');
        float('cottage', r.built ? `🏠 Level ${r.cottage.level}!` : `+1 ${item}`, 'gain');
        celebrate(r, 'cottage');
        return r.built ? `Your cottage is now level ${r.cottage.level}.` : `You add a ${item === 'tool' ? 'tool' : 'loaf'} to the cottage.`;
      }),
    deliver: (job, qty) =>
      act('Deliver', async () => {
        const { value, hash } = await call<string>('deliver', { job_id: job.id, quantity: qty });
        play('coin');
        float('board', `+${fmt(value)} 🪙`, 'coin');
        report(hash, 'board');
        return `Delivered ${qty} ${job.item}: paid ${fmt(value)} MERI from escrow`;
      }),
    bid: (shopId, amountMicro) =>
      act('Bid', async () => {
        const { hash } = await call('bid_for_deed', { shop_id: shopId, amount: String(amountMicro) });
        play('bid');
        float('auction', 'Top bid!', 'gain');
        report(hash, 'auction');
        return `You lead the auction for ${shopId} at ${fmt(amountMicro)} MERI`;
      }),
    claim: () =>
      act('Claim', async () => {
        const { value, hash } = await call<string>('claim_festival', {});
        play('level');
        float('festival', `+${fmt(value ?? 0)} 🪙`, 'coin');
        report(hash, 'festival');
        return `Festival share: ${fmt(value ?? 0)} MERI`;
      }),
  };

  const qp = questPlace(world);

  return (
    <div className="game">
      <Hud world={world} account={account} purseRef={purseRef}
        onSignOut={() => { signOut(); setAccount(null); }}
        onGuide={() => setModal('guide')} onLeaders={() => setModal('leaders')} onFestival={() => open('festival')}
        gfx={gfx} onGfx={() => switchGfx(gfx === '3d' ? '2d' : '3d')} />
      <main className={`stage ${place ? 'with-drawer' : ''}`}>
        <div className="map-wrap">
          {gfx === '3d'
            ? <World3D world={world} onOpen={open} selected={place} questPlace={qp} account={account} onFail={() => switchGfx('2d')} />
            : <TownMap world={world} onOpen={open} selected={place} questPlace={qp} here={here} />}
          <div className="floaters" aria-hidden>
            {floaters.map(f => (
              <span key={f.id} className={`floater ${f.kind}`} style={{ left: `${(f.x / W) * 100}%`, top: `${(f.y / H) * 100}%` }}>{f.text}</span>
            ))}
          </div>
          <QuestTracker world={world} onGo={() => qp && open(qp)} />
          <div className="map-tools">
            <button onClick={() => setModal('ff')} title="Replay the next market week in a minute">⏩ Fast-forward</button>
          </div>
        </div>
        <div className="ticker"><TownLog log={log} busy={busy} /></div>
        {place && (
          <PlaceDrawer place={place} world={world} config={config} account={account} busy={busy} act={act} actions={actions}
            prevShops={prev?.shops} onClose={() => setPlace(null)} onFastForward={() => setModal('ff')} onGo={open} />
        )}
      </main>
      <div className="toasts" aria-live="assertive">
        {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.kind === 'level' ? '⭐ ' : '📜 '}{t.text}</div>)}
      </div>
      {modal === 'ff' && <FastForward world={world} onClose={() => setModal(null)} />}
      {modal === 'guide' && <Guide onClose={() => setModal(null)} />}
      {modal === 'leaders' && <Leaders account={account} onClose={() => setModal(null)} />}
    </div>
  );
}

export const itemIndex = (item: Item) => ITEMS.indexOf(item);
