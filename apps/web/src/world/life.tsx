// Life on the island: you walking to where you clicked, townsfolk going about their day,
// chimney smoke, drifting clouds, and fireflies after dark.
import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { at } from './layout';
import { CHARACTERS, Character, Scatter, nature, type Anim } from './kit';

/** Stand a little in front of a place, toward the fountain. */
function frontOf(place: string, dist = 4.6): THREE.Vector3 {
  const [x, , z] = at(place);
  const v = new THREE.Vector3(x, 0, z);
  const len = v.length();
  return len > 0.01 ? v.multiplyScalar((len - dist) / len) : v;
}

/** Pick a character model from a name, so every player looks a little different. */
function modelFor(name: string) {
  const all = [...CHARACTERS.male, ...CHARACTERS.female];
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return all[h % all.length];
}

/** Track whether something is moving, re-rendering only when that changes. */
function useMoving() {
  const [moving, setMoving] = useState(false);
  const last = useRef(false);
  const set = (m: boolean) => {
    if (m !== last.current) {
      last.current = m;
      setMoving(m);
    }
  };
  return [moving, set] as const;
}

/** You: walk from wherever you were to the place you clicked; swing while gathering. */
export function Avatar({ target, name, working }: { target: string | null; name: string; working: boolean }) {
  const ref = useRef<THREE.Group>(null);
  const [moving, setMoving] = useMoving();
  const goal = useMemo(() => (target ? frontOf(target) : new THREE.Vector3(0, 0, 3)), [target]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const d = goal.clone().sub(g.position);
    d.y = 0;
    const dist = d.length();
    setMoving(dist > 0.08);
    if (dist > 0.08) {
      g.position.addScaledVector(d.normalize(), Math.min(dist, dt * 7));
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, Math.atan2(d.x, d.z), 12, dt);
    } else if (target) {
      // Arrived: face the place.
      const [px, , pz] = at(target);
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, Math.atan2(px - g.position.x, pz - g.position.z), 8, dt);
    }
  });
  const anim: Anim = moving ? 'sprint' : working ? 'interact-right' : 'idle';
  return (
    <group ref={ref} position={[0, 0, 3]}>
      <group scale={2.4}>
        <Character model={modelFor(name)} anim={anim} />
      </group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.55, 0.68, 28]} />
        <meshBasicMaterial color="#ffd36b" toneMapped={false} />
      </mesh>
      <Html position={[0, 2.4, 0]} center zIndexRange={[7, 0]} style={{ pointerEvents: 'none' }}>
        <div className="you3d">{name}</div>
      </Html>
    </group>
  );
}

const ROUTES = ['s:lumberyard', 's:mine', 's:granary', 's:smith', 's:baker', 's:store', 'board', 'g:forest', 'g:fields', 'g:mine', 'cottage', 'festival', 'guildhall', 'caravan'];

/** Townsfolk: wander from place to place, pausing at each. */
export function Townsfolk({ count = 7 }: { count?: number }) {
  const folk = useMemo(() => Array.from({ length: count }, (_, i) => ({
    model: [...CHARACTERS.female, ...CHARACTERS.male][(i * 5 + 1) % 12],
    seed: i * 7 + 3,
  })), [count]);
  return <>{folk.map((f, i) => <Wanderer key={i} {...f} />)}</>;
}

function Wanderer({ model, seed }: { model: string; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const [moving, setMoving] = useMoving();
  const state = useRef({ leg: seed % ROUTES.length, wait: (seed % 5) * 0.8, from: frontOf(ROUTES[seed % ROUTES.length], 4) });
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const s = state.current;
    if (s.wait > 0) {
      s.wait -= dt;
      setMoving(false);
      return;
    }
    const goal = frontOf(ROUTES[s.leg], 3.8 + (seed % 3) * 0.5);
    const d = goal.clone().sub(g.position);
    const dist = d.length();
    if (dist < 0.1) {
      s.leg = (s.leg + 1 + (seed % 4)) % ROUTES.length;
      s.wait = 1.5 + ((seed * s.leg) % 5);
      return;
    }
    setMoving(true);
    g.position.addScaledVector(d.normalize(), Math.min(dist, dt * 2.2));
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, Math.atan2(d.x, d.z), 8, dt);
  });
  return (
    <group ref={ref} position={state.current.from.toArray() as [number, number, number]} scale={2.2}>
      <Character model={model} anim={moving ? 'walk' : 'idle'} />
    </group>
  );
}

/** A slow column of puffs from a chimney. */
export function Smoke({ position, color = '#f4f1ea' }: { position: [number, number, number]; color?: string }) {
  const puffs = useRef<THREE.Mesh[]>([]);
  useFrame(({ clock }) => {
    puffs.current.forEach((m, i) => {
      if (!m) return;
      const t = (clock.elapsedTime * 0.35 + i / 4) % 1;
      m.position.set(Math.sin(t * 4 + i) * 0.25, t * 2.4, Math.cos(t * 3 + i) * 0.15);
      m.scale.setScalar(0.25 + t * 0.55);
      (m.material as THREE.MeshStandardMaterial).opacity = 0.65 * (1 - t);
    });
  });
  return (
    <group position={position}>
      {[0, 1, 2, 3].map(i => (
        <mesh key={i} ref={el => { if (el) puffs.current[i] = el; }}>
          <icosahedronGeometry args={[0.5, 0]} />
          <meshStandardMaterial color={color} transparent opacity={0.5} flatShading depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

/** Low-poly clouds drifting across the island. */
export function Clouds() {
  const ref = useRef<THREE.Group>(null);
  // High and toward the back, so they frame the island without crossing the camera.
  const clouds = useMemo(() => Array.from({ length: 7 }, (_, i) => ({
    x: -50 + i * 16, z: -48 + ((i * 13) % 22), y: 22 + (i % 3) * 3, s: 1.4 + (i % 3) * 0.5,
  })), []);
  useFrame((_, dt) => {
    ref.current?.children.forEach(c => {
      c.position.x += dt * 0.6;
      if (c.position.x > 55) c.position.x = -55;
    });
  });
  return (
    <group ref={ref}>
      {clouds.map((c, i) => (
        <group key={i} position={[c.x, c.y, c.z]} scale={c.s}>
          {[[0, 0, 0, 1.6], [1.5, -0.2, 0.3, 1.2], [-1.4, -0.3, -0.2, 1.1], [0.4, 0.6, -0.3, 1.0]].map(([x, y, z, r], j) => (
            <mesh key={j} position={[x, y, z]}>
              <icosahedronGeometry args={[r, 0]} />
              <meshStandardMaterial color="#ffffff" flatShading roughness={1} transparent opacity={0.92} />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

export function Fireflies({ night }: { night: number }) {
  if (night < 0.2) return null;
  return (
    <>
      <Sparkles count={40} scale={[9, 2.5, 7]} position={[...at('g:forest')].map((v, i) => (i === 1 ? 1.4 : v)) as [number, number, number]} size={5} speed={0.3} color="#fff3a3" opacity={night} />
      <Sparkles count={30} scale={[9, 2, 6]} position={[...at('g:fields')].map((v, i) => (i === 1 ? 1.2 : v)) as [number, number, number]} size={4} speed={0.3} color="#fff3a3" opacity={night} />
    </>
  );
}

/** Grass, flowers, bushes, mushrooms and rocks scattered over the island, off paths and places. */
export function Decor() {
  const groups = useMemo(() => {
    const keepClear = ['g:forest', 'g:mine', 'g:fields', 's:lumberyard', 's:mine', 's:granary', 's:smith', 's:baker', 's:store', 'guildhall', 'auction', 'caravan', 'cottage', 'board', 'festival']
      .map(p => at(p));
    const kinds: [string, number, number][] = [
      // model, weight, scale
      ['grass_large', 22, 2.4], ['grass', 18, 2.6], ['grass_leafs', 10, 2.4], ['flower_redA', 6, 2.6], ['flower_yellowA', 6, 2.6],
      ['flower_purpleA', 5, 2.6], ['flower_yellowC', 4, 2.6], ['plant_bush', 6, 2.2], ['plant_bushLarge', 4, 2], ['plant_bushDetailed', 4, 2.2],
      ['mushroom_red', 2, 2.4], ['mushroom_tan', 2, 2.4], ['rock_smallA', 3, 2.4], ['rock_smallC', 3, 2.4], ['stone_largeA', 2, 2],
    ];
    const total = kinds.reduce((t, k) => t + k[1], 0);
    const out: Record<string, { p: [number, number, number]; r: number; s: number }[]> = {};
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0, placed = 0; placed < 170 && i < 3000; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 6 + Math.sqrt(rnd()) * 23.5;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (keepClear.some(([px, , pz]) => Math.hypot(px - x, pz - z) < 4.8)) continue;
      // Paths run from the fountain to each place: stay a little off those lines.
      if (keepClear.some(([px, , pz]) => {
        const len = Math.hypot(px, pz);
        const t = (x * px + z * pz) / (len * len);
        return t > 0 && t < 1 && Math.hypot(x - px * t, z - pz * t) < 1.4;
      })) continue;
      let roll = rnd() * total;
      const kind = kinds.find(k => (roll -= k[1]) < 0) ?? kinds[0];
      (out[kind[0]] ??= []).push({ p: [x, 0, z], r: rnd() * Math.PI * 2, s: kind[2] * (0.8 + rnd() * 0.4) });
      placed++;
    }
    return out;
  }, []);
  return (
    <group>
      {Object.entries(groups).map(([src, items]) => <Scatter key={src} src={nature(src)} items={items} />)}
    </group>
  );
}
