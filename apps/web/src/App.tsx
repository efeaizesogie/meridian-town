import { useCallback, useEffect, useState } from 'react';
import { api, call, getJSON, loadConfig, me, signOut, view, type Config } from './near';
import { ITEMS, fmt, type AgentReport, type Auction, type CaravanView, type GuildView, type SupplierInfo, type Item, type Job, type Params, type Player, type Shop, type TownView, type WeekResult } from './types';
export type { Params };
import { Join } from './Join';
import { TopBar } from './TopBar';
import { Grounds } from './Grounds';
import { ShopCard } from './ShopCard';
import { Inventory, NoticeBoard, Deeds, TownLog } from './Panels';
import { FastForward } from './FastForward';
import { Caravan } from './Caravan';
import { GuildHall } from './Guilds';

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
  me?: { stamina: number; toolUses: number };
}

export interface LogLine {
  at: number;
  text: string;
  tone?: 'good' | 'bad';
}

export type Act = (label: string, run: () => Promise<string | void>) => Promise<void>;

export default function App() {
  const [config, setConfig] = useState<Config | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [world, setWorld] = useState<World | null>(null);
  const [prev, setPrev] = useState<World | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<LogLine[]>([]);
  const [fastForward, setFastForward] = useState(false);

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
          api<{ stamina: number; toolUses: number }>('/api/me').catch(() => undefined),
        ])
      : [undefined, undefined];
    // The snapshot's clock was read at w.readAt; use it to estimate chain time locally.
    const skewMs = w.readAt - w.clock[2];
    setWorld(prevWorld => {
      setPrev(prevWorld);
      return { ...w, clock: { genesisMs: w.clock[0], dayMs: w.clock[1], skewMs }, player, me: mine };
    });
  }, []);

  useEffect(() => {
    if (!config) return;
    refresh();
    const t = setInterval(() => refresh().catch(() => {}), 3000);
    return () => clearInterval(t);
  }, [config, account, refresh]);

  const say = (text: string, tone?: LogLine['tone']) => setLog(l => [{ at: Date.now(), text, tone }, ...l].slice(0, 40));

  const act: Act = async (label, run) => {
    if (busy) return;
    setBusy(label);
    try {
      const msg = await run();
      if (msg) say(msg, 'good');
      await refresh(true);
    } catch (e) {
      say(`${label}: ${e instanceof Error ? e.message : e}`, 'bad');
    } finally {
      setBusy(null);
    }
  };

  if (!config) return <div className="loading">Opening the town gates…</div>;
  if (!account) return <Join onJoined={id => { setAccount(id); say(`Welcome to Meridian, ${id.split('.')[0]}. Head to the Mine, the Forest or the Fields and start gathering.`, 'good'); }} />;
  if (!world) return <div className="loading">Reading the market…</div>;

  const actions = {
    gather: (ground: string) =>
      act('Gather', async () => {
        const r = await api<{ item: Item; gathered: number; wanted: number }>('/api/gather', { ground, swings: config.rules.maxSwingsPerRequest });
        return r.gathered
          ? `+${r.gathered} ${r.item}${r.gathered < r.wanted ? ' (the ground is nearly bare)' : ''}`
          : `The ${ground} is bare. Try another ground.`;
      }),
    sell: (shop: Shop, item: Item, qty: number) =>
      act('Sell', async () => {
        const cap = await view<number>('sell_capacity', { shop_id: shop.shop.id, item });
        const n = Math.min(qty, cap, 100); // ~0.2 Tgas per unit; 100 fits the gas below
        if (n < 1) throw new Error(`${shop.shop.name} won't take any more ${item}`);
        const quote = BigInt(await view<string>('quote_sell', { shop_id: shop.shop.id, item, quantity: n }));
        const { value } = await call<string>('sell', { shop_id: shop.shop.id, item, quantity: n, min_total: String((quote * 97n) / 100n) }, 40);
        return `Sold ${n} ${item} to ${shop.shop.name} for ${fmt(value)} MERI`;
      }),
    buy: (shop: Shop, item: Item, qty: number) =>
      act('Buy', async () => {
        const quote = BigInt(await view<string>('quote_buy', { shop_id: shop.shop.id, item, quantity: qty }));
        const { value } = await call<string>('buy', { shop_id: shop.shop.id, item, quantity: qty, max_total: String((quote * 103n) / 100n) }, 40);
        return `Bought ${qty} ${item} from ${shop.shop.name} for ${fmt(value)} MERI`;
      }),
    use: (item: 'bread' | 'tool') =>
      act(item === 'bread' ? 'Eat' : 'Equip', async () => {
        const { hash } = await call('use_item', { item, quantity: 1 });
        const r = await api<{ stamina: number; toolUses: number }>('/api/use', { txHash: hash });
        return item === 'bread' ? `You eat. Stamina ${Math.round(r.stamina)}.` : `Tool in hand: ${r.toolUses} swings at double yield.`;
      }),
    deliver: (job: Job, qty: number) =>
      act('Deliver', async () => {
        const { value } = await call<string>('deliver', { job_id: job.id, quantity: qty });
        return `Delivered ${qty} ${job.item}: paid ${fmt(value)} MERI from escrow`;
      }),
    bid: (shopId: string, amountMicro: bigint) =>
      act('Bid', async () => {
        await call('bid_for_deed', { shop_id: shopId, amount: String(amountMicro) });
        return `You lead the auction for ${shopId} at ${fmt(amountMicro)} MERI`;
      }),
    claim: () =>
      act('Claim', async () => {
        const { value } = await call<string>('claim_festival', {});
        return `Festival share: ${fmt(value ?? 0)} MERI`;
      }),
  };

  return (
    <div className="app">
      <TopBar world={world} account={account} onSignOut={() => { signOut(); setAccount(null); }} onClaim={actions.claim} />
      <main className="board">
        <section className="col left">
          <Grounds world={world} config={config} busy={busy} onGather={actions.gather} />
          <Inventory world={world} busy={busy} onUse={actions.use} />
        </section>
        <section className="col square">
          <div className="square-head">
            <h2 className="section-title">The market square</h2>
            <button onClick={() => setFastForward(true)} title="Replay the next market week in a minute, on a copy of the town">⏩ Fast-forward a week</button>
          </div>
          <div className="shops">
            {world.shops.map(s => (
              <ShopCard key={s.shop.id} shop={s} agent={world.agents?.[s.shop.id]} explorer={config.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io'} prev={prev?.shops.find(p => p.shop.id === s.shop.id)} params={world.params} player={world.player} busy={busy} onSell={actions.sell} onBuy={actions.buy} />
            ))}
          </div>
          <Caravan world={world} />
        </section>
        <section className="col right">
          <NoticeBoard world={world} busy={busy} onDeliver={actions.deliver} />
          <Deeds world={world} account={account} busy={busy} onBid={actions.bid} />
          <GuildHall world={world} account={account} busy={busy} act={act} town={config.town} />
          <TownLog log={log} busy={busy} />
        </section>
      </main>
      {fastForward && <FastForward world={world} onClose={() => setFastForward(false)} />}
    </div>
  );
}

export const itemIndex = (item: Item) => ITEMS.indexOf(item);
