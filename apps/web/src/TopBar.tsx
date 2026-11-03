import { useEffect, useState } from 'react';
import type { World } from './App';
import { fmt, meri, short } from './types';

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

export function TopBar({ world, account, onSignOut, onClaim }: { world: World; account: string; onSignOut: () => void; onClaim: () => void }) {
  const now = useNow();
  const { genesisMs, dayMs, skewMs } = world.clock;
  const chainNow = now - skewMs;
  const elapsed = chainNow - genesisMs;
  const day = Math.floor(elapsed / dayMs);
  const intoDay = (elapsed % dayMs) / dayMs;
  const daysPerWeek = world.params.days_per_week;
  const weekEnd = genesisMs + (Math.floor(day / daysPerWeek) + 1) * daysPerWeek * dayMs;

  const counted = meri(world.town.week_counted);
  const target = meri(world.town.week_target);
  const mood = Math.min(1, counted / target);
  const last = world.weeks.at(-1);
  const claimable = BigInt(world.player?.claimable ?? '0');
  const stamina = world.me?.stamina ?? 0;

  return (
    <header className="topbar">
      <div className="brand">
        <span className="wordmark">Meridian</span>
        <span className="day">Day {day + 1} · week {Math.floor(day / daysPerWeek) + 1}</span>
        <div className="sun" title={`${Math.round(intoDay * 100)}% through the market day`}>
          <div className="sun-fill" style={{ width: `${intoDay * 100}%` }} />
        </div>
      </div>

      <div className="festival" title="Counted trading this week vs the town's target. Hit it and the Festival mints new MERI to everyone who traded; miss it and part of the treasury burns.">
        <div className="festival-head">
          <span>Festival in {mmss(weekEnd - chainNow)}</span>
          <span className={mood >= 1 ? 'good' : ''}>{counted.toFixed(0)} / {target.toFixed(0)} MERI traded</span>
        </div>
        <div className="mood">
          <div className={`mood-fill ${mood >= 1 ? 'hit' : ''}`} style={{ width: `${mood * 100}%` }} />
        </div>
        <div className="festival-foot">
          <span>Streak {world.town.streak} · best {world.town.best_streak}</span>
          {last && <span className={last.hit ? 'good' : 'bad'}>Last week: {last.hit ? `festival, +${fmt(last.minted, 0)} minted` : `missed, ${fmt(last.burned, 0)} burned`}</span>}
          {claimable > 0n && <button className="chip good" onClick={onClaim}>Claim {fmt(claimable)} MERI</button>}
        </div>
      </div>

      <div className="purse">
        <div className="who">
          <strong>{short(account)}</strong>
          <button className="link" onClick={onSignOut} title="Forget this browser's key">leave</button>
        </div>
        <div className="coins">{fmt(world.player?.coins ?? 0)} <small>MERI</small></div>
        <div className="stamina" title="Stamina: each swing costs 5. It regrows over the day; bread restores 25.">
          <div className="stamina-fill" style={{ width: `${stamina}%` }} />
          <span>{Math.floor(stamina)} stamina</span>
        </div>
      </div>
    </header>
  );
}
