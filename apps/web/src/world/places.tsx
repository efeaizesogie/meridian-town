// Every place on the island as a little diorama that reflects the live game: the forest
// thins as it's cut, ore crystals shrink with the mine's stock, contracts pin to the board.
// Buildings, nature and props come from Kenney's CC0 kits (see kit.tsx and CREDITS.md).
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import type { World } from '../App';
import { SPOTS, type Place } from '../TownMap';
import { KEEPERS, meri } from '../types';
import { at, PALETTE } from './layout';
import { Mat, Ore, Roof } from './models';
import { Character, KitHouse, Piece, Scatter, Spin, nature, town } from './kit';

type V3 = [number, number, number];

/** Rotation that turns a place's front (+z) toward the fountain. */
export const faceCentre = (p: V3) => Math.atan2(-p[0], -p[2]);

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
    if (halo.current) halo.current.scale.setScalar(quest ? 1 + Math.sin(clock.elapsedTime * 3) * 0.06 : 1);
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
      <Html position={[0, labelY * scale, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`label3d ${hover || selected ? 'on' : ''}`}>
          <span role="button" tabIndex={0} onClick={() => onOpen(place)} onKeyDown={e => (e.key === 'Enter' || e.key === ' ') && onOpen(place)}>{SPOTS[place].label}</span>
          {sign && <b className={hot ? 'hot' : ''}>{sign}</b>}
        </div>
      </Html>
      {quest && (
        <Html position={[0, labelY * scale + 1.8, 0]} center zIndexRange={[8, 0]} style={{ pointerEvents: 'none' }}>
          <div className="quest3d">!</div>
        </Html>
      )}
    </group>
  );
}

/** Kit units are 1 per cell; buildings sit at this size inside their Spot. */
const B = 1.15;

// ---------- shops ----------

export function ShopModel({ id, world, night }: { id: string; world: World; night: number }) {
  const s = world.shops.find(x => x.shop.id === id);
  const open = s?.shop.open ?? true;
  const pos = at(`s:${id}`);
  const style = id === 'lumberyard' || id === 'granary' || id === 'store' ? 'wood' : 'stone';
  const props: Record<string, React.ReactNode> = {
    lumberyard: <><Piece src={nature('log_stack')} position={[1.9, 0, 0.3]} rotation={0.4} scale={1.8} /><Piece src={nature('log')} position={[-1.8, 0, 0.6]} rotation={1.1} scale={1.8} /></>,
    mine: (
      <group position={[1.75, 0, 0.6]}>
        <Piece src={town('cart')} scale={1.4} rotation={0.5} />
        {[0, 1, 2].map(i => <Ore key={i} position={[(i - 1) * 0.22, 0.85, 0]} scale={0.55} />)}
      </group>
    ),
    granary: (
      <group position={[-1.9, 0, -0.3]}>
        <mesh position={[0, 1.2, 0]} castShadow><cylinderGeometry args={[0.65, 0.7, 2.4, 12]} /><Mat color="#e6d2a2" /></mesh>
        <mesh position={[0, 2.7, 0]} castShadow><coneGeometry args={[0.85, 0.8, 12]} /><Mat color="#b5532a" /></mesh>
        <group position={[0, 2.2, 0.75]} scale={0.9}>
          <Spin axis="z" speed={0.7}><group rotation={[0, Math.PI / 2, 0]}><Piece src={town('windmill')} /></group></Spin>
        </group>
      </group>
    ),
    smith: (
      <group position={[1.75, 0, 0.7]}>
        <mesh position={[0, 0.45, 0]} castShadow><boxGeometry args={[0.6, 0.5, 0.35]} /><Mat color="#3a3f47" rough={0.5} /></mesh>
        <mesh position={[-0.9, 0.4, -0.2]} castShadow><boxGeometry args={[0.8, 0.8, 0.8]} /><Mat color={PALETTE.stone} /></mesh>
        <mesh position={[-0.9, 0.55, 0.21]}><boxGeometry args={[0.4, 0.3, 0.02]} /><Mat color="#ff8a3d" emissive="#ff6a1a" intensity={open ? 3 : 0} /></mesh>
        {open && <pointLight position={[-0.9, 0.7, 0.8]} color="#ff7a30" intensity={3 + night * 6} distance={5} />}
      </group>
    ),
    baker: (
      <group position={[-1.85, 0, 0.4]}>
        <mesh position={[0, 0.5, 0]} castShadow><sphereGeometry args={[0.75, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2]} /><Mat color="#c9a27a" /></mesh>
        <mesh position={[0, 0.3, 0.68]}><boxGeometry args={[0.4, 0.3, 0.04]} /><Mat color="#ffb35a" emissive="#ff8c1a" intensity={open ? 2.5 : 0} /></mesh>
      </group>
    ),
    store: <><Piece src={town('stall-red')} position={[1.7, 0, 0.9]} rotation={-0.3} scale={1.3} /><Piece src={town('stall-green')} position={[-1.7, 0, 0.9]} rotation={0.3} scale={1.3} /></>,
  };
  return (
    <group rotation={[0, faceCentre(pos), 0]}>
      <group scale={B}>
        <KitHouse w={2} d={2} style={style} high={id === 'lumberyard' || id === 'baker' || id === 'store'} chimney={id === 'smith' || id === 'baker'} />
      </group>
      {props[id]}
      {!open && (
        <mesh position={[0, 0.9, 1.2]} rotation={[0, 0, 0.5]}>
          <boxGeometry args={[2.6, 0.2, 0.05]} />
          <Mat color="#a8322d" />
        </mesh>
      )}
    </group>
  );
}

const KEEPER_MODEL: Record<string, string> = {
  lumberyard: 'character-male-a', mine: 'character-male-d', granary: 'character-female-c',
  smith: 'character-male-e', baker: 'character-female-a', store: 'character-female-f',
};

/** The shopkeeper standing out front, facing the square. Nods when they've just spoken. */
export function Keeper({ id, spoke }: { id: string; spoke: boolean }) {
  const p = at(`s:${id}`);
  const r = faceCentre(p);
  return (
    <group position={[p[0] + Math.sin(r) * 2.9, 0, p[2] + Math.cos(r) * 2.9]} rotation={[0, r, 0]} scale={2.3}>
      <Character model={KEEPER_MODEL[id]} anim={spoke ? 'emote-yes' : 'idle'} />
    </group>
  );
}

// ---------- grounds ----------

const fill = (world: World, i: number) => Math.min(1, world.town.grounds[i] / (world.params.ground_regen_per_day[i] * world.params.ground_capacity_days));

const FOREST_SPOTS: [number, number, string][] = [
  [-2.6, -1.4, 'tree_default'], [-1.2, -2.4, 'tree_oak'], [0.4, -2.6, 'tree_pineRoundA'], [1.9, -1.8, 'tree_fat'], [2.8, -0.3, 'tree_default'],
  [-2.9, 0.6, 'tree_detailed'], [-1.6, 0.4, 'tree_oak'], [0, -0.9, 'tree_tall'], [1.4, 0.5, 'tree_pineRoundC'], [-0.6, 1.6, 'tree_default'],
  [0.9, 1.9, 'tree_fat'], [2.5, 1.4, 'tree_oak'], [-2.2, 2.2, 'tree_pineTallA'], [3.4, -2.2, 'tree_detailed'],
];

export function ForestModel({ world }: { world: World }) {
  const f = fill(world, 0);
  const standing = Math.max(3, Math.round(FOREST_SPOTS.length * (0.25 + 0.75 * f)));
  const byModel = useMemo(() => {
    const m: Record<string, { p: V3; r: number; s: number }[]> = {};
    FOREST_SPOTS.slice(0, standing).forEach(([x, z, src], i) => (m[src] ??= []).push({ p: [x, 0, z], r: i * 1.3, s: 1.9 + ((i * 37) % 10) / 20 }));
    return m;
  }, [standing]);
  const stumps = FOREST_SPOTS.slice(standing).map(([x, z], i) => ({ p: [x, 0, z] as V3, r: i, s: 1.6 }));
  return (
    <group>
      {Object.entries(byModel).map(([src, items]) => <Scatter key={src} src={nature(src)} items={items} />)}
      {stumps.length > 0 && <Scatter src={nature('stump_round')} items={stumps} />}
      <Piece src={nature('log')} position={[3.1, 0, 1.3]} rotation={0.6} scale={1.6} />
      <Piece src={nature('mushroom_red')} position={[-3.2, 0, -0.4]} scale={1.6} />
    </group>
  );
}

export function MineModel({ world }: { world: World }) {
  const f = fill(world, 1);
  return (
    <group>
      {/* a grey stone hill: stacked boulders, tinted to the island's stone */}
      <Piece src={nature('stone_tallA')} position={[0, 0, -1.5]} scale={[5.5, 4.2, 5.5]} tint="#9a9286" />
      <Piece src={nature('stone_tallA')} position={[-2.3, 0, -0.8]} rotation={1.4} scale={[4, 2.8, 4]} tint="#8c8478" />
      <Piece src={nature('stone_tallA')} position={[2.4, 0, -0.7]} rotation={2.6} scale={[4, 2.6, 4]} tint="#a39b8f" />
      <Piece src={nature('stone_largeA')} position={[-1.2, 0, 0.4]} rotation={0.7} scale={2.6} tint="#8c8478" />
      <Piece src={nature('stone_largeA')} position={[1.6, 0, 0.5]} rotation={2.1} scale={2.2} tint="#a39b8f" />
      {/* tunnel */}
      <mesh position={[0, 0.85, 0.95]}>
        <cylinderGeometry args={[0.85, 0.85, 0.9, 16, 1, false, -Math.PI / 2, Math.PI]} />
        <meshStandardMaterial color="#1c1814" side={THREE.DoubleSide} />
      </mesh>
      <mesh position={[0, 0.42, 1.3]}><boxGeometry args={[1.7, 0.84, 0.05]} /><meshStandardMaterial color="#1c1814" /></mesh>
      {[-0.9, 0.9].map(x => <Piece key={x} src={town('pillar-wood')} position={[x, 0, 1.35]} scale={[1.2, 1.45, 1.2]} />)}
      <mesh position={[0, 1.42, 1.35]} castShadow><boxGeometry args={[2.0, 0.16, 0.18]} /><Mat color={PALETTE.wood} /></mesh>
      <Piece src={town('lantern')} position={[1.25, 0, 1.6]} />
      {Array.from({ length: Math.round(1 + f * 6) }, (_, i) => (
        <Ore key={i} position={[-2 + i * 0.7, 0.35 + (i % 2) * 0.1, 1.9 + (i % 3) * 0.3]} scale={0.8 + (i % 2) * 0.3} />
      ))}
      <Piece src={town('cart')} position={[0, 0, 2.6]} rotation={Math.PI / 2} scale={1.3} />
    </group>
  );
}

export function FieldsModel({ world }: { world: World }) {
  const f = fill(world, 2);
  const crops = useMemo(() => {
    const out: { p: V3; r: number; s: number }[] = [];
    for (let x = -3.4; x <= 3.4; x += 0.85) for (let z = -2.2; z <= 2.2; z += 0.75) out.push({ p: [x, 0, z], r: ((x * 7 + z * 3) % 3), s: 1.5 });
    return out;
  }, []);
  const grown = Math.round(crops.length * (0.2 + 0.8 * f));
  const fences = useMemo(() => Array.from({ length: 9 }, (_, i) => ({ p: [-3.7 + i * 0.92, 0, 2.95] as V3, r: 0, s: 0.92 })), []);
  return (
    <group>
      <mesh position={[0, 0.02, 0]} receiveShadow>
        <boxGeometry args={[8, 0.04, 5.6]} />
        <Mat color="#a3814f" />
      </mesh>
      <Scatter src={nature('crops_wheatStageB')} items={crops.slice(0, grown)} tint="#e9c45a" />
      {grown < crops.length && <Scatter src={nature('crops_wheatStageA')} items={crops.slice(grown)} tint="#8fbf4f" />}
      <Scatter src={nature('fence_simple')} items={fences} />
      <Piece src={nature('crop_pumpkin')} position={[3.6, 0, -2.6]} scale={1.6} />
      <Piece src={nature('crop_pumpkin')} position={[3.1, 0, -2.9]} scale={1.3} />
    </group>
  );
}

// ---------- the rest of town ----------

export function GuildHallModel({ world, night }: { world: World; night: number }) {
  const guilds = world.guildViews?.length ?? 0;
  return (
    <group rotation={[0, faceCentre(at('guildhall')), 0]}>
      <group scale={B}>
        <KitHouse w={3} d={2} floors={2} high banners={guilds > 0 ? 'red' : undefined} />
      </group>
      {guilds > 1 && <Piece src={town('banner-green')} position={[0, 0, 1.2]} rotation={-Math.PI / 2} scale={B} />}
    </group>
  );
}

export function AuctionModel({ world, night }: { world: World; night: number }) {
  const active = world.auctions.length > 0;
  return (
    <group rotation={[0, faceCentre(at('auction')), 0]}>
      <group scale={B}>
        <KitHouse w={3} d={2} banners="red" />
      </group>
      <group position={[0, 0, 1.9]}>
        <Piece src={town('stall-bench')} scale={1.4} rotation={Math.PI / 2} />
        <group position={[0.1, 0.9, 0]} rotation={[0, 0, active ? -0.5 : -0.2]}>
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
  const shape = [
    { w: 1, d: 1, floors: 1 },
    { w: 2, d: 1, floors: 1 },
    { w: 2, d: 2, floors: 1 },
    { w: 2, d: 2, floors: 2 },
    { w: 3, d: 2, floors: 2 },
  ][Math.min(4, level - 1)];
  const hedges = useMemo(() => Array.from({ length: 5 }, (_, i) => ({ p: [-2 + i, 0, 1.9] as V3, r: 0, s: 1 })), []);
  return (
    <group rotation={[0, faceCentre(at('cottage')), 0]}>
      <group scale={B}>
        <KitHouse {...shape} style={level >= 3 ? 'stone' : 'wood'} chimney={level >= 2} />
      </group>
      {level >= 3 && <Scatter src={town('hedge')} items={hedges} />}
      {level >= 4 && [-2.2, 2.2].map(x => <Piece key={x} src={nature('tree_oak')} position={[x, 0, -1]} scale={1.5} />)}
      {level >= 5 && <Piece src={town('fountain-round')} position={[0, 0, 2.6]} scale={0.6} />}
    </group>
  );
}

export function BoardModel({ world }: { world: World }) {
  const notes = Math.min(6, world.jobs.length);
  return (
    <group rotation={[0, faceCentre(at('board')), 0]}>
      {[-1, 1].map(x => <Piece key={x} src={town('pillar-wood')} position={[x, 0, 0]} scale={[1, 1.9, 1]} />)}
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
      <mesh position={[0, 0.25, 0]} castShadow receiveShadow><boxGeometry args={[4.4, 0.5, 2.6]} /><Mat color="#8a6440" /></mesh>
      <group position={[0, 0.5, 0]} scale={[4.4, 1, 2.6]}><Piece src={town('planks')} /></group>
      {[-2, 2].map(x => <Piece key={x} src={town('pillar-wood')} position={[x, 0.5, -1.1]} scale={[1.6, 2.4, 1.6]} />)}
      {Array.from({ length: 9 }, (_, i) => (
        <mesh key={i} position={[-1.8 + i * 0.45, 2.75 - Math.sin((i / 8) * Math.PI) * 0.35, -1.1]} rotation={[0, 0, Math.PI]}>
          <coneGeometry args={[0.16, 0.34, 3]} />
          <Mat color={flags[i % flags.length]} />
        </mesh>
      ))}
      {[-2.6, 2.6].map(x => (
        <group key={x} position={[x, 0, 1.2]}>
          <Piece src={town('lantern')} scale={1.2} />
          <Glow position={[0, 1.6, 0]} on={night} />
        </group>
      ))}
      {night > 0.15 && <pointLight position={[0, 2.4, 1.4]} color="#ffb860" intensity={night * 10} distance={10} decay={2} />}
      {/* the mood: a banner that rises as the town trades toward its target */}
      <mesh position={[0, 0.85 + mood * 1.6, -1.05]}><boxGeometry args={[1.3, 0.5, 0.04]} /><Mat color={mood >= 1 ? '#2f7d4f' : '#c9932f'} emissive={mood >= 1 ? '#2fae6f' : '#000'} intensity={mood >= 1 ? 0.8 : 0} /></mesh>
      {mood >= 1 && <Sparkles count={40} scale={[5, 3, 3]} position={[0, 3, 0]} size={6} speed={0.6} color="#ffe28a" />}
    </group>
  );
}

export function CaravanModel({ world }: { world: World }) {
  const open = !!world.caravan?.round;
  const sealed = world.caravan?.round?.commits.reduce((a, b) => a + b, 0) ?? 0;
  return (
    <group>
      {[-1.8, 1.8].map(z => <Piece key={z} src={town('pillar-wood')} position={[0, 0, z]} scale={[2.2, 2.9, 2.2]} />)}
      <mesh position={[0, 2.95, 0]} castShadow><boxGeometry args={[0.4, 0.3, 4.2]} /><Mat color={PALETTE.woodDark} /></mesh>
      <Piece src={town('lantern')} position={[0, 0, 2.4]} />
      {open && Array.from({ length: Math.max(1, Math.min(3, Math.ceil(sealed / 3))) }, (_, i) => (
        <group key={i} position={[2.4 + i * 2.2, 0, i % 2 ? 0.9 : -0.9]}>
          <Piece src={town('cart-high')} rotation={Math.PI / 2} scale={1.6} />
        </group>
      ))}
    </group>
  );
}

export function Fountain() {
  return (
    <group>
      <Piece src={town('fountain-round')} scale={1.8} />
      <Piece src={town('fountain-center')} scale={1.8} />
      <mesh position={[0, 0.35, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[1.55, 24]} />
        <meshStandardMaterial color="#8fd3f0" emissive="#3aa3d6" emissiveIntensity={0.35} roughness={0.1} metalness={0.2} />
      </mesh>
      <Sparkles count={30} scale={[1.2, 1.6, 1.2]} position={[0, 1.8, 0]} size={3} speed={1.4} color="#d9f2ff" />
    </group>
  );
}

export function keeperName(id: string) {
  return KEEPERS[id]?.keeper ?? id;
}

/** A lantern bulb that glows (and blooms) at night without lighting anything: cheap. */
export function Glow({ position, on, size = 0.16 }: { position: V3; on: number; size?: number }) {
  if (on < 0.15) return null;
  return (
    <mesh position={position}>
      <sphereGeometry args={[size, 10, 8]} />
      <meshBasicMaterial color={new THREE.Color('#ffcf70').multiplyScalar(1 + on * 3)} toneMapped={false} />
    </mesh>
  );
}
