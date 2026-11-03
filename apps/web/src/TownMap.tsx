// The town map is the main screen: every place in Meridian, drawn in SVG, clickable.
// Shops show what they pay and what their keeper last said; the map darkens as the day ends.
import { useEffect, useState } from 'react';
import type { World } from './App';
import { ICON, ITEMS, KEEPERS, meri, type Item } from './types';

export type Place =
  | 'g:forest' | 'g:mine' | 'g:fields'
  | `s:${string}`
  | 'board' | 'caravan' | 'guildhall' | 'auction' | 'cottage' | 'festival';

export const W = 1000;
export const H = 680;

/** Where each place sits on the map (centre of its hit area). */
export const SPOTS: Record<string, { x: number; y: number; label: string }> = {
  'g:forest': { x: 170, y: 120, label: 'The Forest' },
  'g:mine': { x: 500, y: 110, label: 'The Mine' },
  'g:fields': { x: 830, y: 120, label: 'The Fields' },
  's:lumberyard': { x: 330, y: 268, label: 'Lumberyard' },
  's:mine': { x: 500, y: 250, label: 'Mine Office' },
  's:granary': { x: 670, y: 268, label: 'Granary' },
  's:smith': { x: 330, y: 448, label: 'Forge' },
  's:baker': { x: 500, y: 468, label: 'Bakery' },
  's:store': { x: 670, y: 448, label: 'General Store' },
  guildhall: { x: 95, y: 300, label: 'Guild Hall' },
  auction: { x: 95, y: 470, label: 'Auction House' },
  caravan: { x: 912, y: 360, label: 'Caravan Road' },
  cottage: { x: 175, y: 590, label: 'Your Cottage' },
  board: { x: 410, y: 588, label: 'Notice Board' },
  festival: { x: 800, y: 585, label: 'Festival Stage' },
};

const ROOF: Record<string, string> = { lumberyard: '#8b5a2b', mine: '#5b6470', granary: '#b7862b', smith: '#3f4651', baker: '#b5532a', store: '#6f4fa8' };

function useTick(ms: number) {
  const [n, setN] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setN(x => x + 1), ms);
    return () => clearInterval(t);
  }, [ms]);
  return n;
}

/** The price signs: the goods a shop pays most for (×reference), or sells, at a glance. */
function signFor(world: World, shopId: string): { text: string; hot: boolean } {
  const s = world.shops.find(x => x.shop.id === shopId);
  if (!s) return { text: '', hot: false };
  if (!s.shop.open) return { text: s.auction ? 'AT AUCTION' : 'CLOSED', hot: false };
  const base = (i: number) => meri(world.params.base[i]);
  const buys = ITEMS.map((item, i) => ({ item, i, v: meri(s.bid[i]) })).filter(x => x.v > 0).sort((a, b) => b.v / base(b.i) - a.v / base(a.i));
  if (buys.length && ['wood', 'ore', 'wheat'].includes(buys[0].item)) {
    const top = buys[0];
    return { text: `pays ${top.v.toFixed(2)} ${ICON[top.item as Item]}`, hot: top.v / base(top.i) >= 1.5 };
  }
  const sells = ITEMS.map((item, i) => ({ item, v: meri(s.ask[i]) })).filter(x => x.v > 0);
  return { text: sells.map(x => `${ICON[x.item as Item]} ${x.v.toFixed(2)}`).slice(0, 2).join('  '), hot: false };
}

export function TownMap({ world, onOpen, selected, questPlace, here }: {
  world: World;
  onOpen: (p: Place) => void;
  selected: Place | null;
  questPlace: Place | null;
  here: Place | null;
}) {
  const tick = useTick(6000);
  const { genesisMs, dayMs, skewMs } = world.clock;
  const intoDay = (((Date.now() - skewMs - genesisMs) % dayMs) + dayMs) % dayMs / dayMs;
  const night = intoDay < 0.7 ? 0 : intoDay < 0.85 ? ((intoDay - 0.7) / 0.15) * 0.28 : 0.28 + ((intoDay - 0.85) / 0.15) * 0.12;

  // Town chatter: rotate through merchants who spoke in the last 15 minutes.
  const recent = Object.values(world.agents ?? {}).filter(a => Date.now() - a.at < 15 * 60_000).sort((a, b) => b.at - a.at);
  const speaker = recent.length ? recent[tick % recent.length] : null;

  const groundLeft = (i: number) => world.town.grounds[i] / (world.params.ground_regen_per_day[i] * world.params.ground_capacity_days);
  const caravanOpen = !!world.caravan?.round;
  const jobs = world.jobs.length;
  const festivalPct = Math.min(1, meri(world.town.week_counted) / meri(world.town.week_target));

  const place = (id: Place, children: React.ReactNode) => (
    <g
      className={`place ${selected === id ? 'selected' : ''}`}
      role="button"
      tabIndex={0}
      aria-label={SPOTS[id].label}
      onClick={() => onOpen(id)}
      onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onOpen(id))}
    >
      {children}
      <text className="map-label" x={SPOTS[id].x} y={SPOTS[id].y + (id.startsWith('g:') ? 72 : id.startsWith('s:') ? 70 : 58)} textAnchor="middle">{SPOTS[id].label}</text>
    </g>
  );

  const shop = (id: string) => {
    const { x, y } = SPOTS[`s:${id}`];
    const s = world.shops.find(z => z.shop.id === id);
    const sign = signFor(world, id);
    return place(`s:${id}`, (
      <>
        <rect className="hit" x={x - 70} y={y - 55} width={140} height={120} rx={10} />
        <rect x={x - 42} y={y - 18} width={84} height={46} fill="#efe3c8" stroke="#6b4f2a" strokeWidth={2} />
        <polygon points={`${x - 52},${y - 16} ${x},${y - 50} ${x + 52},${y - 16}`} fill={ROOF[id]} stroke="#3b2a17" strokeWidth={2} />
        <rect x={x - 9} y={y + 6} width={18} height={22} fill="#6b4f2a" />
        <rect x={x - 34} y={y - 8} width={16} height={12} fill={night > 0.15 ? '#ffd27a' : '#bcd4e6'} stroke="#6b4f2a" />
        <rect x={x + 18} y={y - 8} width={16} height={12} fill={night > 0.15 ? '#ffd27a' : '#bcd4e6'} stroke="#6b4f2a" />
        {!s?.shop.open && <line x1={x - 42} y1={y + 28} x2={x + 42} y2={y - 18} stroke="#a8322d" strokeWidth={4} />}
        <g className={`sign ${sign.hot ? 'hot' : ''}`}>
          <rect x={x - 54} y={y + 31} width={108} height={20} rx={4} />
          <text x={x} y={y + 45} textAnchor="middle">{sign.text}</text>
        </g>
      </>
    ));
  };

  return (
    <svg className="town" viewBox={`0 0 ${W} ${H}`} role="group" aria-label="Map of Meridian Town">
      <defs>
        <radialGradient id="grass" cx="50%" cy="45%" r="70%">
          <stop offset="0%" stopColor="#b5d38f" />
          <stop offset="100%" stopColor="#8fb36c" />
        </radialGradient>
        <pattern id="cobble" width="18" height="18" patternUnits="userSpaceOnUse">
          <rect width="18" height="18" fill="#d8c6a0" />
          <circle cx="5" cy="5" r="3.2" fill="#ccb88e" />
          <circle cx="14" cy="13" r="3.6" fill="#c9b48a" />
        </pattern>
        <pattern id="wheat" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-8)">
          <rect width="14" height="14" fill="#e3c25a" />
          <rect width="14" height="4" fill="#cfa83f" />
        </pattern>
      </defs>

      <rect width={W} height={H} fill="url(#grass)" />
      {/* roads */}
      <g className="roads" stroke="#e6d3a5" strokeWidth={26} strokeLinecap="round" fill="none">
        <path d="M500 355 L500 150" />
        <path d="M500 355 C 400 300, 260 200, 190 160" />
        <path d="M500 355 C 600 300, 740 200, 810 160" />
        <path d="M500 355 L1000 360" />
        <path d="M500 355 L95 300 M500 355 L95 470" />
        <path d="M500 355 C 420 480, 260 560, 175 590" />
        <path d="M500 355 L410 588 M500 355 C 600 470, 740 560, 800 585" />
      </g>
      <circle cx={500} cy={355} r={150} fill="url(#cobble)" stroke="#bfa678" strokeWidth={4} />

      {/* fountain */}
      <circle cx={500} cy={355} r={30} fill="#a9c9d9" stroke="#7a8f9a" strokeWidth={4} />
      <circle cx={500} cy={355} r={9} fill="#e9f3f7" className="fountain" />

      {/* grounds */}
      {place('g:forest', (
        <>
          <rect className="hit" x={60} y={40} width={230} height={150} rx={14} />
          {[[95, 95], [140, 70], [190, 95], [235, 75], [120, 140], [170, 130], [220, 145], [265, 120]].map(([x, y], i) => (
            <g key={i} opacity={i / 8 < groundLeft(0) + 0.15 ? 1 : 0.35}>
              <rect x={x - 3} y={y + 10} width={6} height={16} fill="#6b4f2a" />
              <circle cx={x} cy={y} r={22} fill={i % 2 ? '#3f7a3a' : '#4f8f45'} stroke="#2f5d2b" strokeWidth={2} />
            </g>
          ))}
        </>
      ))}
      {place('g:mine', (
        <>
          <rect className="hit" x={385} y={35} width={230} height={150} rx={14} />
          <path d="M395 170 L470 55 L540 85 L605 170 Z" fill="#9a8f80" stroke="#5f574c" strokeWidth={3} />
          <path d="M470 170 L470 135 Q500 110 530 135 L530 170 Z" fill="#2c2620" />
          {Array.from({ length: Math.max(0, Math.round(groundLeft(1) * 6)) }, (_, i) => (
            <circle key={i} cx={430 + i * 28} cy={162 - (i % 2) * 8} r={6} fill="#c96f3b" stroke="#7d3f1d" />
          ))}
        </>
      ))}
      {place('g:fields', (
        <>
          <rect className="hit" x={710} y={40} width={240} height={150} rx={14} />
          <rect x={725} y={60} width={210} height={115} rx={8} fill="url(#wheat)" stroke="#a7852e" strokeWidth={3} opacity={0.35 + 0.65 * groundLeft(2)} />
        </>
      ))}

      {['lumberyard', 'mine', 'granary', 'smith', 'baker', 'store'].map(id => <g key={id}>{shop(id)}</g>)}

      {place('guildhall', (
        <>
          <rect className="hit" x={20} y={235} width={150} height={120} rx={10} />
          <rect x={45} y={268} width={100} height={52} fill="#e8dcc0" stroke="#6b4f2a" strokeWidth={2} />
          <polygon points="38,270 95,238 152,270" fill="#2f5d7a" stroke="#1f3d52" strokeWidth={2} />
          <rect x={58} y={280} width={10} height={40} fill="#c9b07a" />
          <rect x={122} y={280} width={10} height={40} fill="#c9b07a" />
          <path d="M78 286 l0 18 l6 -5 l6 5 l0 -18 z" fill="#a8322d" />
          <path d="M100 286 l0 18 l6 -5 l6 5 l0 -18 z" fill="#b7862b" />
          {(world.guildViews?.length ?? 0) > 0 && <text className="badge" x={150} y={258}>{world.guildViews.length}</text>}
        </>
      ))}
      {place('auction', (
        <>
          <rect className="hit" x={20} y={405} width={150} height={120} rx={10} />
          <rect x={48} y={440} width={94} height={48} fill="#efe3c8" stroke="#6b4f2a" strokeWidth={2} />
          <polygon points="40,442 95,412 150,442" fill="#7a2f2f" stroke="#4a1c1c" strokeWidth={2} />
          <rect x={82} y={452} width={26} height={8} rx={2} fill="#6b4f2a" transform="rotate(-25 95 456)" />
          <rect x={92} y={458} width={5} height={22} fill="#6b4f2a" transform="rotate(-25 95 456)" />
          {world.auctions.length > 0 && <text className="badge" x={150} y={428}>{world.auctions.length}</text>}
        </>
      ))}
      {place('caravan', (
        <>
          <rect className="hit" x={835} y={300} width={160} height={120} rx={10} />
          <path d="M860 330 L860 395 M965 330 L965 395 M852 330 Q912 300 972 330" stroke="#6b4f2a" strokeWidth={8} fill="none" />
          {caravanOpen && [0, 1].map(i => (
            <g key={i} className="wagon" transform={`translate(${880 + i * 52} ${352})`}>
              <rect x={-18} y={-14} width={40} height={22} rx={6} fill="#efe3c8" stroke="#6b4f2a" strokeWidth={2} />
              <circle cx={-8} cy={10} r={6} fill="#3b2a17" />
              <circle cx={14} cy={10} r={6} fill="#3b2a17" />
            </g>
          ))}
          {caravanOpen && <text className="badge" x={985} y={318}>{world.caravan!.round!.commits.reduce((a, b) => a + b, 0)}</text>}
        </>
      ))}
      {place('cottage', (
        <>
          <rect className="hit" x={100} y={525} width={150} height={100} rx={10} />
          <rect x={148} y={566} width={56} height={34} fill="#efe3c8" stroke="#6b4f2a" strokeWidth={2} />
          <polygon points="140,568 176,542 212,568" fill="#9b3d3d" stroke="#5b2121" strokeWidth={2} />
          <rect x={170} y={580} width={12} height={20} fill="#6b4f2a" />
          <rect x={194} y={546} width={8} height={14} fill="#6b4f2a" />
          {(world.me?.cottage?.level ?? 1) >= 2 && <circle className="smoke" cx={198} cy={536} r={6} fill="#ffffff" opacity={0.7} />}
          <text className="badge" x={232} y={548}>L{world.me?.cottage?.level ?? 1}</text>
        </>
      ))}
      {place('board', (
        <>
          <rect className="hit" x={345} y={535} width={130} height={95} rx={10} />
          <rect x={370} y={556} width={80} height={46} fill="#a77b4a" stroke="#6b4f2a" strokeWidth={3} />
          <rect x={376} y={600} width={6} height={20} fill="#6b4f2a" />
          <rect x={438} y={600} width={6} height={20} fill="#6b4f2a" />
          {Array.from({ length: Math.min(4, jobs) }, (_, i) => (
            <rect key={i} x={377 + i * 18} y={562 + (i % 2) * 6} width={14} height={18} fill="#fffaf0" stroke="#c9b48a" transform={`rotate(${(i % 2 ? 6 : -5)} ${384 + i * 18} 571)`} />
          ))}
          {jobs > 0 && <text className="badge" x={460} y={552}>{jobs}</text>}
        </>
      ))}
      {place('festival', (
        <>
          <rect className="hit" x={720} y={525} width={165} height={100} rx={10} />
          <rect x={740} y={580} width={120} height={22} fill="#a77b4a" stroke="#6b4f2a" strokeWidth={2} />
          <path d="M740 555 Q770 570 800 555 Q830 570 860 555" stroke="#6b4f2a" strokeWidth={2} fill="none" />
          {[750, 770, 790, 810, 830, 850].map((x, i) => <polygon key={x} points={`${x},${558 + (i % 2) * 3} ${x + 8},${558 + (i % 2) * 3} ${x + 4},${570}`} fill={['#a8322d', '#b7862b', '#2f7d4f', '#2f5d7a'][i % 4]} />)}
          <rect x={745} y={606} width={110} height={8} rx={4} fill="#ffffff" opacity={0.6} />
          <rect x={745} y={606} width={110 * festivalPct} height={8} rx={4} fill={festivalPct >= 1 ? '#2f7d4f' : '#b7862b'} />
        </>
      ))}

      {/* quest marker and "you are here" */}
      {questPlace && SPOTS[questPlace] && (
        <circle className="quest-ring" cx={SPOTS[questPlace].x} cy={SPOTS[questPlace].y} r={64} />
      )}
      {here && SPOTS[here] && (
        <g className="here" transform={`translate(${SPOTS[here].x + 48} ${SPOTS[here].y - 40})`}>
          <path d="M0 0 C -10 -14 -10 -26 0 -26 C 10 -26 10 -14 0 0 Z" fill="#2f5d7a" stroke="#fff" strokeWidth={2} />
          <circle cy={-17} r={4} fill="#fff" />
        </g>
      )}

      {/* night */}
      <rect width={W} height={H} fill="#0d1b3d" opacity={night} pointerEvents="none" />
      {night > 0.1 && [[430, 300], [570, 300], [430, 410], [570, 410]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={10} fill="#ffd27a" opacity={night * 2} pointerEvents="none" />
      ))}

      {/* merchant chatter */}
      {speaker && SPOTS[`s:${speaker.shopId}`] && (() => {
        const { x, y } = SPOTS[`s:${speaker.shopId}`];
        const text = speaker.say.replace(/^[A-Z][a-z]+:\s*/, '');
        const short = text.length > 58 ? text.slice(0, 56) + '…' : text;
        const w = Math.min(330, 30 + short.length * 6.2);
        const bx = Math.max(10, Math.min(W - w - 10, x - w / 2));
        return (
          <g className="bubble" key={`${speaker.shopId}${speaker.at}`} pointerEvents="none">
            <rect x={bx} y={y - 100} width={w} height={34} rx={10} />
            <polygon points={`${x - 8},${y - 67} ${x + 8},${y - 67} ${x},${y - 56}`} />
            <text x={bx + 12} y={y - 79}><tspan className="who">{KEEPERS[speaker.shopId]?.keeper}:</tspan> {short}</text>
          </g>
        );
      })()}
    </svg>
  );
}
