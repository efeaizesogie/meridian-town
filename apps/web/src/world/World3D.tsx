// Meridian as a living 3D island: the same places and state as the 2D map, with a sky that
// follows the market clock, townsfolk, and a camera that flies to wherever you click.
import { Component, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { CameraControls, Html, Sky, Stars } from '@react-three/drei';
import { Bloom, EffectComposer, N8AO, SMAA, ToneMapping, Vignette } from '@react-three/postprocessing';
import { ToneMappingMode } from 'postprocessing';
import * as THREE from 'three';
import type { World } from '../App';
import type { Place } from '../TownMap';
import { ITEMS, KEEPERS, meri, short, type Item } from '../types';
import { at, daylight, ISLAND_RADIUS, PALETTE } from './layout';
import { Mat } from './models';
import { Piece, preloadKit, town } from './kit';

preloadKit();
import {
  AuctionModel, BoardModel, CaravanModel, CottageModel, FestivalModel, FieldsModel, ForestModel, Fountain,
  Glow, GuildHallModel, Keeper, MineModel, ShopModel, Spot,
} from './places';
import { Avatar, Clouds, Decor, Fireflies, Smoke, Townsfolk } from './life';
import { KitPreview } from './KitPreview';
import { Fireworks, Porters, useFestivalCelebration } from './events';

const SHOPS = ['lumberyard', 'mine', 'granary', 'smith', 'baker', 'store'];

/** The price sign over a shop: what it pays most for (×reference), or what it sells. */
function signFor(world: World, id: string): { text: string; hot: boolean } {
  const s = world.shops.find(x => x.shop.id === id);
  if (!s) return { text: '', hot: false };
  if (!s.shop.open) return { text: s.auction ? 'at auction' : 'closed', hot: false };
  const base = (i: number) => meri(world.params.base[i]);
  const buys = ITEMS.map((item, i) => ({ item, i, v: meri(s.bid[i]) })).filter(x => x.v > 0 && x.i < 3).sort((a, b) => b.v / base(b.i) - a.v / base(a.i));
  if (buys.length) return { text: `${buys[0].item} pays ${buys[0].v.toFixed(2)}`, hot: buys[0].v / base(buys[0].i) >= 1.5 };
  const sells = ITEMS.map((item, i) => ({ item, v: meri(s.ask[i]) })).filter(x => x.v > 0);
  return { text: sells.slice(0, 2).map(x => `${x.item} ${x.v.toFixed(2)}`).join('  '), hot: false };
}

function Water() {
  const ref = useRef<THREE.Mesh>(null);
  const geo = useMemo(() => new THREE.PlaneGeometry(260, 260, 70, 70), []);
  const base = useMemo(() => Float32Array.from(geo.attributes.position.array), [geo]);
  useFrame(({ clock }) => {
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const t = clock.elapsedTime;
    for (let i = 0; i < pos.count; i++) {
      const x = base[i * 3], y = base[i * 3 + 1];
      pos.setZ(i, Math.sin(x * 0.18 + t * 0.9) * 0.18 + Math.cos(y * 0.22 + t * 0.7) * 0.16);
    }
    pos.needsUpdate = true;
    geo.computeVertexNormals();
  });
  return (
    <mesh ref={ref} geometry={geo} rotation={[-Math.PI / 2, 0, 0]} position={[0, -1.1, 0]} receiveShadow>
      <meshStandardMaterial color={PALETTE.water} roughness={0.12} metalness={0.15} flatShading />
    </mesh>
  );
}

function Island() {
  const R = ISLAND_RADIUS;
  const rocks = useMemo(() => Array.from({ length: 26 }, (_, i) => {
    const a = (i / 26) * Math.PI * 2 + Math.sin(i * 3.1) * 0.08;
    const r = R + 0.6 + (i % 3) * 0.5;
    return { p: [Math.cos(a) * r, -0.9 + (i % 2) * 0.25, Math.sin(a) * r] as [number, number, number], s: 1.2 + (i % 4) * 0.45 };
  }), [R]);
  return (
    <group>
      <mesh position={[0, -0.4, 0]} receiveShadow>
        <cylinderGeometry args={[R, R, 0.8, 72]} />
        <Mat color={PALETTE.grass} />
      </mesh>
      <mesh position={[0, -3.0, 0]}>
        <cylinderGeometry args={[R - 0.05, R - 4, 4.4, 72]} />
        <Mat color={PALETTE.cliff} />
      </mesh>
      <mesh position={[0, -1.0, 0]} receiveShadow>
        <cylinderGeometry args={[R + 1.6, R + 2.2, 0.3, 72]} />
        <Mat color={PALETTE.sand} />
      </mesh>
      {rocks.map((r, i) => (
        <mesh key={i} position={r.p} scale={r.s} rotation={[i, i * 2, 0]} castShadow receiveShadow>
          <dodecahedronGeometry args={[0.6, 0]} />
          <Mat color={i % 2 ? PALETTE.cliff : PALETTE.cliffDark} />
        </mesh>
      ))}
    </group>
  );
}

function Paths() {
  const places: Place[] = ['g:forest', 'g:mine', 'g:fields', 'guildhall', 'auction', 'caravan', 'cottage', 'board', 'festival'];
  return (
    <group>
      {places.map(p => {
        const [x, , z] = at(p);
        const len = Math.hypot(x, z);
        return (
          <mesh key={p} position={[x / 2, 0.02, z / 2]} rotation={[0, Math.atan2(x, z), 0]} receiveShadow>
            <boxGeometry args={[1.5, 0.04, len]} />
            <Mat color={PALETTE.path} />
          </mesh>
        );
      })}
      <mesh position={[0, 0.03, 0]} receiveShadow>
        <cylinderGeometry args={[7.6, 7.6, 0.06, 48]} />
        <Mat color={PALETTE.cobble} />
      </mesh>
      <mesh position={[0, 0.05, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[7.3, 7.6, 48]} />
        <Mat color="#b7a27a" />
      </mesh>
    </group>
  );
}

function Lighting({ intoDay, lowPower }: { intoDay: number; lowPower: boolean }) {
  const { sun, night, golden } = daylight(intoDay);
  const warm = new THREE.Color('#fff4e0').lerp(new THREE.Color('#ffb46b'), golden);
  return (
    <>
      <hemisphereLight args={[night > 0.5 ? '#6f86c9' : '#d6ecff', '#7a6a4a', 0.9 * (1 - night * 0.55) + 0.2]} />
      <directionalLight
        position={sun}
        color={warm}
        intensity={2.8 * (1 - night * 0.85)}
        castShadow
        shadow-mapSize={[lowPower ? 1024 : 2048, lowPower ? 1024 : 2048]}
        shadow-camera-left={-40}
        shadow-camera-right={40}
        shadow-camera-top={40}
        shadow-camera-bottom={-40}
        shadow-camera-far={220}
        shadow-bias={-0.0004}
        shadow-normalBias={0.03}
      />
      <directionalLight position={[-40, 50, -30]} color="#a9bfff" intensity={1.1 * night} />
      {night > 0.55 ? (
        <>
          <color attach="background" args={['#101b3f']} />
          <Stars radius={140} depth={50} count={2500} factor={4} fade speed={0.5} />
          <fog attach="fog" args={['#101b3f', 80, 200]} />
        </>
      ) : (
        <>
          <Sky distance={450000} sunPosition={sun} turbidity={5} rayleigh={1.2 + golden * 2} mieCoefficient={0.005} mieDirectionalG={0.85} />
          <fog attach="fog" args={[golden > 0.3 ? '#f2c79a' : '#cfe3f2', 80, 210]} />
        </>
      )}
    </>
  );
}

function Rig({ selected, lowPower }: { selected: Place | null; lowPower: boolean }) {
  const ref = useRef<CameraControls>(null);
  const intro = useRef(true);
  const overview = lowPower ? [0, 44, 56] : [0, 32, 41];
  useEffect(() => {
    const c = ref.current;
    if (!c) return;
    if (intro.current) {
      // Fly in from high over the sea.
      c.setLookAt(-40, 95, 120, 0, 0, 0, false);
      c.smoothTime = 1.4;
      const t = setTimeout(() => c.setLookAt(overview[0], overview[1], overview[2], 0, 0, 1, true), 150);
      intro.current = false;
      return () => clearTimeout(t);
    }
    c.smoothTime = 0.7;
    if (selected) {
      const [x, , z] = at(selected);
      c.setLookAt(x * 0.75, 13, z + 15, x, 1, z, true);
    } else {
      c.setLookAt(overview[0], overview[1], overview[2], 0, 0, 1, true);
    }
  }, [selected]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <CameraControls
      ref={ref}
      makeDefault
      minDistance={9}
      maxDistance={95}
      minPolarAngle={0.25}
      maxPolarAngle={1.2}
      dollySpeed={0.6}
    />
  );
}

/** Rotate through merchants who spoke recently and show the latest words over their shop. */
function Chatter({ world }: { world: World }) {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI(x => x + 1), 6500);
    return () => clearInterval(t);
  }, []);
  const recent = Object.values(world.agents ?? {}).filter(a => Date.now() - a.at < 15 * 60_000).sort((a, b) => b.at - a.at);
  const a = recent.length ? recent[i % recent.length] : null;
  if (!a) return null;
  const [x, , z] = at(`s:${a.shopId}`);
  const text = a.say.replace(/^[A-Z][a-z]+:\s*/, '');
  const max = matchMedia('(max-width: 720px)').matches ? 40 : 90; // phones get a shorter line
  return (
    <Html key={`${a.shopId}${a.at}`} position={[x, 8.2, z]} center zIndexRange={[9, 0]} style={{ pointerEvents: 'none' }}>
      <div className="bubble3d"><b>{KEEPERS[a.shopId]?.keeper}:</b> {text.length > max ? text.slice(0, max - 2).trimEnd() + '…' : text}</div>
    </Html>
  );
}

function Scene({ world, onOpen, selected, questPlace, account, working, lowPower }: Props & { lowPower: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 2000);
    return () => clearInterval(t);
  }, []);
  const { genesisMs, dayMs, skewMs } = world.clock;
  const forced = { day: 0.35, dusk: 0.69, night: 0.93 }[new URLSearchParams(location.search).get('time') ?? ''];
  const intoDay = forced ?? (((now - skewMs - genesisMs) % dayMs) + dayMs) % dayMs / dayMs;
  const { night } = daylight(intoDay);
  const celebrating = useFestivalCelebration(world);
  const spot = (p: Place, node: React.ReactNode, opts: { ring?: number; labelY?: number; scale?: number; sign?: { text: string; hot: boolean } } = {}) => (
    <Spot key={p} place={p} onOpen={onOpen} selected={selected === p} quest={questPlace === p} ring={opts.ring} labelY={opts.labelY} scale={opts.scale} sign={opts.sign?.text} hot={opts.sign?.hot}>
      {node}
    </Spot>
  );
  return (
    <>
      <Lighting intoDay={intoDay} lowPower={lowPower} />
      <Rig selected={selected} lowPower={lowPower} />
      <Water />
      <Island />
      <Paths />
      <Decor />
      <Fountain />
      {[[5, 5], [-5, 5], [5, -5], [-5, -5]].map(([x, z]) => (
        <group key={`${x}${z}`} position={[x, 0, z]}>
          <Piece src={town('lantern')} scale={1.5} />
          <Glow position={[0, 2.0, 0]} on={night} />
        </group>
      ))}
      {/* one warm light over the square stands in for all four lanterns */}
      {night > 0.15 && <pointLight position={[0, 4, 0]} color="#ffb860" intensity={night * 40} distance={24} decay={1.6} />}

      {spot('g:forest', <ForestModel world={world} />, { ring: 4.6, labelY: 4.4, scale: 1.15 })}
      {spot('g:mine', <MineModel world={world} />, { ring: 4.6, labelY: 5.6, scale: 1.15 })}
      {spot('g:fields', <FieldsModel world={world} />, { ring: 5, labelY: 3, scale: 1.15 })}
      {SHOPS.map(id => spot(`s:${id}`, <ShopModel id={id} world={world} night={night} />, { sign: signFor(world, id), labelY: 4.3 }))}
      {spot('guildhall', <GuildHallModel world={world} night={night} />, { ring: 3.4, labelY: 5 })}
      {spot('auction', <AuctionModel world={world} night={night} />, { labelY: 4.4 })}
      {spot('caravan', <CaravanModel world={world} />, { ring: 3.6, labelY: 4.2 })}
      {spot('cottage', <CottageModel world={world} night={night} />, { ring: 2.8, labelY: 3.9 })}
      {spot('board', <BoardModel world={world} />, { ring: 2.4, labelY: 3.2 })}
      {spot('festival', <FestivalModel world={world} night={night} />, { ring: 3.6, labelY: 3.8 })}

      {SHOPS.map(id => <Keeper key={id} id={id} spoke={!!world.agents?.[id] && Date.now() - world.agents[id].at < 20_000} />)}
      <Townsfolk count={lowPower ? 4 : 7} />
      <Avatar target={selected} name={short(account)} working={working} />
      <Smoke position={[...at('s:smith')].map((v, i) => (i === 1 ? 3.6 : v)) as [number, number, number]} color="#cfcac2" />
      <Smoke position={[...at('s:baker')].map((v, i) => (i === 1 ? 3.6 : v)) as [number, number, number]} />
      {(world.me?.cottage?.level ?? 1) >= 2 && <Smoke position={[...at('cottage')].map((v, i) => (i === 1 ? 3.2 : v)) as [number, number, number]} />}
      <Clouds />
      <Fireflies night={night} />
      <Chatter world={world} />
      <Porters world={world} />
      <Fireworks active={celebrating} />

      {!lowPower && (
        <EffectComposer multisampling={0}>
          <N8AO aoRadius={2.2} distanceFalloff={1} intensity={2} />
          <Bloom mipmapBlur intensity={0.6} luminanceThreshold={0.85} />
          <Vignette offset={0.25} darkness={0.5} />
          <ToneMapping mode={ToneMappingMode.ACES_FILMIC} />
          <SMAA />
        </EffectComposer>
      )}
    </>
  );
}

interface Props {
  working: boolean;
  world: World;
  onOpen: (p: Place) => void;
  selected: Place | null;
  questPlace: Place | null;
  account: string;
}

/** If WebGL fails, say so and let the caller fall back to the 2D map. */
class GLBoundary extends Component<{ onFail: () => void; children: React.ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch() {
    this.props.onFail();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function World3D(props: Props & { onFail: () => void }) {
  const lowPower = typeof window !== 'undefined' && (window.innerWidth < 760 || (navigator.hardwareConcurrency ?? 8) <= 4);
  return (
    <GLBoundary onFail={props.onFail}>
      <div className="world3d">
        <Canvas
          shadows="percentage"
          dpr={lowPower ? [1, 1.5] : [1, 2]}
          gl={{ antialias: lowPower, powerPreference: 'high-performance' }}
          camera={{ fov: 38, near: 0.5, far: 400, position: [-40, 95, 120] }}
          onPointerMissed={() => (document.body.style.cursor = '')}
        >
          <Suspense fallback={null}>
            {new URLSearchParams(location.search).has('kit') ? <KitPreview /> : <Scene {...props} lowPower={lowPower} />}
          </Suspense>
        </Canvas>
      </div>
    </GLBoundary>
  );
}
