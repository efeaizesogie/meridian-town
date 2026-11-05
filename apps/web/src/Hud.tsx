// The heads-up display: who you are and how you're doing, the clock, and the Festival.
import { useEffect, useRef, useState } from 'react';
import type { World } from './App';
import { isMuted, isMusicOn, setMuted, setMusicOn } from './juice';
import { fmt, meri, short } from './types';
import { Icon } from './Icon';

function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

/** A purse that counts up or down to its new value instead of jumping. */
function useCountTo(target: number) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (t: number) => {
      const k = Math.min(1, (t - start) / 700);
      const v = a + (target - a) * (1 - Math.pow(1 - k, 3));
      setShown(v);
      if (k < 1) raf = requestAnimationFrame(step);
      else from.current = target;
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target]);
  return shown;
}

const mmss = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}:${String(s % 60).padStart(2, '0')}`;
};

export function Hud({ world, account, purseRef, onAccount, onEarnings, onGuide, onLeaders, onFestival, gfx, onGfx }: {
  gfx: '3d' | '2d';
  onGfx: () => void;
  world: World;
  account: string;
  purseRef: React.RefObject<HTMLDivElement | null>;
  onAccount: () => void;
  onEarnings: () => void;
  onGuide: () => void;
  onLeaders: () => void;
  onFestival: () => void;
}) {
  const now = useNow();
  const [muted, setM] = useState(isMuted());
  const [musicOn, setMusic] = useState(isMusicOn());
  const { genesisMs, dayMs, skewMs } = world.clock;
  const elapsed = now - skewMs - genesisMs;
  const day = Math.floor(elapsed / dayMs);
  const intoDay = (elapsed % dayMs) / dayMs;
  const dpw = world.params.days_per_week;
  const weekEnd = genesisMs + (Math.floor(day / dpw) + 1) * dpw * dayMs;
  const counted = meri(world.town.week_counted);
  const target = meri(world.town.week_target);
  const mood = Math.min(1, counted / target);
  const me = world.me;
  const coins = useCountTo(meri(world.player?.coins ?? 0));
  const xpInto = me ? (me.xp - me.levelXp) / Math.max(1, me.nextLevelXp - me.levelXp) : 0;
  const claimable = BigInt(world.player?.claimable ?? '0');

  const phase = intoDay < 0.7 ? 'sun' : intoDay < 0.85 ? 'dusk' : 'moon';
  return (
    <header className="hud">
      <div className="hud-id">
        <div className="avatar" aria-hidden>{short(account).slice(0, 1).toUpperCase()}</div>
        <div className="hud-id-text">
          <div className="who"><strong>{short(account)}</strong> <span className="title">{me?.title ?? ''}</span></div>
          <div className="xp" title={me ? `${me.xp} XP, ${me.nextLevelXp - me.xp} to level ${me.level + 1}` : ''}>
            <span className="lvl">Level {me?.level ?? 1}</span>
            <div className="bar"><div style={{ width: `${xpInto * 100}%` }} /></div>
          </div>
        </div>
      </div>

      <div className="hud-clock" title={`${Math.round(intoDay * 100)}% through the market day`}>
        <Icon name={phase} size={26} />
        <div>
          <strong>Day {day + 1}</strong> <span className="muted">next in {mmss(dayMs - (elapsed % dayMs))}</span>
          <div className="bar thin"><div style={{ width: `${intoDay * 100}%` }} /></div>
        </div>
      </div>

      <button className="hud-festival" onClick={onFestival} title="The town's weekly target. Hit it and the Festival mints MERI to everyone who traded; miss it and the treasury burns.">
        <span className="with-icon"><Icon name="flag" /> Festival in {mmss(weekEnd - (now - skewMs))}</span>
        <div className="bar"><div className={mood >= 1 ? 'hit' : ''} style={{ width: `${mood * 100}%` }} /></div>
        <span className="muted">{counted.toFixed(0)} of {target.toFixed(0)} traded, streak {world.town.streak}{claimable > 0n ? <b className="claim"> Your share is ready</b> : null}</span>
      </button>

      <div className="hud-purse" ref={purseRef}>
        <button className="coins" onClick={onEarnings} title="Your ledger: what you earned and what you own" aria-label={`${fmt(world.player?.coins ?? 0)} MERI. Open your ledger`}><Icon name="coin" size={24} /> {coins.toFixed(2)}</button>
        <div className="stamina" title="Stamina: each swing costs 5. It regrows over the day; bread restores 25. A bigger cottage holds more.">
          <div className="stamina-fill" style={{ width: `${((me?.stamina ?? 0) / (me?.maxStamina ?? 100)) * 100}%` }} />
          <span><Icon name="stamina" size={13} /> {Math.floor(me?.stamina ?? 0)} / {me?.maxStamina ?? 100}</span>
        </div>
      </div>

      <nav className="hud-menu" aria-label="Game menu">
        <button className="icon-btn" onClick={onGuide} title="How to play" aria-label="How to play"><Icon name="book" size={22} /></button>
        <button className="icon-btn" onClick={onLeaders} title="Leaderboard" aria-label="Leaderboard"><Icon name="rosette" size={22} /></button>
        <button className="icon-btn" onClick={onGfx} title={gfx === '3d' ? 'Switch to the flat map (lighter on old devices)' : 'Switch to the 3D island'} aria-label={gfx === '3d' ? 'Flat map' : '3D island'}><Icon name={gfx === '3d' ? 'map' : 'island'} size={22} /></button>
        <button className={`icon-btn ${musicOn ? '' : 'off'}`} onClick={() => { setMusicOn(!musicOn); setMusic(!musicOn); }} title={musicOn ? 'Music on' : 'Music off'} aria-label="Music" aria-pressed={musicOn}><Icon name="music" size={22} /></button>
        <button className="icon-btn" onClick={() => { setMuted(!muted); setM(!muted); }} title={muted ? 'Sound off' : 'Sound on'} aria-label="Sound" aria-pressed={!muted}><Icon name={muted ? 'mute' : 'sound'} size={22} /></button>
        <button className="icon-btn" onClick={onEarnings} title="Your ledger" aria-label="Your ledger"><Icon name="sack" size={22} /></button>
        <button className="icon-btn" onClick={onAccount} title="Your account: recovery words and log out" aria-label="Your account"><Icon name="key" size={22} /></button>
      </nav>
    </header>
  );
}

export function QuestTracker({ world, onGo }: { world: World; onGo: () => void }) {
  const me = world.me;
  if (!me) return null;
  const done = me.quests.filter(q => q.done).length;
  const q = me.current;
  return (
    <aside className="quest" aria-live="polite">
      <div className="quest-head">
        <span className="with-icon"><Icon name="scroll" /> {q ? 'Quest' : 'Quests complete'}</span>
        <span className="dots" aria-label={`${done} of ${me.quests.length} done`}>
          {me.quests.map(x => <i key={x.id} className={x.done ? 'on' : ''} />)}
        </span>
      </div>
      {q ? (
        <>
          <strong>{q.title}</strong>
          <p>{q.hint}</p>
          <button className="small primary" onClick={onGo}>Show me <span className="xp-pill">+{q.xp} XP</span></button>
        </>
      ) : (
        <p>You’ve learned the town. Now own it: win deeds, lead a guild, keep the Festival streak alive.</p>
      )}
    </aside>
  );
}
