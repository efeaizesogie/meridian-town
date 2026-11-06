// V4 in the game: shop coins (a bonding-curve coin per shop whose holders share its profit),
// the Festival prediction pool, the weekly tournament, burn-to-boost, tips, crafted tool NFTs
// and the player's on-chain collection (deeds, Festival badges, marks, tools).
// Everything here is a contract call signed in the browser; the server only reports on it.
import { useEffect, useState } from 'react';
import type { Act, World } from './App';
import { api, call, view } from './near';
import { KEEPERS, fmt, meri, short, type Earned, type Item } from './types';
import { Icon, type IconName } from './Icon';

// ---------- shapes the contract returns ----------

export interface ShopCoinView { shop_id: string; supply: number; reserve: string; next_price: string; dividends: string }
export interface HoldingView { shop_id: string; coins: number; claimable: string; value: string }
export interface ToolView { token_id: string; owner: string; kind: string; item: Item; uses_left: number }
export interface Pool { hit: string; miss: string; settled: boolean; outcome_hit: boolean; payout: string }
export interface PredictionView { week: number; open: boolean; pool: Pool; mine: { hit: string; miss: string } }
export interface Tourney { week: number; pot: string; entrants: number; leader: string | null; best: string; settled: boolean }
export interface Boost { who: string; kind: string; item: Item | null; text: string | null; burned: string; at_ns: number }

/** The V4 parts of the world and the player, when the contract has them. */
export interface V4World {
  shopCoins?: ShopCoinView[] | null;
  boosts?: Boost[] | null;
  prediction?: PredictionView | null;
  tournament?: [Tourney, string | null] | null;
  bells?: { item: string; until: number; who: string }[];
}
export interface V4Player {
  holdings?: HoldingView[] | null;
  tools?: ToolView[] | null;
  prediction?: PredictionView | null;
  tournament?: [Tourney, string | null] | null;
}

const MICRO = 1_000_000n;
const COIN_BASE = MICRO;
const COIN_STEP = MICRO / 50n;
const FEE_BPS = 250n;
export const curveCost = (s: number, n: number) => {
  const S = BigInt(s), N = BigInt(n);
  return N * COIN_BASE + COIN_STEP * (N * S + (N * (N > 0n ? N - 1n : 0n)) / 2n);
};
export const ticker = (shopId: string) => `$${(KEEPERS[shopId]?.keeper ?? shopId).toUpperCase()}`;

/** Report a transaction so the server can award XP and tell the town crier. */
const report = (hash: string) => api<Earned>('/api/report', { txHash: hash }).catch(() => null);

export const hasV4 = (world: World) => Array.isArray((world as World & V4World).shopCoins);

// ---------- shop coins ----------

export function ShopCoinPanel({ shopId, world, act, busy }: { shopId: string; world: World; act: Act; busy: string | null }) {
  const w = world as World & V4World;
  const c = w.shopCoins?.find(x => x.shop_id === shopId);
  const me = (world.player as V4Player | undefined)?.holdings?.find(h => h.shop_id === shopId);
  const [n, setN] = useState(5);
  if (!c) return null;
  const cost = curveCost(c.supply, n);
  const total = cost + (cost * FEE_BPS) / 10_000n;
  const t = ticker(shopId);
  const open = world.shops.find(s => s.shop.id === shopId)?.shop.open;
  return (
    <div className="coin-panel">
      <div className="coin-head">
        <span className="coin-badge" aria-hidden><Icon name="coin" size={22} /></span>
        <div>
          <strong>{t}</strong> <span className="muted">the {world.shops.find(s => s.shop.id === shopId)?.shop.name} coin</span>
          <div className="muted">Next coin {fmt(c.next_price)} MERI · {c.supply} in circulation · {fmt(c.dividends, 0)} MERI paid to holders</div>
        </div>
      </div>
      <p className="hint">Each coin costs a little more than the last (a bonding curve), and holders share 20% of the shop’s profit every day it does well. Every buy and sell burns 2.5% of MERI.</p>
      {me && me.coins > 0 && (
        <p className="coin-mine">You hold <strong>{me.coins} {t}</strong>, worth {fmt(me.value)} MERI if sold now{BigInt(me.claimable) > 0n ? <>, with <strong>{fmt(me.claimable)} MERI</strong> in dividends to collect</> : ''}.</p>
      )}
      <div className="row coin-row">
        <div className="seg" role="group" aria-label="How many coins">
          {[1, 5, 10, 25].map(k => <button key={k} className={n === k ? 'on' : ''} onClick={() => setN(k)}>{k}</button>)}
        </div>
        <button className="small primary" disabled={!!busy || !open} onClick={() => act('Buy coins', async () => {
          const { value, hash } = await call<string>('buy_shop_coin', { shop_id: shopId, coins: n, max_total: String((total * 103n) / 100n) }, 50);
          report(hash);
          return `You bought ${n} ${t} for ${fmt(value)} MERI.`;
        })}>Buy {n} for {fmt(total)}</button>
        {me && me.coins > 0 && (
          <button className="small" disabled={!!busy} onClick={() => act('Sell coins', async () => {
            const k = Math.min(n, me.coins);
            const { value, hash } = await call<string>('sell_shop_coin', { shop_id: shopId, coins: k, min_return: '0' }, 50);
            report(hash);
            return `You sold ${k} ${t} for ${fmt(value)} MERI.`;
          })}>Sell {Math.min(n, me.coins)}</button>
        )}
        {me && BigInt(me.claimable) > 0n && (
          <button className="small" disabled={!!busy} onClick={() => act('Collect', async () => {
            const { value, hash } = await call<string>('claim_coin_dividends', { shop_id: shopId }, 40);
            report(hash);
            return `You collected ${fmt(value)} MERI in ${t} dividends.`;
          })}>Collect dividends</button>
        )}
      </div>
    </div>
  );
}

/** Every shop coin at a glance, for the Town books. */
export function CoinBoard({ world }: { world: World }) {
  const w = world as World & V4World;
  if (!w.shopCoins) return null;
  return (
    <table className="books-table">
      <thead><tr><th>Coin</th><th className="num">Next price</th><th className="num">Supply</th><th className="num">Reserve</th><th className="num">Paid to holders</th></tr></thead>
      <tbody>
        {w.shopCoins.map(c => (
          <tr key={c.shop_id}>
            <td><strong>{ticker(c.shop_id)}</strong> <span className="muted">{world.shops.find(s => s.shop.id === c.shop_id)?.shop.name}</span></td>
            <td className="num">{fmt(c.next_price)}</td>
            <td className="num">{c.supply}</td>
            <td className="num">{fmt(c.reserve, 0)}</td>
            <td className="num">{fmt(c.dividends, 0)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------- the Festival stage: predictions, the tournament, boosts ----------

export function FestivalExtras({ world, act, busy }: { world: World; act: Act; busy: string | null }) {
  const w = world as World & V4World;
  const p = world.player as V4Player | undefined;
  const [stake, setStake] = useState('5');
  const [banner, setBanner] = useState('');
  const [bellItem, setBellItem] = useState<Item>('wheat');
  if (!w.prediction || !w.tournament) return null;
  const pred = p?.prediction ?? w.prediction;
  const pool = pred.pool;
  const hit = meri(pool.hit), miss = meri(pool.miss), total = hit + miss;
  const [tour, myEntry] = p?.tournament ?? w.tournament;
  const lastWeek = pred.week - 1;
  const coins = meri(world.player?.coins ?? 0);
  return (
    <div className="fest-extras">
      <section className="extra-card">
        <h3 className="with-icon"><Icon name="flag" /> Bet on the Festival</h3>
        <p className="hint">Stake MERI on whether the town hits this week’s target. Winners split the pot in proportion to their stake; 2% burns. Bets close two days before the week ends.</p>
        <div className="odds">
          <div className="odds-bar"><i style={{ width: `${total ? (hit / total) * 100 : 50}%` }} /></div>
          <div className="odds-labels"><span>Hit: {hit.toFixed(0)} MERI{total ? ` (pays ${(total * 0.98 / Math.max(hit, 0.01)).toFixed(2)}×)` : ''}</span><span>Miss: {miss.toFixed(0)} MERI{total ? ` (pays ${(total * 0.98 / Math.max(miss, 0.01)).toFixed(2)}×)` : ''}</span></div>
        </div>
        {(meri(pred.mine.hit) > 0 || meri(pred.mine.miss) > 0) && <p className="muted">Your stake: {meri(pred.mine.hit) > 0 ? `${fmt(pred.mine.hit)} on hit ` : ''}{meri(pred.mine.miss) > 0 ? `${fmt(pred.mine.miss)} on miss` : ''}</p>}
        {pred.open ? (
          <div className="row">
            <input className="small" inputMode="decimal" value={stake} onChange={e => setStake(e.target.value)} aria-label="MERI to stake" />
            {[true, false].map(h => (
              <button key={String(h)} className={`small ${h ? 'primary' : ''}`} disabled={!!busy || !(Number(stake) >= 1) || Number(stake) > coins} onClick={() => act('Bet', async () => {
                const { hash } = await call('predict', { hit: h, amount: String(Math.round(Number(stake) * 1e6)) }, 40);
                report(hash);
                return `You staked ${stake} MERI that the Festival will be ${h ? 'hit' : 'missed'}.`;
              })}>Bet it’s {h ? 'hit' : 'missed'}</button>
            ))}
          </div>
        ) : <p className="muted">Betting is closed for this week.</p>}
        {lastWeek >= 0 && (
          <button className="link" disabled={!!busy} onClick={() => act('Claim bet', async () => {
            const { value, hash } = await call<string>('claim_prediction', { week: lastWeek }, 40);
            report(hash);
            return BigInt(value ?? '0') > 0n ? `You won ${fmt(value)} MERI on last week’s Festival.` : 'Nothing to collect from last week’s bets.';
          })}>Collect last week’s winnings</button>
        )}
      </section>

      <section className="extra-card">
        <h3 className="with-icon"><Icon name="rosette" /> This week’s tournament</h3>
        <p className="hint">Enter for 5 MERI. Your biggest single sale this week is your score; the best score wins the pot (5% burns). No winner rolls the pot into next week.</p>
        <div className="tour-stats">
          <div><span className="muted">Pot</span><strong>{fmt(tour.pot)} MERI</strong></div>
          <div><span className="muted">Entrants</span><strong>{tour.entrants}</strong></div>
          <div><span className="muted">Leader</span><strong>{tour.leader ? `${short(tour.leader)}, ${fmt(tour.best)}` : 'nobody yet'}</strong></div>
        </div>
        {myEntry != null ? (
          <p className="muted">You’re in. Your best sale this week: <strong>{fmt(myEntry)} MERI</strong>.</p>
        ) : (
          <button className="small primary" disabled={!!busy || coins < 5} onClick={() => act('Enter', async () => {
            const { hash } = await call('enter_tournament', {}, 40);
            report(hash);
            return 'You’re in this week’s tournament. Make a big sale!';
          })}>Enter for 5 MERI</button>
        )}
      </section>

      <section className="extra-card">
        <h3 className="with-icon"><Icon name="bell" /> Burn to boost</h3>
        <p className="hint">Burn MERI for a moment the whole town sees. Burned coin is gone for good, so every boost makes the rest a little scarcer.</p>
        <div className="boost-grid">
          <div>
            <strong>Fireworks</strong> <span className="muted">5 MERI</span>
            <button className="small" disabled={!!busy || coins < 5} onClick={() => act('Boost', async () => {
              const { hash } = await call('burn_for_boost', { kind: 'fireworks' }, 40);
              report(hash);
              return 'Fireworks over the square! 5 MERI burned.';
            })}>Light them</button>
          </div>
          <div>
            <strong>Market bell</strong> <span className="muted">10 MERI · every shop pays 20% more for one good for an hour</span>
            <div className="row">
              <select value={bellItem} onChange={e => setBellItem(e.target.value as Item)} aria-label="Good">
                {(['wood', 'ore', 'wheat'] as const).map(i => <option key={i} value={i}>{i}</option>)}
              </select>
              <button className="small" disabled={!!busy || coins < 10} onClick={() => act('Boost', async () => {
                const { hash } = await call('burn_for_boost', { kind: 'bell', item: bellItem }, 40);
                report(hash);
                return `You rang the market bell for ${bellItem}. 10 MERI burned.`;
              })}>Ring it</button>
            </div>
          </div>
          <div>
            <strong>Festival banner</strong> <span className="muted">20 MERI · your words over the stage</span>
            <div className="row">
              <input className="small" maxLength={24} placeholder="Wen’s wheat is best" value={banner} onChange={e => setBanner(e.target.value)} aria-label="Banner text" />
              <button className="small" disabled={!!busy || coins < 20 || !banner.trim()} onClick={() => act('Boost', async () => {
                const { hash } = await call('burn_for_boost', { kind: 'banner', text: banner.trim() }, 40);
                report(hash);
                return `Your banner hangs over the stage. 20 MERI burned.`;
              })}>Hang it</button>
            </div>
          </div>
        </div>
        {(w.boosts?.length ?? 0) > 0 && (
          <ul className="boost-list">
            {w.boosts!.slice(0, 5).map(b => (
              <li key={b.at_ns}>{short(b.who)}: {b.kind === 'bell' ? `rang the bell for ${b.item}` : b.kind === 'banner' ? `“${b.text}”` : 'fireworks'} <span className="muted">({fmt(b.burned, 0)} burned)</span></li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The latest banner, while it's this week's. */
export function latestBanner(world: World): Boost | null {
  const b = (world as World & V4World).boosts?.find(x => x.kind === 'banner');
  return b && Date.now() - b.at_ns / 1e6 < 7 * world.clock.dayMs ? b : null;
}

// ---------- tips ----------

export function TipForm({ to, act, busy, onDone }: { to: string; act: Act; busy: string | null; onDone?: () => void }) {
  const [amount, setAmount] = useState('1');
  const [note, setNote] = useState('');
  return (
    <form className="tip-form" onSubmit={e => {
      e.preventDefault();
      act('Tip', async () => {
        const { hash } = await call('tip', { receiver_id: to, amount: String(Math.round(Number(amount) * 1e6)), memo: note.trim() || null }, 30);
        report(hash);
        onDone?.();
        return `You tipped ${short(to)} ${amount} MERI.`;
      });
    }}>
      <input className="small" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value)} aria-label="MERI to send" />
      <input className="small note" maxLength={80} placeholder="a note (optional)" value={note} onChange={e => setNote(e.target.value)} aria-label="Note" />
      <button className="small primary" disabled={!!busy || !(Number(amount) >= 0.01)}>Send</button>
    </form>
  );
}

// ---------- the Forge: crafted tool NFTs ----------

const RECIPES: { kind: 'axe' | 'pick' | 'sickle'; title: string; item: Item; wood: number; ore: number; icon: IconName }[] = [
  { kind: 'axe', title: 'Silver Axe', item: 'wood', wood: 4, ore: 6, icon: 'axe' },
  { kind: 'pick', title: 'Iron Pick', item: 'ore', wood: 6, ore: 4, icon: 'pick' },
  { kind: 'sickle', title: 'Golden Sickle', item: 'wheat', wood: 5, ore: 5, icon: 'sickle' },
];

export function Forge({ world, act, busy, explorer, town }: { world: World; act: Act; busy: string | null; explorer: string; town: string }) {
  const tools = (world.player as V4Player | undefined)?.tools;
  if (tools == null) return null;
  const items = world.player?.items ?? [0, 0, 0, 0, 0];
  const coins = meri(world.player?.coins ?? 0);
  return (
    <div className="panel forge">
      <h2 className="section-title">Forge a tool (NFT)</h2>
      <p className="hint">A crafted tool is an NFT in your account. Gathering at its ground gives one extra unit every swing for 60 swings, used automatically. Trade it on any NEAR NFT market.</p>
      <div className="recipes">
        {RECIPES.map(r => {
          const ok = items[0] >= r.wood && items[1] >= r.ore && coins >= 5;
          return (
            <div key={r.kind} className="recipe">
              <Icon name={r.icon} size={28} />
              <strong>{r.title}</strong>
              <span className="muted">+1 {r.item} a swing · {r.wood} wood, {r.ore} ore, 5 MERI</span>
              <button className="small" disabled={!!busy || !ok} onClick={() => act('Forge', async () => {
                const { value, hash } = await call<string>('craft_tool', { kind: r.kind }, 60);
                report(hash);
                return `You forged a ${r.title} (${value}). It’s in your account.`;
              })}>{ok ? 'Forge it' : 'Need more'}</button>
            </div>
          );
        })}
      </div>
      {tools.length > 0 && (
        <ul className="tool-list">
          {tools.map(t => (
            <li key={t.token_id}>
              <Icon name={RECIPES.find(r => r.kind === t.kind)?.icon ?? 'tool'} />
              <span><strong>{RECIPES.find(r => r.kind === t.kind)?.title ?? t.kind}</strong> <span className="muted">{t.token_id}</span></span>
              <span className={t.uses_left ? '' : 'muted'}>{t.uses_left ? `${t.uses_left} swings left` : 'worn out'}</span>
              <a className="text-link" href={`${explorer}/nft-token/${town}/${t.token_id}`} target="_blank" rel="noreferrer">NFT</a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** The tool (if any) the player gathers with at this ground: the one with the most swings left. */
export function toolFor(world: World, item: Item): ToolView | null {
  const tools = (world.player as V4Player | undefined)?.tools ?? [];
  return tools.filter(t => t.item === item && t.uses_left > 0).sort((a, b) => b.uses_left - a.uses_left)[0] ?? null;
}

// ---------- the collection: what the player holds as NFTs ----------

interface Token { token_id: string; metadata?: { title?: string; extra?: string } }

export function Collection({ account, explorer, town }: { account: string; explorer: string; town: string }) {
  const [tokens, setTokens] = useState<Token[] | null>(null);
  useEffect(() => {
    view<Token[]>('nft_tokens_for_owner', { account_id: account, limit: 100 }).then(setTokens).catch(() => setTokens([]));
  }, [account]);
  if (!tokens) return <p className="empty-note">Reading your NFTs…</p>;
  const groups: [string, (t: Token) => boolean][] = [
    ['Shop deeds', t => !/^(mark|festival|tool)-/.test(t.token_id)],
    ['Festival badges', t => t.token_id.startsWith('festival-')],
    ['Marks of the trade (soulbound)', t => t.token_id.startsWith('mark-')],
    ['Crafted tools', t => t.token_id.startsWith('tool-')],
  ];
  return (
    <div className="collection">
      <p className="hint">Everything here is a NEP-171 token in your own NEAR account. Badges and tools can be traded; marks are soulbound and stay with you.</p>
      {tokens.length === 0 && <p className="empty-note">Nothing yet. Marks appear as you earn them; a Festival share brings a badge.</p>}
      {groups.map(([title, test]) => {
        const list = tokens.filter(test);
        return list.length ? (
          <section key={title}>
            <h3 className="section-title">{title}</h3>
            <ul className="nft-list">
              {list.map(t => (
                <li key={t.token_id}>
                  <span>{t.metadata?.title ?? t.token_id}</span>
                  <a className="text-link" href={`${explorer}/nft-token/${town}/${encodeURIComponent(t.token_id)}`} target="_blank" rel="noreferrer">on chain</a>
                </li>
              ))}
            </ul>
          </section>
        ) : null;
      })}
    </div>
  );
}
