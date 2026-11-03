import { ICON, ITEMS, KEEPERS, fmt, meri, short, type AgentReport, type Item, type Params, type Player, type Shop } from './types';

/** The exact rule the contract used for this price, in words (RULES.md §2). */
function explain(shop: Shop, item: Item, side: 'ask' | 'bid', p: Params): string {
  const i = ITEMS.indexOf(item);
  const base = meri(p.base[i]);
  const stock = shop.stock[i];
  const target = shop.shop.target[i];
  const s = side === 'bid' ? stock + 1 : stock;
  const mult = ((2 * target) / (s + target)) ** 2;
  const keeper = KEEPERS[shop.shop.id]?.keeper ?? shop.shop.name;
  const lines = [
    `${keeper} holds ${stock} ${item} against a target of ${target}.`,
    `Price = ${base.toFixed(2)} × (2·${target} ÷ (${s}+${target}))² = ${base.toFixed(2)} × ${mult.toFixed(2)}`,
  ];
  if (side === 'bid') {
    const cash = meri(shop.cash);
    const comfort = meri(p.cash_comfort);
    const cf = Math.min(1, Math.max(p.min_cash_factor_bps / 10_000, cash / comfort));
    lines.push(`Pays ${100 - p.spread_bps / 100}% of that${cf < 1 ? `, × ${cf.toFixed(2)} because the till is low (${cash.toFixed(0)} of ${comfort})` : ''}.`);
    if (stock >= target * p.max_stock_mult - 1) lines.push('Nearly full: stops buying at 3× target.');
  } else if (stock < target * 0.5) {
    lines.push('Running low, so prices are up.');
  }
  return lines.join('\n');
}

function Move({ now, before }: { now: string; before?: string }) {
  if (!before || before === now) return null;
  return BigInt(now) > BigInt(before) ? <span className="up">▲</span> : <span className="down">▼</span>;
}

function ago(ms: number) {
  const m = Math.round((Date.now() - ms) / 60000);
  return m < 1 ? 'just now' : `${m} min ago`;
}

export function ShopCard({ shop, agent, explorer, prev, params, player, busy, onSell, onBuy }: {
  shop: Shop;
  agent?: AgentReport;
  explorer: string;
  prev?: Shop;
  params: Params;
  player?: Player;
  busy: string | null;
  onSell: (shop: Shop, item: Item, qty: number) => void;
  onBuy: (shop: Shop, item: Item, qty: number) => void;
}) {
  const s = shop.shop;
  const traded = ITEMS.filter(i => s.target[ITEMS.indexOf(i)] > 0);
  const town = shop.deed_holder === shop.account.split('.').slice(1).join('.');
  const status = shop.auction ? 'at auction' : s.open ? 'open' : 'closed';

  return (
    <article className={`shop ${s.open ? '' : 'closed'}`}>
      <header>
        <div>
          <h3>{s.name}</h3>
          <p className="muted">{KEEPERS[s.id]?.trade}</p>
        </div>
        <span className={`status ${status.replace(' ', '-')}`}>{status}</span>
      </header>
      <div className="till">
        <span>Till <strong>{fmt(shop.cash, 0)}</strong></span>
        <span className="muted" title="Whoever holds the deed appoints the shop's agent and collects its dividends">
          Deed: {town ? 'the town' : short(shop.deed_holder)}
        </span>
      </div>
      {agent && s.agent === agent.accountId && (
        <div className="voice" title={`${agent.reasoning}

Decided by ${agent.mode === 'llm' ? 'an LLM on NEAR AI Cloud' : 'its strategy rules'}; the contract checks every move.`}>
          <p>“{agent.say.replace(/^[A-Z][a-z]+:\s*/, '')}”</p>
          {agent.acted.length > 0 && (
            <ul>
              {agent.acted.map((a, i) => (
                <li key={i} className={a.error ? 'bad' : ''}>
                  {a.tx ? <a href={`${explorer}/txns/${a.tx}`} target="_blank" rel="noreferrer">{a.what}</a> : a.what}
                  {a.error && ` (failed: ${a.error})`}
                </li>
              ))}
            </ul>
          )}
          <span className="muted">{short(agent.accountId)}'s agent · {ago(agent.at)}{agent.mode === 'llm' ? ' · NEAR AI' : ''}</span>
        </div>
      )}
      <table className="prices">
        <tbody>
          {traded.map(item => {
            const i = ITEMS.indexOf(item);
            const stock = shop.stock[i];
            const target = s.target[i];
            const have = player?.items[i] ?? 0;
            const canBuy = s.sells.includes(item) && shop.ask[i] !== '0';
            const canSell = s.buys.includes(item) && shop.bid[i] !== '0';
            return (
              <tr key={item}>
                <td className="item">{ICON[item]} {item}</td>
                <td className="stock" title={`${stock} in stock, target ${target}`}>
                  <div className="mini-meter"><div style={{ width: `${Math.min(100, (stock / (target * 2)) * 100)}%` }} /></div>
                  <span>{stock}</span>
                </td>
                <td>
                  {canBuy && (
                    <button className="price buy" disabled={!!busy} title={explain(shop, item, 'ask', params)} onClick={() => onBuy(shop, item, 1)}>
                      buy {fmt(shop.ask[i])} <Move now={shop.ask[i]} before={prev?.ask[i]} />
                    </button>
                  )}
                </td>
                <td>
                  {canSell && (
                    <button className="price sell" disabled={!!busy || have < 1} title={explain(shop, item, 'bid', params)} onClick={() => onSell(shop, item, have)}>
                      sell{have > 0 ? ` ${have}` : ''} @ {fmt(shop.bid[i])} <Move now={shop.bid[i]} before={prev?.bid[i]} />
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </article>
  );
}
