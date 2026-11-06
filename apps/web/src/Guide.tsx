// The town guide and the leaderboard. The guide mirrors docs/HOW-TO-PLAY.md.
import { Fragment, useEffect, useState } from 'react';
import { KEEPERS, fmt, short } from './types';
import { Icon } from './Icon';
import type { Act, World } from './App';
import { TipForm, hasV4 } from './Market';

const CHAPTERS: { title: string; body: React.ReactNode }[] = [
  {
    title: 'Welcome',
    body: (
      <>
        <p><strong>Arrive with nothing. Read the market. Own the town.</strong></p>
        <p>Meridian is a market town that runs itself. Six shops are kept by AI merchants with their own purses. Outside traders bid for the town’s orders every day. Once a week, the town either throws a Festival or watches its treasury burn.</p>
        <p>You start with an empty pack. Gather, trade, build your cottage, and work your way up to owning shops and leading a guild.</p>
        <p>Click any place on the map to go there. Follow the quest scroll at the top left: it points the way.</p>
      </>
    ),
  },
  {
    title: 'Making money',
    body: (
      <>
        <ol>
          <li><strong>Gather.</strong> Swing at the Forest (wood), the Mine (ore) or the Fields (wheat). Each swing costs stamina. The grounds are shared and regrow through the day, so a crowded ground runs dry. Tap once to wind up, then again as the rings meet: a perfect strike earns bonus XP.</li>
          <li><strong>Follow the week’s event.</strong> Each week one event (a fair, a frost, a rail survey) makes one good pay more. It’s in the Festival panel.</li>
          <li><strong>Sell to the best buyer.</strong> Every shop prices with the same rule: <em>the less it has, the more it pays.</em> Read the price signs on the map. A shop that has run out pays up to 4× the usual price; a full one pays pennies.</li>
          <li><strong>Take contracts.</strong> When a merchant runs short, it posts a delivery contract on the notice board with the money locked in escrow. Deliver and you’re paid on the spot, usually above market price.</li>
          <li><strong>Mind the spread.</strong> Shops sell for about 25% more than they buy. Buy-and-resell only pays when two shops' prices drift far apart.</li>
        </ol>
        <p className="muted">Hover any price to see exactly how it was calculated.</p>
      </>
    ),
  },
  {
    title: 'Growing stronger',
    body: (
      <>
        <ul>
          <li><strong>Bread</strong> restores 25 stamina. Buy it at the Bakery or the General Store, then eat it from your pack.</li>
          <li><strong>Tools</strong> double what each swing yields, for 25 swings.</li>
          <li><strong>Your cottage</strong> raises your stamina cap (100 → 200 over four levels). Building it burns tools and bread.</li>
          <li><strong>XP and titles</strong> come from real work: gathering, selling, delivering, building, bidding. Wanderer → Peddler → Hauler → Trader → Merchant → Burgher → Patron of Meridian.</li>
          <li><strong>Marks of the trade</strong>: twelve to collect, from your first perfect swing to your first Festival share. The full set raises your stamina cap by 25. See them in the Town books.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Owning the town',
    body: (
      <>
        <p><strong>A deed is a shop.</strong> Whoever holds a shop’s deed appoints the AI that runs it and collects its dividends: on a profitable day, half the profit, or everything above 2,000 MERI.</p>
        <p><strong>Auctions.</strong> A shop that can’t pay its daily upkeep closes, and its deed goes to auction. The winning bid goes into the till and reopens the shop. The town also sells deeds it holds. Bids start at 300 MERI, and each must beat the last by 5%.</p>
        <p><strong>Guilds.</strong> Join a guild (a DAO) to pool MERI with other players, vote to bid for a shop together, and share out what it earns. Majority rules.</p>
        <p><strong>The Festival.</strong> Every week, if the town trades enough, new MERI is minted to everyone who traded. If it doesn’t, 5% of the treasury burns. Keep the town busy.</p>
        <p><strong>The caravan.</strong> When shops run short, outside suppliers seal bids for their orders, then reveal them; the cheapest wins. It keeps prices from running away, and tells you when a shortage is about to end.</p>
      </>
    ),
  },
  {
    title: 'Playing well',
    body: (
      <>
        <ul>
          <li><strong>Go where others aren’t.</strong> If everyone is at the Mine, the Forest is the better trip.</li>
          <li><strong>Sell into shortages.</strong> Watch for a coral price sign: that shop is paying 1.5× or more.</li>
          <li><strong>Sell before the caravan lands.</strong> When a caravan round is open, an order is about to be filled from outside and prices will fall.</li>
          <li><strong>Don’t sell everything in one go.</strong> Each unit you sell lowers the shop’s price; split big loads across shops.</li>
          <li><strong>Eat when stamina is low, not when it’s empty.</strong> A loaf costs a few MERI and buys five more swings.</li>
          <li><strong>Trade in Festival weeks.</strong> Your share of the mint grows with what you trade, up to 500 MERI counted.</li>
          <li><strong>Buy shops that are about to recover.</strong> A bankrupt shop’s deed is cheapest exactly when its shelves are empty and its prices are highest.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'What’s real',
    body: (
      <>
        <p>Everything of value lives on the NEAR blockchain, on testnet for now:</p>
        <ul>
          <li><strong>MERI</strong> is a standard token (NEP-141). Goods (wood, ore, wheat, bread, tools) are tokens too (NEP-245).</li>
          <li><strong>Deeds</strong> are NFTs (NEP-171) that carry the shop’s live state.</li>
          <li><strong>Every trade, contract, bid and vote</strong> is a transaction you can look up on the explorer.</li>
          <li><strong>Merchants and suppliers</strong> are AI agents with their own accounts. Their keys can only do what the town’s rules allow.</li>
        </ul>
        <p>Your key lives in this browser, and the game pays your gas. No wallet, no seed phrase.</p>
        <p className="muted">3D models by Kenney (kenney.nl), CC0. Everything else is made for Meridian.</p>
      </>
    ),
  },
];

export function Guide({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="guide-title" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="book">
        <header>
          <h2 id="guide-title">The town guide</h2>
          <button className="link" onClick={onClose} aria-label="Close guide"><Icon name="close" /></button>
        </header>
        <nav className="tabs" role="tablist">
          {CHAPTERS.map((c, j) => (
            <button key={c.title} role="tab" aria-selected={i === j} className={i === j ? 'on' : ''} onClick={() => setI(j)}>{c.title}</button>
          ))}
        </nav>
        <div className="page">{CHAPTERS[i].body}</div>
        <footer>
          <button disabled={i === 0} onClick={() => setI(i - 1)}>Back</button>
          {i < CHAPTERS.length - 1 ? <button className="primary" onClick={() => setI(i + 1)}>Next</button> : <button className="primary" onClick={onClose}>Into town</button>}
        </footer>
      </div>
    </div>
  );
}

interface Leader { accountId: string; name: string; title: string; level: number; coins: string; deeds: string[] }

export function Leaders({ account, world, onClose, act, busy }: { account: string; world: World; onClose: () => void; act?: Act; busy?: string | null }) {
  const [rows, setRows] = useState<Leader[] | null>(null);
  const [tipTo, setTipTo] = useState<string | null>(null);
  const canTip = !!act && hasV4(world);
  useEffect(() => {
    fetch('/api/leaders').then(r => r.json()).then(setRows).catch(() => setRows([]));
  }, []);
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="leaders-title" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="book">
        <header>
          <h2 id="leaders-title">Meridian’s notables</h2>
          <button className="link" onClick={onClose} aria-label="Close leaderboard"><Icon name="close" /></button>
        </header>
        <p className="hint">Ranked by shops owned, then by purse. Updated every minute.</p>
        {!rows && <p className="empty-note">Asking around town…</p>}
        {rows?.length === 0 && <p className="empty-note">No one has made a name yet. Be the first.</p>}
        {rows && rows.length > 0 && (
          <table className="leaders">
            <thead><tr><th>#</th><th>Player</th><th>Title</th><th>Purse</th><th>Shops</th>{canTip && <th />}</tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <Fragment key={r.accountId}>
                  <tr className={r.accountId === account ? 'me' : ''}>
                    <td>{i + 1}</td>
                    <td>{short(r.accountId)}</td>
                    <td>{r.title} <span className="muted">Lv {r.level}</span></td>
                    <td>{fmt(r.coins)}</td>
                    <td>{r.deeds.join(', ') || 'None yet'}</td>
                    {canTip && <td>{r.accountId !== account && <button className="small" onClick={() => setTipTo(t => (t === r.accountId ? null : r.accountId))}>Tip</button>}</td>}
                  </tr>
                  {canTip && tipTo === r.accountId && (
                    <tr><td colSpan={6}><TipForm to={r.accountId} act={act!} busy={busy ?? null} onDone={() => setTipTo(null)} /></td></tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        )}
        <h3 className="section-title">Shopkeepers</h3>
        <p className="hint">The agent arena: every shop ranked by its till plus what it has paid its deed holder. A deed holder can replace the house merchant with their own agent.</p>
        <table className="leaders">
          <thead><tr><th>#</th><th>Shop</th><th>Run by</th><th>Till</th><th>Paid out</th></tr></thead>
          <tbody>
            {[...world.shops]
              .sort((a, b) => Number(BigInt(b.cash) + BigInt(b.shop.dividends_paid) - BigInt(a.cash) - BigInt(a.shop.dividends_paid)))
              .map((s, i) => {
                const house = world.agents?.[s.shop.id]?.accountId;
                const runBy = !s.shop.agent ? 'nobody' : s.shop.agent === house ? `${KEEPERS[s.shop.id]?.keeper ?? 'house'} (house AI)` : `${short(s.shop.agent)} (player’s agent)`;
                return (
                  <tr key={s.shop.id}>
                    <td>{i + 1}</td>
                    <td>{s.shop.name}{s.shop.open ? '' : ' (closed)'}</td>
                    <td>{runBy}</td>
                    <td>{fmt(s.cash, 0)}</td>
                    <td>{fmt(s.shop.dividends_paid, 0)}</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
