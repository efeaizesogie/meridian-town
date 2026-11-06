// Meridian's own icon set: small paper-cut shapes in the town's colours with an ink outline,
// drawn on a 20-unit grid so they sit on the same baseline as the text beside them.
// Colours come from the theme tokens in styles.css (.ic-* classes), never from here.

export type IconName =
  | 'wood' | 'ore' | 'wheat' | 'bread' | 'tool'
  | 'coin' | 'stamina' | 'book' | 'rosette' | 'map' | 'island' | 'music' | 'sound' | 'mute'
  | 'door' | 'close' | 'scroll' | 'flag' | 'sack' | 'sun' | 'dusk' | 'moon' | 'forward'
  | 'axe' | 'pick' | 'sickle' | 'house' | 'key' | 'more' | 'plus' | 'minus';

const P: Record<IconName, React.ReactNode> = {
  wood: <>
    <rect className="ic-kraft" x="2" y="6" width="14" height="8" rx="3" />
    <ellipse className="ic-sand" cx="15.5" cy="10" rx="2.6" ry="4" />
    <ellipse className="ic-line" cx="15.5" cy="10" rx="1" ry="1.6" />
    <path className="ic-line" d="M5 9h6M6 12h5" />
  </>,
  ore: <>
    <path className="ic-stone" d="M3 13 6 5l6-2 5 5-1 7-8 2z" />
    <path className="ic-sugar" d="M6 5l6-2-1 5z" />
    <path className="ic-line" d="M11 8l5 0M11 8l-3 9" />
  </>,
  wheat: <>
    <path className="ic-line" d="M10 18V5" />
    {[6, 9, 12].map(y => <g key={y}><ellipse className="ic-sand" cx="7.6" cy={y} rx="2.2" ry="1.3" transform={`rotate(-35 7.6 ${y})`} /><ellipse className="ic-sand" cx="12.4" cy={y} rx="2.2" ry="1.3" transform={`rotate(35 12.4 ${y})`} /></g>)}
    <ellipse className="ic-sand" cx="10" cy="3.6" rx="1.3" ry="2" />
  </>,
  bread: <>
    <path className="ic-kraft" d="M2.5 14c0-5 3.5-8 7.5-8s7.5 3 7.5 8c0 1-.6 1.6-1.6 1.6H4.1c-1 0-1.6-.6-1.6-1.6z" />
    <path className="ic-line" d="M6.5 9.5l1.5 2.5M9.5 8.5 11 11M12.5 9.5 14 12" />
  </>,
  tool: <>
    <path className="ic-kraft" d="M4 17.5 11 10.5l1.5 1.5-7 7z" />
    <path className="ic-stone" d="M9 5.5 12.5 2l5.5 5.5-3.5 3.5z" />
  </>,
  coin: <>
    <circle className="ic-pear" cx="10" cy="10" r="7.5" />
    <circle className="ic-line" cx="10" cy="10" r="5" />
    <path className="ic-line" d="M8 12.5v-5l2 2.5 2-2.5v5" />
  </>,
  stamina: <path className="ic-mint" d="M11.5 2 4.5 11h4.5l-1 7 7-9.5h-4.5z" />,
  book: <>
    <path className="ic-card" d="M2.5 4.5c3-1 5.5-.5 7.5 1v11c-2-1.5-4.5-2-7.5-1z" />
    <path className="ic-card" d="M17.5 4.5c-3-1-5.5-.5-7.5 1v11c2-1.5 4.5-2 7.5-1z" />
    <path className="ic-line" d="M5 8h3M5 10.5h3M12 8h3M12 10.5h3" />
  </>,
  rosette: <>
    <path className="ic-coral" d="M7 11 5 18l3-1.5 1.5 2L11 12zM13 11l2 7-3-1.5-1.5 2L9 12z" />
    <circle className="ic-pear" cx="10" cy="8" r="5.5" />
    <circle className="ic-line" cx="10" cy="8" r="3" />
  </>,
  map: <>
    <path className="ic-card" d="M2.5 5 7 3l6 2 4.5-2v12L13 17l-6-2-4.5 2z" />
    <path className="ic-line" d="M7 3v12M13 5v12" />
    <path className="ic-coral" d="M9 9.5a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0" />
  </>,
  island: <>
    <path className="ic-sugar" d="M1.5 15.5h17v2h-17z" />
    <path className="ic-mint" d="M3.5 15.5c1.5-4 4-6 6.5-6s5 2 6.5 6z" />
    <path className="ic-line" d="M12 11V5.5" />
    <path className="ic-mint" d="M12 5.5c-1.5-1.5-3.5-1.5-5 0 1.5.2 3 .5 5 0zM12 5.5c1.5-1.5 3.5-1.5 5 0-1.5.2-3 .5-5 0z" />
  </>,
  music: <>
    <path className="ic-line" d="M8 15V4l8-1.5V13" />
    <ellipse className="ic-blue" cx="6" cy="15" rx="2.6" ry="2" />
    <ellipse className="ic-blue" cx="14" cy="13" rx="2.6" ry="2" />
  </>,
  sound: <>
    <path className="ic-card" d="M3 7.5h3l4.5-4v13L6 12.5H3z" />
    <path className="ic-line" d="M13 7a4.5 4.5 0 0 1 0 6M15.5 4.5a8 8 0 0 1 0 11" />
  </>,
  mute: <>
    <path className="ic-card" d="M3 7.5h3l4.5-4v13L6 12.5H3z" />
    <path className="ic-line" d="M13 7.5l5 5M18 7.5l-5 5" />
  </>,
  door: <>
    <path className="ic-kraft" d="M5 18V3.5h10V18" />
    <path className="ic-line" d="M3 18h14" />
    <circle className="ic-pear" cx="12.3" cy="11" r="1.1" />
  </>,
  close: <path className="ic-line ic-thick" d="M5 5l10 10M15 5 5 15" />,
  more: <>
    <circle className="ic-pear" cx="4" cy="10" r="2" />
    <circle className="ic-pear" cx="10" cy="10" r="2" />
    <circle className="ic-pear" cx="16" cy="10" r="2" />
  </>,
  plus: <path className="ic-line ic-thick" d="M10 4v12M4 10h12" />,
  minus: <path className="ic-line ic-thick" d="M4 10h12" />,
  scroll: <>
    <path className="ic-card" d="M5 4h10v12H5z" />
    <path className="ic-sand" d="M3.5 3.5h13a1.5 1.5 0 0 1 0 3h-13a1.5 1.5 0 0 1 0-3zM3.5 14.5h13a1.5 1.5 0 0 1 0 3h-13a1.5 1.5 0 0 1 0-3z" />
    <path className="ic-line" d="M7.5 9h5M7.5 11.5h4" />
  </>,
  flag: <>
    <path className="ic-line" d="M4 18V2.5" />
    <path className="ic-coral" d="M4 3h11l-3 3.5L15 10H4z" />
  </>,
  sack: <>
    <path className="ic-kraft" d="M7 6h6l1-2.5H6zM6.5 6.5C3.5 9 3 13 4.5 16c.6 1.2 1.8 1.8 3 1.8h5c1.2 0 2.4-.6 3-1.8 1.5-3 1-7-2-9.5z" />
    <circle className="ic-pear" cx="10" cy="12" r="2.2" />
  </>,
  sun: <>
    <circle className="ic-pear" cx="10" cy="10" r="4" />
    <path className="ic-line" d="M10 1.5v2.5M10 16v2.5M1.5 10H4M16 10h2.5M4 4l1.8 1.8M14.2 14.2 16 16M4 16l1.8-1.8M14.2 5.8 16 4" />
  </>,
  dusk: <>
    <path className="ic-coral" d="M4 14a6 6 0 0 1 12 0z" />
    <path className="ic-line" d="M1.5 14h17M3.5 17h13M10 3.5V6M3.5 7.5l1.8 1.8M16.5 7.5l-1.8 1.8" />
  </>,
  moon: <path className="ic-sugar" d="M13.5 15.5A6.5 6.5 0 0 1 8.5 3a6.5 6.5 0 1 0 8.5 9 6.4 6.4 0 0 1-3.5 3.5z" />,
  forward: <path className="ic-pear" d="M2.5 4.5 10 10l-7.5 5.5zM10 4.5l7.5 5.5-7.5 5.5z" />,
  axe: <>
    <path className="ic-kraft" d="M5 18.5 13 6l1.5 1-8 12.5z" />
    <path className="ic-stone" d="M11 4.5c2-2.5 5.5-3 7-1.5.5 3-1 5.5-3.5 6.5z" />
  </>,
  pick: <>
    <path className="ic-kraft" d="M4.5 18 11 8.5l1.5 1L6 19z" />
    <path className="ic-stone" d="M3 7c4-4.5 10-4.5 14 0l-1.2 1.2C12.5 5 7.5 5 4.2 8.2z" />
  </>,
  sickle: <>
    <path className="ic-stone" d="M8 13C3 11 3 4 9 2.5c-3 2.5-3 7 1.5 8.8z" />
    <path className="ic-kraft" d="M9 12.5l1.8-1.3 5.5 6.3-1.8 1.3z" />
  </>,
  key: <>
    <circle className="ic-pear" cx="6.5" cy="10" r="4" />
    <circle className="ic-card" cx="6.5" cy="10" r="1.4" />
    <path className="ic-kraft" d="M10 8.8h8v2.4h-1.5v2.3h-2v-2.3H10z" />
  </>,
  house: <>
    <path className="ic-coral" d="M2.5 9.5 10 3l7.5 6.5z" />
    <path className="ic-card" d="M4.5 9.5h11V17h-11z" />
    <path className="ic-kraft" d="M8.5 12.5h3V17h-3z" />
  </>,
};

/** One icon from the set; decorative unless given a label. */
export function Icon({ name, label, size = 18 }: { name: IconName; label?: string; size?: number }) {
  return (
    <svg className="icon" viewBox="0 0 20 20" width={size} height={size} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true}>
      {P[name]}
    </svg>
  );
}
