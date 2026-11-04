// Every place on the island as a little diorama that reflects the live game: the forest
// thins as it's cut, ore crystals shrink with the mine's stock, contracts pin to the board.
import { useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import type { World } from '../App';
import { SPOTS, type Place } from '../TownMap';
import { KEEPERS, meri } from '../types';
import { at, PALETTE, ROOFS } from './layout';
import { House, LogPile, Mat, Ore, Person, Rock, Roof, Tree, Wagon, WheatField, Lantern } from './models';

type V3 = [number, number, number];

/** Rotation that turns a place's front (+z) toward the fountain. */
const faceCentre = (p: V3) => Math.atan2(-p[0], -p[2]);

/** A clickable place: hover lift, a ring for hover / selection / quest, and its name. */
export function Spot({ place, onOpen, selected, quest, children, ring = 3.2, labelY = 3.6, sign, hot, scale = 1.45 }: {
  scale?: number;
  place: Place;
  onOpen: (p: Place) => void;
  selected: boolean;
  quest: boolean;
  children: React.ReactNode;
  ring?: number;
  labelY?: number;
  sign?: string;
  hot?: boolean;
}) {
  const [hover, setHover] = useState(false);
  const lift = useRef<THREE.Group>(null);
  const halo = useRef<THREE.Mesh>(null);
  const pos = at(place);
  useFrame(({ clock }, dt) => {
    if (lift.current) lift.current.position.y = THREE.MathUtils.damp(lift.current.position.y, hover ? 0.18 : 0, 10, dt);
    if (halo.current) {
      const s = quest ? 1 + Math.sin(clock.elapsedTime * 3) * 0.06 : 1;
      halo.current.scale.setScalar(s);
    }
  });
  const ringColor = quest ? '#ffc94d' : selected ? '#fff4d6' : '#ffffff';
  return (
    <group position={pos}>
      <group
        ref={lift}
        onPointerOver={e => { e.stopPropagation(); setHover(true); document.body.style.cursor = 'pointer'; }}
        onPointerOut={() => { setHover(false); document.body.style.cursor = ''; }}
        onClick={e => { e.stopPropagation(); onOpen(place); }}
      >
        <group scale={scale}>{children}</group>
      </group>
      {(hover || selected || quest) && (
        <mesh ref={halo} rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.06, 0]}>
          <ringGeometry args={[ring * scale, ring * scale + 0.3, 48]} />
          <meshBasicMaterial color={ringColor} transparent opacity={quest ? 0.95 : 0.7} toneMapped={false} />
        </mesh>
      )}
      <Html position={[0, labelY * scale, 0]} center zIndexRange={[30, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`label3d ${hover || selected ? 'on' : ''}`}>
          <span>{SPOTS[place].label}</span>
          {sign && <b className={hot ? 'hot' : ''}>{sign}</b>}
        </div>
      </Html>
      {quest && (
        <Html position={[0, labelY * scale + 1.8, 0]} center style={{ pointerEvents: 'none' }}>
          <div className="quest3d">!</div>
        </Html>
      )}
    </group>
  );
}

// ---------- shops ----------

export function ShopModel({ id, world, night }: { id: string; world: World; night: number }) {
  const s = world.shops.find(x => x.shop.id === id);
  const open = s?.shop.open ?? true;
  const lit = open ? night : 0;
  const pos = at(`s:${id}`);
  const props: Record<string, React.ReactNode> = {
    lumberyard: <><LogPile position={[1.9, 0, 0.4]} /><LogPile position={[-1.9, 0, -0.2]} /></>,
    mine: (
      <group position={[1.8, 0, 0.6]}>
        <mesh position={[0, 0.35, 0]} castShadow><boxGeometry args={[0.9, 0.45, 0.6]} /><Mat color={PALETTE.woodDark} /></mesh>
        {[0, 1, 2].map(i => <Ore key={i} position={[(i - 1) * 0.25, 0.7, 0]} scale={0.6} />)}
      </group>
    ),
    granary: (
      <group position={[-2, 0, -0.2]}>
        <mesh position={[0, 1.3, 0]} castShadow><cylinderGeometry args={[0.75, 0.8, 2.6, 12]} /><Mat color="#e6d2a2" /></mesh>
        <mesh position={[0, 2.9, 0]} castShadow><coneGeometry args={[0.95, 0.9, 12]} /><Mat color={ROOFS.granary} /></mesh>
      </group>
    ),
    smith: (
      <group position={[1.8, 0, 0.7]}>
        <mesh position={[0, 0.45, 0]} castShadow><boxGeometry args={[0.6, 0.5, 0.35]} /><Mat color="#3a3f47" rough={0.5} /></mesh>
        <mesh position={[-0.9, 0.4, -0.2]} castShadow><boxGeometry args={[0.8, 0.8, 0.8]} /><Mat color={PALETTE.stone} /></mesh>
        <mesh position={[-0.9, 0.55, 0.21]}><boxGeometry args={[0.4, 0.3, 0.02]} /><Mat color="#ff8a3d" emissive="#ff6a1a" intensity={open ? 3 : 0} /></mesh>
        {open && <pointLight position={[-0.9, 0.7, 0.8]} color="#ff7a30" intensity={3 + night * 6} distance={5} />}
      </group>
    ),
    baker: (
      <group position={[-1.9, 0, 0.4]}>
        <mesh position={[0, 0.5, 0]} castShadow><sphereGeometry args={[0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><Mat color="#c9a27a" /></mesh>
        <mesh position={[0, 0.3, 0.68]}><boxGeometry args={[0.4, 0.3, 0.04]} /><Mat color="#ffb35a" emissive="#ff8c1a" intensity={open ? 2.5 : 0} /></mesh>
      </group>
    ),
    store: (
      <group position={[0, 1.15, 1.25]}>
        {[0, 1, 2, 3, 4, 5].map(i => (
          <mesh key={i} position={[-1.05 + i * 0.42, 0, 0]} rotation={[0.45, 0, 0]} castShadow>
            <boxGeometry args={[0.42, 0.04, 0.8]} />
            <Mat color={i % 2 ? '#f1e6cc' : ROOFS.store} />
          </mesh>
        ))}
      </group>
    ),
  };
  return (
    <group rotation={[0, faceCentre(pos), 0]}>
      <House roof={ROOFS[id]} lit={lit} chimney={id === 'smith' || id === 'baker'} />
      {props[id]}
      {!open && (
        <mesh position={[0, 0.9, 1.06]} rotation={[0, 0, 0.5]}>
          <boxGeometry args={[2.6, 0.2, 0.05]} />
          <Mat color="#a8322d" />
        </mesh>
      )}
    </group>
  );
}

/** The shopkeeper standing out front, facing the square. */
export function Keeper({ id }: { id: string }) {
  const p = at(`s:${id}`);
  const r = faceCentre(p);
  const colors: Record<string, [string, string]> = {
    lumberyard: ['#5c7a3a', '#6b4f2a'], mine: ['#55606e', '#3b3f45'], granary: ['#b88a3a', '#e3c25a'],
    smith: ['#3a3f47', '#7a2f2f'], baker: ['#f1e6cc', '#ffffff'], store: ['#7a58b8', '#d9a5c6'],
  };
  const [body, hat] = colors[id] ?? ['#888', '#444'];
  return (
    <group position={[p[0] + Math.sin(r) * 2.9, 0, p[2] + Math.cos(r) * 2.9]} rotation={[0, r, 0]} scale={1.1}>
      <Person color={body} hat={hat} phase={id.length} />
    </group>
  );
}

// ---------- grounds ----------

const fill = (world: World, i: number) => Math.min(1, world.town.grounds[i] / (world.params.ground_regen_per_day[i] * world.params.ground_capacity_days));

export function ForestModel({ world }: { world: World }) {
  const f = fill(world, 0);
  const spots: V3[] = [[-2.6, 0, -1.4], [-1.2, 0, -2.4], [0.4, 0, -2.6], [1.9, 0, -1.8], [2.8, 0, -0.3], [-2.9, 0, 0.6], [-1.6, 0, 0.4], [0, 0, -0.9], [1.4, 0, 0.5], [-0.6, 0, 1.6], [0.9, 0, 1.9], [2.5, 0, 1.4], [-2.2, 0, 2.2], [3.4, 0, -2.2]];
  const standing = Math.max(3, Math.round(spots.length * (0.25 + 0.75 * f)));
  return (
    <group>
      {spots.map((p, i) => i < standing
        ? <Tree key={i} position={p} scale={0.9 + ((i * 37) % 10) / 25} hue={i * 0.13} />
        : (
          <mesh key={i} position={[p[0], 0.15, p[2]]} castShadow>
            <cylinderGeometry args={[0.2, 0.24, 0.3, 7]} />
            <Mat color="#a0784d" />
          </mesh>
        ))}
      <Rock position={[3.2, 0.2, 1.2]} scale={0.8} />
      <Rock position={[-3.4, 0.15, -2.4]} scale={0.6} />
    </group>
  );
}

export function MineModel({ world }: { world: World }) {
  const f = fill(world, 1);
  return (
    <group>
      <Rock position={[0, 1.4, -1.4]} scale={5} color="#6f665a" />
      <Rock position={[-2.3, 0.9, -0.7]} scale={3.2} color="#655c51" />
      <Rock position={[2.5, 0.8, -0.5]} scale={3} color="#7a7063" />
      <Rock position={[0.6, 3.3, -1.9]} scale={2} color="#8a8174" />
      {/* tunnel */}
      <mesh position={[0, 0.85, 0.95]} rotation={[0, 0, 0]}>
        <cylinderGeometry args={[0.85, 0.85, 0.9, 16, 1, false, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color="#1c1814" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.42, 1.3]}><boxGeometry args={[1.7, 0.84, 0.05]} /><meshStandardMaterial color="#1c1814" /></mesh>
      {[-0.9, 0.9].map(x => <mesh key={x} position={[x, 0.7, 1.35]} castShadow><boxGeometry args={[0.16, 1.4, 0.16]} /><Mat color={PALETTE.wood} /></mesh>)}
      <mesh position={[0, 1.42, 1.35]} castShadow><boxGeometry args={[2.0, 0.16, 0.18]} /><Mat color={PALETTE.wood} /></mesh>
      {Array.from({ length: Math.round(1 + f * 6) }, (_, i) => (
        <Ore key={i} position={[-2 + i * 0.7, 0.35 + (i % 2) * 0.1, 1.9 + (i % 3) * 0.3]} scale={0.8 + (i % 2) * 0.3} />
      ))}
      {/* rails */}
      {[-0.35, 0.35].map(x => <mesh key={x} position={[x, 0.03, 2.6]}><boxGeometry args={[0.06, 0.04, 2.6]} /><Mat color="#6e6a63" /></mesh>)}
    </group>
  );
}

export function FieldsModel({ world }: { world: World }) {
  const f = fill(world, 2);
  return (
    <group>
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[8, 0.04, 5.6]} />
        <Mat color="#a2834e" />
      </mesh>
      <WheatField width={7.4} depth={5} fill={f} color={f > 0.4 ? '#e3c25a' : '#c9b06a'} />
      {/* fence */}
      {Array.from({ length: 10 }, (_, i) => (
        <mesh key={i} position={[-4.1 + i * 0.91, 0.35, 3.0]} castShadow><boxGeometry args={[0.1, 0.7, 0.1]} /><Mat color={PALETTE.wood} /></mesh>
      ))}
      <mesh position={[0, 0.5, 3.0]}><boxGeometry args={[8.2, 0.08, 0.06]} /><Mat color={PALETTE.wood} /></mesh>
      {/* scarecrow */}
      <group position={[2.6, 0, -1.4]}>
        <mesh position={[0, 0.9, 0]}><boxGeometry args={[1.1, 0.08, 0.08]} /><Mat color={PALETTE.wood} /></mesh>
        <Person color="#7a4e2b" hat="#c9a227" phase={3} />
      </group>
    </group>
  );
}

// ---------- the rest of town ----------

export function GuildHallModel({ world, night }: { world: World; night: number }) {
  const guilds = world.guildViews?.length ?? 0;
  return (
    <group rotation={[0, faceCentre(at('guildhall')), 0]}>
      <House w={3.6} d={2.6} h={2.2} roofH={1.4} roof={ROOFS.guildhall} lit={night} />
      {[-1.2, -0.4, 0.4, 1.2].map(x => (
        <mesh key={x} position={[x, 1.1, 1.45]} castShadow><cylinderGeometry args={[0.13, 0.15, 2.2, 8]} /><Mat color="#e6dcc6" /></mesh>
      ))}
      {['#a8322d', '#c9932f'].map((c, i) => (
        <mesh key={c} position={[i ? 0.9 : -0.9, 2.6, 1.42]} castShadow><boxGeometry args={[0.5, 1.0, 0.04]} /><Mat color={guilds > i ? c : '#8a8378'} /></mesh>
      ))}
    </group>
  );
}

export function AuctionModel({ world, night }: { world: World; night: number }) {
  const active = world.auctions.length > 0;
  return (
    <group rotation={[0, faceCentre(at('auction')), 0]}>
      <House w={3} d={2.3} roof={ROOFS.auction} lit={night} />
      <group position={[0, 0, 1.9]}>
        <mesh position={[0, 0.5, 0]} castShadow><boxGeometry args={[0.8, 1, 0.5]} /><Mat color={PALETTE.wood} /></mesh>
        <group position={[0.1, 1.25, 0]} rotation={[0, 0, active ? -0.5 : -0.2]}>
          <mesh castShadow><boxGeometry args={[0.5, 0.18, 0.18]} /><Mat color={PALETTE.woodDark} /></mesh>
          <mesh position={[0.1, -0.25, 0]}><boxGeometry args={[0.07, 0.5, 0.07]} /><Mat color={PALETTE.woodDark} /></mesh>
        </group>
      </group>
      {active && <Sparkles count={14} scale={[3, 2, 3]} position={[0, 2.6, 0]} size={4} speed={0.4} color="#ffd36b" />}
    </group>
  );
}

export function CottageModel({ world, night }: { world: World; night: number }) {
  const level = world.me?.cottage?.level ?? 1;
  const s = 0.75 + level * 0.1;
  return (
    <group rotation={[0, faceCentre(at('cottage')), 0]}>
      <group scale={s}>
        <House w={2.2} d={1.9} roof={ROOFS.cottage} lit={night} chimney={level >= 2} />
      </group>
      {level >= 3 && Array.from({ length: 7 }, (_, i) => (
        <mesh key={i} position={[-1.8 + i * 0.6, 0.25, 1.9]} castShadow><boxGeometry args={[0.08, 0.5, 0.08]} /><Mat color="#f1e6cc" /></mesh>
      ))}
      {level >= 4 && [-1.6, 1.6].map(x => <Tree key={x} position={[x, 0, -1.4]} scale={0.6} hue={x} />)}
    </group>
  );
}

export function BoardModel({ world }: { world: World }) {
  const notes = Math.min(6, world.jobs.length);
  return (
    <group rotation={[0, faceCentre(at('board')), 0]}>
      {[-1, 1].map(x => <mesh key={x} position={[x, 0.8, 0]} castShadow><boxGeometry args={[0.14, 1.6, 0.14]} /><Mat color={PALETTE.wood} /></mesh>)}
      <mesh position={[0, 1.35, 0]} castShadow><boxGeometry args={[2.3, 1.1, 0.1]} /><Mat color="#a77b4a" /></mesh>
      <Roof w={2.5} d={0.5} h={0.4} color={PALETTE.woodDark} position={[0, 1.95, 0]} />
      {Array.from({ length: notes }, (_, i) => (
        <mesh key={i} position={[-0.8 + (i % 3) * 0.8, 1.55 - Math.floor(i / 3) * 0.45, 0.07]} rotation={[0, 0, ((i * 7) % 5 - 2) * 0.05]}>
          <boxGeometry args={[0.5, 0.36, 0.01]} />
          <Mat color="#fffaf0" />
        </mesh>
      ))}
    </group>
  );
}

export function FestivalModel({ world, night }: { world: World; night: number }) {
  const mood = Math.min(1, meri(world.town.week_counted) / Math.max(1, meri(world.town.week_target)));
  const flags = ['#a8322d', '#c9932f', '#2f7d4f', '#2f6a8e', '#7a58b8'];
  return (
    <group rotation={[0, faceCentre(at('festival')), 0]}>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow><boxGeometry args={[4.4, 0.6, 2.6]} /><Mat color="#a77b4a" /></mesh>
      {[-2, 2].map(x => <mesh key={x} position={[x, 1.6, -1.1]} castShadow><boxGeometry args={[0.15, 2.6, 0.15]} /><Mat color={PALETTE.wood} /></mesh>)}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-1.8 + i * 0.45, 2.55 - Math.sin((i / 8) * Math.PI) * 0.35, -1.1]} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.16, 0.34, 3]} />
          <Mat color={flags[i % flags.length]} />
        </mesh>
      ))}
      <Lantern position={[-2.6, 0, 1.2]} lit={night} />
      <Lantern position={[2.6, 0, 1.2]} lit={night} />
      {/* the mood: a banner that rises as the town trades toward its target */}
      <mesh position={[0, 0.65 + mood * 1.6, -1.05]}><boxGeometry args={[1.3, 0.5, 0.04]} /><Mat color={mood >= 1 ? '#2f7d4f' : '#c9932f'} emissive={mood >= 1 ? '#2fae6f' : '#000'} intensity={mood >= 1 ? 0.8 : 0} /></mesh>
      {mood >= 1 && <Sparkles count={40} scale={[5, 3, 3]} position={[0, 3, 0]} size={6} speed={0.6} color="#ffe28a" />}
    </group>
  );
}

export function CaravanModel({ world }: { world: World }) {
  const open = !!world.caravan?.round;
  const sealed = world.caravan?.round?.commits.reduce((a, b) => a + b, 0) ?? 0;
  return (
    <group>
      {[-1.8, 1.8].map(z => <mesh key={z} position={[0, 1.4, z]} castShadow><boxGeometry args={[0.3, 2.8, 0.3]} /><Mat color={PALETTE.wood} /></mesh>)}
      <mesh position={[0, 2.85, 0]} castShadow><boxGeometry args={[0.4, 0.3, 4.2]} /><Mat color={PALETTE.woodDark} /></mesh>
      {open && Array.from({ length: Math.max(1, Math.min(3, Math.ceil(sealed / 3))) }, (_, i) => (
        <group key={i} position={[2.2 + i * 2.2, 0, (i % 2 ? 0.9 : -0.9)]} rotation={[0, Math.PI / 2, 0]}>
          <Wagon cover={['#efe3c8', '#e9d6b0', '#dcc7a0'][i]} />
        </group>
      ))}
    </group>
  );
}

export function Fountain() {
  return (
    <group>
      <mesh position={[0, 0.3, 0]} castShadow receiveShadow><cylinderGeometry args={[1.7, 1.85, 0.6, 20]} /><Mat color={PALETTE.stone} /></mesh>
      <mesh position={[0, 0.58, 0]}><cylinderGeometry args={[1.5, 1.5, 0.06, 20]} /><meshStandardMaterial color="#8fd3f0" emissive="#3aa3d6" emissiveIntensity={0.35} roughness={0.1} metalness={0.2} /></mesh>
      <mesh position={[0, 1.1, 0]} castShadow><cylinderGeometry args={[0.18, 0.28, 1.1, 10]} /><Mat color={PALETTE.stone} /></mesh>
      <Sparkles count={30} scale={[1.2, 1.6, 1.2]} position={[0, 1.8, 0]} size={3} speed={1.4} color="#d9f2ff" />
    </group>
  );
}

export function keeperName(id: string) {
  return KEEPERS[id]?.keeper ?? id;
}
