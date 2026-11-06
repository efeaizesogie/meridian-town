// The Inspector’s Desk (/judge), for hackathon judges: everything worth checking in Meridian, in five minutes, with no
// walking around. Every action button sends a real testnet transaction, signed in this browser
// with a key that can only call the town contract, and links to it on the explorer.
import { useEffect, useState } from 'react';
import type { World } from './App';
import { api, backup, call, join, view, type Config } from './near';
import { ITEMS, KEEPERS, fmt, meri, short, type Earned, type Item } from './types';
import { FastForward } from './FastForward';
import { Ledger } from './Books';
import { EventCard } from './Places';
import { Icon } from './Icon';
import type { Act } from './App';
import { Collection, FestivalExtras, Forge, ShopCoinPanel, TipForm, hasV4 } from './Market';

const REPO = 'https://github.com/efeaizesogie/meridian-town';

interface Done { label: string; text: string; tx?: string; ok: boolean }

/** The run() label of each action below, in order, so its button can show "Sending…". */
const LABELS = ['Gather', 'Sell', 'Eat', 'Deliver', 'Bid', 'Claim'];

export function Judge({ config, world, account, onJoined, refresh }: {
  config: Config;
  world: World | null;
  account: string | null;
  onJoined: (id: string) => void;
  refresh: () => Promise<void>;
}) {
  const explorer = config.network === 'mainnet' ? 'https://nearblocks.io' : 'https://testnet.nearblocks.io';
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<Done[]>([]);
  const [ff, setFf] = useState(false);
  const [phrase, setPhrase] = useState(false);
  const [step, go] = useStep();

  const run = (label: string, task: () => Promise<{ text: string; tx?: string }>) => async () => {
    setBusy(label);
    try {
      const r = await task();
      setLog(l => [{ label, ok: true, ...r }, ...l]);
      await refresh().catch(() => {});
    } catch (e) {
      setLog(l => [{ label, ok: false, text: e instanceof Error ? e.message : String(e) }, ...l]);
    } finally {
      setBusy(null);
    }
  };
  /** Tell the game server about a confirmed transaction so XP, marks and records follow. */
  const report = (hash: string) => api<Earned>('/api/report', { txHash: hash }).catch(() => null);
  /** The game's panels take an `act`; here it logs to the judge log instead of a toast. */
  const actAdapter: Act = (label, task) => run(label, async () => ({ text: (await task()) || 'Done.' }))();

  if (!world) return <div className="loading">Opening the Inspector’s Desk…</div>;

  const items = world.player?.items ?? [0, 0, 0, 0, 0];
  const raw = (['wood', 'ore', 'wheat'] as const);
  const best = (item: Item) => {
    const i = ITEMS.indexOf(item);
    return world.shops.filter(s => s.shop.open && s.shop.buys.includes(item)).sort((a, b) => Number(BigInt(b.bid[i]) - BigInt(a.bid[i])))[0];
  };
  const seller = (item: Item) => {
    const i = ITEMS.indexOf(item);
    return world.shops.filter(s => s.shop.open && s.shop.sells.includes(item) && s.stock[i] > 0).sort((a, b) => Number(BigInt(a.ask[i]) - BigInt(b.ask[i])))[0];
  };
  const holding = raw.find(it => items[ITEMS.indexOf(it)] > 0);
  const job = world.jobs.find(j => items[ITEMS.indexOf(j.item)] > 0) ?? world.jobs[0];
  const auction = world.auctions[0];
  const claimable = BigInt(world.player?.claimable ?? '0');
  const loaf = seller('bread');
  const counted = meri(world.town.week_counted);
  const target = meri(world.town.week_target);

  const actions: { title: string; what: string; disabled?: string | false; go: () => void }[] = [
    {
      title: 'Gather wheat',
      what: 'Four swings in the Fields. The game server mints the wheat into your account in its next batch, the same way it does for every player.',
      disabled: (world.me?.stamina ?? 0) < config.rules.swingCost ? 'Out of stamina: eat a loaf first' : false,
      go: run('Gather', async () => {
        const r = await api<{ item: string; gathered: number } & Earned>('/api/gather', { ground: 'fields', swings: config.rules.maxSwingsPerRequest, timing: 'ok' });
        return { text: r.gathered ? `Gathered ${r.gathered} wheat, minted to ${short(account!)} on chain.` : 'The Fields are bare right now.' };
      }),
    },
    {
      title: 'Sell to the best buyer with room',
      what: 'A real trade: price comes from the shop’s stock against its target, 2% goes to the treasury, and the sale counts toward the Festival.',
      disabled: !holding ? 'Gather something first' : !best(holding) ? 'No open shop buys it right now' : false,
      go: run('Sell', async () => {
        // The best-paying shop that still has room, across everything you hold.
        const offers = raw.filter(it => items[ITEMS.indexOf(it)] > 0)
          .flatMap(it => world.shops.filter(s => s.shop.open && s.shop.buys.includes(it)).map(s => ({ it, s, bid: BigInt(s.bid[ITEMS.indexOf(it)]) })))
          .sort((a, b) => Number(b.bid - a.bid));
        let pick: { it: Item; s: (typeof world.shops)[number]; n: number } | null = null;
        for (const o of offers) {
          const cap = await view<number>('sell_capacity', { shop_id: o.s.shop.id, item: o.it });
          const n = Math.min(items[ITEMS.indexOf(o.it)], cap, 100);
          if (n > 0) { pick = { it: o.it, s: o.s, n }; break; }
        }
        if (!pick) throw new Error('Every shop that buys what you hold is full right now');
        const { it: item, s: shop, n } = pick;
        const quote = BigInt(await view<string>('quote_sell', { shop_id: shop.shop.id, item, quantity: n }));
        const { value, hash } = await call<string>('sell', { shop_id: shop.shop.id, item, quantity: n, min_total: String((quote * 97n) / 100n) }, 40);
        report(hash);
        return { text: `Sold ${n} ${item} to ${KEEPERS[shop.shop.id]?.keeper} for ${fmt(value)} MERI.`, tx: hash };
      }),
    },
    {
      title: 'Buy a loaf, then eat it',
      what: 'Two transactions: buy from the cheapest seller, then use_item burns the loaf on chain and the server restores your stamina once it sees the burn.',
      disabled: !loaf ? 'No bread on any shelf right now' : meri(world.player?.coins ?? 0) < meri(loaf.ask[3]) ? 'Not enough MERI: sell something first' : false,
      go: run('Eat', async () => {
        const quote = BigInt(await view<string>('quote_buy', { shop_id: loaf!.shop.id, item: 'bread', quantity: 1 }));
        await call<string>('buy', { shop_id: loaf!.shop.id, item: 'bread', quantity: 1, max_total: String((quote * 103n) / 100n) }, 40);
        const { hash } = await call('use_item', { item: 'bread', quantity: 1 });
        const r = await api<{ stamina: number }>('/api/use', { txHash: hash });
        return { text: `Bought a loaf for ${fmt(quote)} MERI and ate it. Stamina is ${Math.round(r.stamina)}.`, tx: hash };
      }),
    },
    {
      title: job ? `Fill contract #${job.id}: ${job.remaining} ${job.item}` : 'Fill a delivery contract',
      what: 'Shopkeepers post these when stock runs low, with the payment locked in escrow. Delivering releases it to you.',
      disabled: !job ? 'No contract open right now: shops post them when stock falls below 30% of target' : items[ITEMS.indexOf(job.item)] < 1 ? `Gather some ${job.item} first` : false,
      go: run('Deliver', async () => {
        const qty = Math.min(job!.remaining, items[ITEMS.indexOf(job!.item)]);
        const { value, hash } = await call<string>('deliver', { job_id: job!.id, quantity: qty });
        report(hash);
        return { text: `Delivered ${qty} ${job!.item} and received ${fmt(value)} MERI from escrow.`, tx: hash };
      }),
    },
    {
      title: auction ? `Bid for the ${auction.shop_id} deed` : 'Bid for a shop deed',
      what: 'A closed shop’s deed (an NFT) goes to auction. The winner collects half its daily profit and chooses the AI that runs it.',
      disabled: !auction ? 'No deed is at auction right now' : meri(world.player?.coins ?? 0) < Math.max(meri(world.params.auction_reserve), meri(auction.high_bid) * 1.05) ? `Needs ${Math.max(meri(world.params.auction_reserve), meri(auction.high_bid) * 1.05).toFixed(0)} MERI` : false,
      go: run('Bid', async () => {
        const min = BigInt(auction!.high_bid) > 0n ? (BigInt(auction!.high_bid) * BigInt(10_000 + world.params.auction_min_raise_bps)) / 10_000n + 1n : BigInt(world.params.auction_reserve);
        const { hash } = await call('bid_for_deed', { shop_id: auction!.shop_id, amount: String(min) });
        report(hash);
        return { text: `You lead the ${auction!.shop_id} auction at ${fmt(min)} MERI.`, tx: hash };
      }),
    },
    {
      title: 'Claim a Festival share',
      what: 'When the town hits its weekly target, new MERI is minted to everyone who traded, in proportion to their trade.',
      disabled: claimable === 0n ? 'Nothing to claim: the share appears after a Festival you traded in' : false,
      go: run('Claim', async () => {
        const { value, hash } = await call<string>('claim_festival', {});
        report(hash);
        return { text: `Claimed ${fmt(value ?? 0)} MERI.`, tx: hash };
      }),
    },
  ];

  const agents = Object.values(world.agents ?? {});
  const recentTx = agents.flatMap(a => a.acted.filter(x => x.tx).map(x => ({ who: KEEPERS[a.shopId]?.keeper ?? a.shopId, what: x.what, tx: x.tx!, at: a.at }))).sort((a, b) => b.at - a.at).slice(0, 8);

  return (
    <div className="judge">
      <header className="judge-head">
        <a className="gate-back" href="/">Meridian</a>
        <h1>The Inspector’s Desk</h1>
        <p className="lede">
          Everything worth checking, in five minutes. Each button below sends a real testnet transaction, signed in this browser with a key that can only call the town contract, and links to it on the explorer.
          Prefer to play? <a className="text-link" href="/play">Open the game</a>.
        </p>
        <div className="judge-stats">
          <div><span className="muted">Market day</span><strong>{world.town.day + 1}</strong></div>
          <div><span className="muted">This week’s Festival</span><strong>{counted.toFixed(0)} / {target.toFixed(0)} MERI</strong></div>
          <div><span className="muted">Shops open</span><strong>{world.shops.filter(s => s.shop.open).length} of {world.shops.length}</strong></div>
          <div><span className="muted">Open contracts</span><strong>{world.jobs.length}</strong></div>
          <div><span className="muted">Deeds at auction</span><strong>{world.auctions.length}</strong></div>
          <div><span className="muted">Festivals held</span><strong>{world.weeks.filter(w => w.hit).length} of {world.weeks.length}</strong></div>
        </div>
        {world.event && <EventCard world={world} />}
      </header>

      <JudgeNav step={step} go={go} />

      {step === 'act' && (
      <section className="judge-section" id="act">
        <h2>Try every action</h2>
        {!account ? (
          <div className="judge-start">
            <p>A judge character takes one click: the game creates a real NEAR sub-account for you, pays its gas, and keeps its 12 recovery words in this browser (see them under Account in the game).</p>
            <button className="primary" disabled={!!busy} onClick={run('Join', async () => {
              const id = await join(`judge${Math.floor(1000 + Math.random() * 9000)}`);
              onJoined(id);
              return { text: `Created ${id}. It’s a real account: look it up on the explorer.`, tx: undefined };
            })}>{busy === 'Join' ? 'Opening your account…' : 'Make me a judge character'}</button>
          </div>
        ) : (
          <>
            <p className="hint">
              Playing as <a className="text-link" href={`${explorer}/address/${account}`} target="_blank" rel="noreferrer">{account}</a>:
              {' '}{fmt(world.player?.coins ?? 0)} MERI, {ITEMS.map((it, i) => `${items[i]} ${it}`).join(', ')}, stamina {Math.floor(world.me?.stamina ?? 0)}.
              {' '}<button className="link" onClick={() => setPhrase(p => !p)}>{phrase ? 'Hide' : 'Show'} its recovery words</button>
              {phrase && <code className="judge-phrase">{backup()?.phrase ?? 'Not kept in this browser'}</code>}
            </p>
            <ol className="judge-actions">
              {actions.map((a, i) => (
                <li key={LABELS[i]}>
                  <div>
                    <strong>{a.title}</strong>
                    <p className="muted">{a.what}</p>
                  </div>
                  <button className="small primary" disabled={!!busy || !!a.disabled} title={a.disabled || undefined} onClick={a.go}>
                    {busy === LABELS[i] ? 'Sending…' : a.disabled ? a.disabled : 'Do it'}
                  </button>
                </li>
              ))}
            </ol>
          </>
        )}
        {log.length > 0 && (
          <ul className="judge-log" aria-live="polite">
            {log.map((d, i) => (
              <li key={i} className={d.ok ? 'good' : 'bad'}>
                <strong>{d.label}:</strong> {d.text}{' '}
                {d.tx && <a className="text-link" href={`${explorer}/txns/${d.tx}`} target="_blank" rel="noreferrer">See the transaction</a>}
              </li>
            ))}
          </ul>
        )}
      </section>
      )}

      {step === 'social' && (
      <section className="judge-section" id="social">
        <h2>Social money, memecoin sinks and NFT utility</h2>
        <p>All of this is in the town contract, so every coin stays accounted for. Each button is a real transaction from your judge character.</p>
        {!hasV4(world) ? (
          <p className="hint">These arrive with the V4 contract upgrade (tips, shop coins, the prediction pool, the tournament, burn-to-boost, Festival badges, soulbound marks, crafted tools). The code and its 62 tests are in the repository; this town is still on V3.</p>
        ) : !account ? (
          <p className="hint">Make a judge character in step 1 first.</p>
        ) : (
          <div className="judge-social">
            <article>
              <h3>Tip a townsperson</h3>
              <p className="muted">Send MERI with a note to Ivy, one of the game-run residents. It shows in the town crier.</p>
              <TipForm to={`ivy.${config.game}`} act={actAdapter} busy={busy} />
            </article>
            <article>
              <h3>Buy a shop coin</h3>
              <ShopCoinPanel shopId="baker" world={world} act={actAdapter} busy={busy} />
            </article>
            <article>
              <h3>The Festival stage</h3>
              <FestivalExtras world={world} act={actAdapter} busy={busy} />
            </article>
            <article>
              <Forge world={world} act={actAdapter} busy={busy} explorer={explorer} town={config.town} />
            </article>
            <article>
              <h3>Your NFTs</h3>
              <Collection account={account} explorer={explorer} town={config.town} />
            </article>
          </div>
        )}
      </section>
      )}

      {step === 'stress' && (
      <section className="judge-section" id="stress">
        <h2>What if…? Put the town under pressure</h2>
        <p>Fast-forward copies the live town into this browser and plays the next market week in a minute, on the same rules the contract enforces (the contract’s tests are pinned to the same numbers). Then throw the week a curveball: a grain barge docks, drought takes the Fields, Oswin’s till runs dry. Watch prices, delivery contracts, closures, auctions and the Festival answer. Nothing is sent to the chain.</p>
        <button className="primary" onClick={() => setFf(true)}><Icon name="forward" /> Open fast-forward</button>
      </section>
      )}

      {step === 'agents' && (
      <section className="judge-section" id="agents">
        <h2>The AI shopkeepers, on chain</h2>
        <p>Each shop is run by an agent with its own NEAR account. Its only key can call <code>set_target</code>, <code>post_job</code> and <code>expire_job</code>, nothing else. Decisions come from NEAR AI Cloud, checked against the same limits the contract enforces.</p>
        <table className="books-table">
          <thead><tr><th>Shop</th><th>Agent account</th><th>Last said</th></tr></thead>
          <tbody>
            {world.shops.map(s => {
              const a = world.agents?.[s.shop.id];
              return (
                <tr key={s.shop.id}>
                  <td><strong>{s.shop.name}</strong><br /><span className="muted">{s.shop.open ? `till ${fmt(s.cash, 0)} MERI` : 'closed, deed at auction'}</span></td>
                  <td>{s.shop.agent ? <a className="text-link" href={`${explorer}/address/${s.shop.agent}`} target="_blank" rel="noreferrer">{s.shop.agent}</a> : <span className="muted">none</span>}</td>
                  <td>{a ? <>“{a.say}” <span className="muted">({a.mode === 'llm' ? 'NEAR AI' : 'strategy rules'})</span></> : <span className="muted">Quiet so far</span>}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {recentTx.length > 0 && (
          <>
            <h3 className="section-title">Their latest transactions</h3>
            <ul className="judge-log">
              {recentTx.map(t => (
                <li key={t.tx}>{t.who} {t.what}. <a className="text-link" href={`${explorer}/txns/${t.tx}`} target="_blank" rel="noreferrer">See it</a></li>
              ))}
            </ul>
          </>
        )}
      </section>
      )}

      {step === 'books' && (
      <section className="judge-section" id="books">
        <h2>The town’s books</h2>
        <Ledger world={world} explorer={explorer} town={config.town} />
      </section>
      )}

      {step === 'chain' && (
      <section className="judge-section" id="chain">
        <h2>What’s on chain, and where to look</h2>
        <table className="books-table">
          <tbody>
            <tr><td><strong>Town contract</strong><br /><span className="muted">Rust, near-sdk 5. MERI (NEP-141), goods (NEP-245) and shop deeds (NEP-171) in one contract, with prices, contracts, upkeep, auctions and the Festival.</span></td>
              <td><a className="text-link" href={`${explorer}/address/${config.town}`} target="_blank" rel="noreferrer">{config.town}</a></td></tr>
            <tr><td><strong>Players</strong><br /><span className="muted">Named sub-accounts with a play key limited to the town, and a full-access key that only the recovery words control.</span></td>
              <td><a className="text-link" href={`${explorer}/address/${config.game}`} target="_blank" rel="noreferrer">*.{config.game}</a></td></tr>
            <tr><td><strong>Guilds</strong><br /><span className="muted">Sputnik DAOs registered with the town: pool MERI, propose, vote, share out.</span></td>
              <td>{world.guildViews.map(g => <div key={g.id}><a className="text-link" href={`${explorer}/address/${g.id}`} target="_blank" rel="noreferrer">{g.id}</a></div>)}</td></tr>
            {world.market && (
              <tr><td><strong>MERI price</strong><br /><span className="muted">A MERI/wNEAR pool on Rhea, read every minute; players can cash out through it.</span></td>
                <td>pool {world.market.poolId} on {world.market.exchange}</td></tr>
            )}
            <tr><td><strong>Source</strong><br /><span className="muted">Contract, server (agents, townsfolk, keeper), web client, and the shared economy simulator the contract tests are pinned to.</span></td>
              <td><a className="text-link" href={REPO} target="_blank" rel="noreferrer">GitHub</a></td></tr>
          </tbody>
        </table>
      </section>
      )}

      <JudgePager step={step} go={go} />

      {ff && <FastForward world={world} onClose={() => setFf(false)} />}
    </div>
  );
}

// ---------- step-by-step navigation: tabs, Back and Next, and the browser's own back button ----------

const STEPS = [
  { id: 'act', title: 'Try every action' },
  { id: 'social', title: 'Social money & NFTs' },
  { id: 'stress', title: 'What if…?' },
  { id: 'agents', title: 'The AI shopkeepers' },
  { id: 'books', title: 'The town’s books' },
  { id: 'chain', title: 'What’s on chain' },
] as const;
type StepId = (typeof STEPS)[number]['id'];

const fromHash = (): StepId => (STEPS.find(s => '#' + s.id === location.hash)?.id ?? 'act');

/** The current step lives in the URL hash, so Back and Forward in the browser move between steps. */
function useStep(): [StepId, (id: StepId) => void] {
  const [step, setStep] = useState<StepId>(fromHash);
  useEffect(() => {
    const on = () => setStep(fromHash());
    window.addEventListener('hashchange', on);
    const keys = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest('input, textarea') || document.querySelector('.ff-backdrop')) return;
      const i = STEPS.findIndex(s => s.id === fromHash());
      if (e.key === 'ArrowRight' && i < STEPS.length - 1) location.hash = STEPS[i + 1].id;
      if (e.key === 'ArrowLeft' && i > 0) location.hash = STEPS[i - 1].id;
    };
    window.addEventListener('keydown', keys);
    return () => { window.removeEventListener('hashchange', on); window.removeEventListener('keydown', keys); };
  }, []);
  const go = (id: StepId) => {
    location.hash = id;
    document.querySelector('.judge-nav')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  return [step, go];
}

function JudgeNav({ step, go }: { step: StepId; go: (id: StepId) => void }) {
  const i = STEPS.findIndex(s => s.id === step);
  return (
    <nav className="judge-nav" aria-label="Inspector’s Desk sections">
      <button className="small" disabled={i === 0} onClick={() => go(STEPS[i - 1].id)} aria-label="Previous section">←</button>
      <ol>
        {STEPS.map((s, n) => (
          <li key={s.id}>
            <button className={s.id === step ? 'on' : n < i ? 'seen' : ''} aria-current={s.id === step ? 'step' : undefined} onClick={() => go(s.id)}>
              <b>{n + 1}</b> <span>{s.title}</span>
            </button>
          </li>
        ))}
      </ol>
      <button className="small" disabled={i === STEPS.length - 1} onClick={() => go(STEPS[i + 1].id)} aria-label="Next section">→</button>
    </nav>
  );
}

function JudgePager({ step, go }: { step: StepId; go: (id: StepId) => void }) {
  const i = STEPS.findIndex(s => s.id === step);
  const prev = STEPS[i - 1];
  const next = STEPS[i + 1];
  return (
    <div className="judge-pager">
      {prev ? <button onClick={() => go(prev.id)}>← {prev.title}</button> : <span />}
      <span className="muted">{i + 1} of {STEPS.length} · arrow keys work too</span>
      {next ? <button className="primary" onClick={() => go(next.id)}>{next.title} →</button> : <a className="btn primary" href="/play">Play the game →</a>}
    </div>
  );
}
