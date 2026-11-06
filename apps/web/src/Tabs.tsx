// The phone's bottom tab bar: the five things a player reaches for, within a thumb's reach.
// Everything else (how to play, leaders, settings, account) lives under More.
import { useEffect, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { isMuted, isMusicOn, setMuted, setMusicOn } from './juice';
import { useInstall } from './phone';

export type Tab = 'town' | 'quest' | 'pack' | 'ledger';

export function TabBar({ active, onTab, gfx, onGfx, onGuide, onLeaders, onAccount, onFastForward, onBooks, onMarks }: {
  onBooks: () => void;
  onMarks: () => void;
  active: Tab | null;
  onTab: (t: Tab) => void;
  gfx: '3d' | '2d';
  onGfx: () => void;
  onGuide: () => void;
  onLeaders: () => void;
  onAccount: () => void;
  onFastForward: () => void;
}) {
  const [more, setMore] = useState(false);
  const [muted, setM] = useState(isMuted());
  const [musicOn, setMusic] = useState(isMusicOn());
  const { can, install } = useInstall();

  useEffect(() => {
    if (!more) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setMore(false);
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [more]);

  const tab = (id: Tab, icon: IconName, label: string) => (
    <button className={active === id && !more ? 'on' : ''} aria-current={active === id ? 'page' : undefined}
      onClick={() => { setMore(false); onTab(id); }}>
      <Icon name={icon} size={24} /><span>{label}</span>
    </button>
  );
  const row = (icon: IconName, label: string, run: () => void, note?: string) => (
    <button className="more-row" onClick={() => { setMore(false); run(); }}>
      <Icon name={icon} size={22} /><span>{label}{note && <small>{note}</small>}</span>
    </button>
  );

  return (
    <>
      {more && <div className="more-backdrop" onClick={() => setMore(false)} />}
      {more && (
        <div className="more-sheet" role="menu" aria-label="More">
          {row('book', 'How to play', onGuide)}
          {row('rosette', 'Leaderboard', onLeaders)}
          {row('scroll', 'Town books', onBooks, 'Where every coin is, and town records')}
          {row('flag', 'Your marks', onMarks, 'The collection: earn all twelve')}
          {row('forward', 'Fast-forward a week', onFastForward, 'Replay the next market week in a minute')}
          {row(gfx === '3d' ? 'map' : 'island', gfx === '3d' ? 'Flat map' : '3D island', onGfx, gfx === '3d' ? 'Lighter on older phones' : undefined)}
          <div className="more-toggles">
            <button className={musicOn ? 'on' : ''} aria-pressed={musicOn} onClick={() => { setMusicOn(!musicOn); setMusic(!musicOn); }}>
              <Icon name="music" size={20} /> Music {musicOn ? 'on' : 'off'}
            </button>
            <button className={!muted ? 'on' : ''} aria-pressed={!muted} onClick={() => { setMuted(!muted); setM(!muted); }}>
              <Icon name={muted ? 'mute' : 'sound'} size={20} /> Sound {muted ? 'off' : 'on'}
            </button>
          </div>
          {can === 'prompt' && row('house', 'Add to home screen', () => { install(); }, 'Opens full screen, like an app')}
          {can === 'ios' && (
            <p className="more-hint"><Icon name="house" size={20} /> <span>To add Meridian to your home screen, tap <b>Share</b> in Safari, then <b>Add to Home Screen</b>.</span></p>
          )}
          {row('key', 'Account', onAccount, 'Recovery words and log out')}
        </div>
      )}
      <nav className="tabbar" aria-label="Game">
        {tab('town', 'map', 'Town')}
        {tab('quest', 'scroll', 'Quest')}
        {tab('pack', 'house', 'Pack')}
        {tab('ledger', 'sack', 'Ledger')}
        <button className={more ? 'on' : ''} aria-expanded={more} onClick={() => setMore(m => !m)}>
          <Icon name="more" size={24} /><span>More</span>
        </button>
      </nav>
    </>
  );
}
