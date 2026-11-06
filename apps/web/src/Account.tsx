// Your account: the recovery phrase that owns it, logging out safely, and the ledger of what
// you have earned and what you own. Everything of value is on chain under your own account.
import { useEffect, useState } from 'react';
import type { Act, World } from './App';
import { Icon } from './Icon';
import { backup, canCashOut, cashOut, nearBalance, quoteCashOut } from './near';
import { ITEMS, fmt, meri } from './types';

const EXPLORER = { mainnet: 'https://nearblocks.io', testnet: 'https://testnet.nearblocks.io' };

function useEscape(onClose: () => void) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
}

function Copy({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <button className="small" onClick={() => {
      navigator.clipboard.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1800); }).catch(() => setDone(false));
    }}>{done ? 'Copied' : label}</button>
  );
}

/** The 12 words, numbered, the way a wallet shows them. */
export function PhraseWords({ phrase }: { phrase: string }) {
  return (
    <ol className="phrase">
      {phrase.split(' ').map((w, i) => <li key={i}><span>{i + 1}</span>{w}</li>)}
    </ol>
  );
}

/** Shown once, right after a new character is made. */
export function SavePhrase({ accountId, phrase, onDone }: { accountId: string; phrase: string; onDone: () => void }) {
  const [saved, setSaved] = useState(false);
  return (
    <div className="gate">
      <div className="gate-card">
        <span className="gate-back">Meridian</span>
        <h1>Save your recovery words</h1>
        <p className="lede">These 12 words own <strong>{accountId}</strong>. They log you back in on any device, and they open your account in any NEAR wallet, coins, goods and shops included.</p>
        <PhraseWords phrase={phrase} />
        <div className="row"><Copy text={phrase} label="Copy the words" /></div>
        <p className="fine">Write them down somewhere safe. Anyone with these words controls the account, and nobody, including us, can recover them for you.</p>
        <label className="check"><input type="checkbox" checked={saved} onChange={e => setSaved(e.target.checked)} /> I’ve saved my 12 words</label>
        <button className="primary" disabled={!saved} onClick={onDone}>Enter the town</button>
      </div>
    </div>
  );
}

export function AccountPanel({ network, onClose, onSignOut }: { network: string; onClose: () => void; onSignOut: () => void }) {
  useEscape(onClose);
  const b = backup();
  const [show, setShow] = useState(false);
  const [sure, setSure] = useState(false);
  if (!b) return null;
  const explorer = network === 'mainnet' ? EXPLORER.mainnet : EXPLORER.testnet;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="account-title" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="book">
        <header>
          <h2 id="account-title">Your account</h2>
          <button className="link" onClick={onClose} aria-label="Close account"><Icon name="close" /></button>
        </header>
        <p className="account-id"><strong>{b.accountId}</strong> <a href={`${explorer}/address/${b.accountId}`} target="_blank" rel="noreferrer">See it on the explorer</a></p>

        {b.phrase ? (
          <section className="panel">
            <h3 className="section-title">Recovery words</h3>
            <p className="hint">Your 12 words own this account. Use them to log back in, or import them into any NEAR wallet to move your coins, goods and shop deeds.</p>
            {show ? <PhraseWords phrase={b.phrase} /> : <p className="hidden-words">Hidden, so nobody reads them over your shoulder.</p>}
            <div className="row">
              <button className="small" onClick={() => setShow(!show)}>{show ? 'Hide the words' : 'Show the words'}</button>
              <Copy text={b.phrase} label="Copy the words" />
            </div>
          </section>
        ) : (
          <section className="panel">
            <h3 className="section-title">Your saved key</h3>
            <p className="hint">This character was made before recovery words. Save this key to log back in on another device. It can play the town but cannot move coins out; new characters get recovery words that can.</p>
            {show ? <code className="key">{b.playKey}</code> : <p className="hidden-words">Hidden, so nobody reads it over your shoulder.</p>}
            <div className="row">
              <button className="small" onClick={() => setShow(!show)}>{show ? 'Hide the key' : 'Show the key'}</button>
              <Copy text={b.playKey} label="Copy the key" />
            </div>
          </section>
        )}

        <section className="panel invite">
          <h3 className="section-title">Bring a friend</h3>
          <p className="hint">The town gets livelier with every player, and the Festival needs the whole town trading. Send them the link; they start free, no wallet needed.</p>
          <div className="row">
            <Copy text={`${location.origin}/`} label="Copy the invite link" />
            <a className="text-link" href={`https://x.com/intent/post?text=${encodeURIComponent(`I run a stall in Meridian, a market town on NEAR where the shopkeepers are AI agents. Come and trade: ${location.origin}/`)}`} target="_blank" rel="noreferrer">Share on X</a>
          </div>
        </section>

        <section className="leave">
          <h3 className="section-title">Log out</h3>
          <p className="hint">This browser forgets your keys. Your progress stays on chain, and your {b.phrase ? '12 words' : 'saved key'} bring you back.</p>
          <label className="check"><input type="checkbox" checked={sure} onChange={e => setSure(e.target.checked)} /> I’ve saved my {b.phrase ? '12 words' : 'key'}</label>
          <div className="row"><button disabled={!sure} onClick={onSignOut}><Icon name="door" /> Log out</button></div>
        </section>
      </div>
    </div>
  );
}

/** What you have earned, by source, and what you own right now: the game's income, in one place. */
/** Swap MERI for NEAR through the Rhea pool, right from the ledger. */
function CashOut({ world, account, act, busy }: { world: World; account: string; act: Act; busy: string | null }) {
  const m = world.market;
  const coins = meri(world.player?.coins ?? 0);
  const [amount, setAmount] = useState('');
  const [quote, setQuote] = useState<number | null>(null);
  const [near, setNear] = useState<number | null>(null);
  const micro = BigInt(Math.max(0, Math.floor(Number(amount || 0) * 1e6)));
  useEffect(() => {
    nearBalance(account).then(b => setNear(Number(b / 10n ** 18n) / 1e6));
  }, [account, busy]);
  useEffect(() => {
    if (!m || micro <= 0n) return setQuote(null);
    const t = setTimeout(() => quoteCashOut(m, micro).then(q => setQuote(Number(q / 10n ** 18n) / 1e6)).catch(() => setQuote(null)), 300);
    return () => clearTimeout(t);
  }, [amount, m?.poolId]);
  if (!m) return null;
  const tooMuch = Number(amount) > coins;
  return (
    <section className="cashout">
      <h3 className="section-title">Cash out to NEAR</h3>
      <p className="hint">Sell MERI into the MERI/wNEAR pool on Rhea and get NEAR in your own account{near !== null ? ` (you hold ${near.toFixed(4)} NEAR now)` : ''}. On testnet the NEAR has no cash value; on mainnet it’s yours to keep or move.</p>
      {canCashOut() ? (
        <div className="row cashout-row">
          <input id="cashout-amount" className="small" inputMode="decimal" value={amount} onChange={e => setAmount(e.target.value.replace(/[^0-9.]/g, ''))} placeholder={coins.toFixed(2)} aria-label="MERI to swap" />
          <button type="button" className="link" onClick={() => setAmount(String(Math.floor(coins * 100) / 100))}>All</button>
          <span className="muted">{quote !== null ? `≈ ${quote.toFixed(4)} NEAR` : ''}</span>
          <button className="primary small" disabled={!!busy || micro <= 0n || tooMuch}
            onClick={() => act('Cash out', async () => {
              const got = await cashOut(m, micro);
              setAmount('');
              return `You swapped ${Number(amount).toFixed(2)} MERI for ${(Number(got / 10n ** 18n) / 1e6).toFixed(4)} NEAR, now in your account.`;
            })}>Swap to NEAR</button>
        </div>
      ) : (
        <p className="muted">This character was made before recovery words, so it can’t move coins out. New characters can.</p>
      )}
      {tooMuch && <p className="error">You have {coins.toFixed(2)} MERI.</p>}
    </section>
  );
}

export function Earnings({ world, account, network, onClose, act, busy }: { world: World; account: string; network: string; onClose: () => void; act: Act; busy: string | null }) {
  useEscape(onClose);
  const stats = world.me?.stats;
  const coins = meri(world.player?.coins ?? 0);
  const claimable = meri(world.player?.claimable ?? 0);
  const items = world.player?.items ?? [0, 0, 0, 0, 0];
  // Goods are valued at the best price a shop would pay for them now.
  const bestBid = (i: number) => Math.max(0, ...world.shops.filter(s => s.shop.open).map(s => meri(s.bid[i])));
  const goods = ITEMS.map((item, i) => ({ item, n: items[i], value: items[i] * bestBid(i) }));
  const goodsValue = goods.reduce((a, g) => a + g.value, 0);
  const owned = world.shops.filter(s => s.deed_holder === account);
  const dividends = owned.reduce((a, s) => a + meri(s.shop.dividends_paid), 0);
  const earned = [
    { label: 'Selling to the shops', v: stats?.sold ?? 0 },
    { label: 'Delivery contracts', v: stats?.delivered ?? 0 },
    { label: 'Festival shares', v: stats?.festival ?? 0 },
    { label: 'Paid out by shops you own', v: dividends },
  ];
  const total = earned.reduce((a, e) => a + e.v, 0);
  const worth = coins + goodsValue + claimable;
  const m = world.market;
  return (
    <div className="modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="earnings-title" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="book ledger">
        <header>
          <h2 id="earnings-title">Your ledger</h2>
          <button className="link" onClick={onClose} aria-label="Close ledger"><Icon name="close" /></button>
        </header>
        <div className="ledger-top">
          <div><span className="muted">You own, valued now</span><strong className="big-figure"><Icon name="coin" size={30} /> {worth.toFixed(2)}</strong><span className="muted">MERI{m ? `, about ${(worth * m.nearPerMeri).toFixed(3)} NEAR on Rhea` : ''}</span></div>
          <div><span className="muted">Earned so far</span><strong className="big-figure">{total.toFixed(0)}</strong><span className="muted">MERI, from play</span></div>
        </div>
        <table className="ledger-table">
          <thead><tr><th>Where it came from</th><th className="num">MERI</th></tr></thead>
          <tbody>
            {earned.map(e => <tr key={e.label}><td>{e.label}</td><td className="num">{e.v.toFixed(0)}</td></tr>)}
          </tbody>
        </table>
        <table className="ledger-table">
          <thead><tr><th>What you hold</th><th className="num">Amount</th><th className="num">Worth in MERI</th></tr></thead>
          <tbody>
            <tr><td className="with-icon"><Icon name="coin" /> Coins</td><td className="num">{coins.toFixed(2)}</td><td className="num">{coins.toFixed(2)}</td></tr>
            {claimable > 0 && <tr><td className="with-icon"><Icon name="sack" /> Festival share to claim</td><td className="num">{claimable.toFixed(2)}</td><td className="num">{claimable.toFixed(2)}</td></tr>}
            {goods.filter(g => g.n > 0).map(g => <tr key={g.item}><td className="with-icon"><Icon name={g.item} /> {g.item}</td><td className="num">{g.n}</td><td className="num">{g.value.toFixed(2)}</td></tr>)}
            {owned.map(s => <tr key={s.shop.id}><td className="with-icon"><Icon name="house" /> Deed to {s.shop.name}</td><td className="num">1</td><td className="num">its till: {fmt(s.cash, 0)}</td></tr>)}
          </tbody>
        </table>
        <CashOut world={world} account={account} act={act} busy={busy} />
        {m && (
          <p className="market-line">
            <strong>1 MERI ≈ {m.nearPerMeri.toFixed(4)} NEAR</strong> in the MERI/wNEAR pool on Rhea (pool {m.poolId}, holding {m.meriInPool.toFixed(0)} MERI and {m.nearInPool.toFixed(2)} wNEAR).{' '}
            <a href={`${network === 'mainnet' ? EXPLORER.mainnet : EXPLORER.testnet}/address/${m.exchange}`} target="_blank" rel="noreferrer">See the exchange</a>
          </p>
        )}
        <p className="hint">Everything here sits on chain under <strong>{account}</strong>, which your recovery words own. On NEAR mainnet MERI and shop deeds are tradable tokens, so what you earn here is yours to keep, sell or move to any NEAR wallet. Today the game runs on testnet, where coins have no cash value. <a href={`${network === 'mainnet' ? EXPLORER.mainnet : EXPLORER.testnet}/address/${account}`} target="_blank" rel="noreferrer">Check it on the explorer</a></p>
      </div>
    </div>
  );
}
