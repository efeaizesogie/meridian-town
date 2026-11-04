// Life on the island: you walking to where you clicked, townsfolk going about their day,
// chimney smoke, drifting clouds, and fireflies after dark.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html, Sparkles } from '@react-three/drei';
import * as THREE from 'three';
import { at } from './layout';
import { Person } from './models';

/** Stand a little in front of a place, toward the fountain. */
function frontOf(place: string, dist = 4.6): THREE.Vector3 {
  const [x, , z] = at(place);
  const v = new THREE.Vector3(x, 0, z);
  const len = v.length();
  return len > 0.01 ? v.multiplyScalar((len - dist) / len) : v;
}

/** You: walks from wherever you were to the place you clicked. */
export function Avatar({ target, name }: { target: string | null; name: string }) {
  const ref = useRef<THREE.Group>(null);
  const walking = useRef(false);
  const goal = useMemo(() => (target ? frontOf(target) : new THREE.Vector3(0, 0, 3)), [target]);
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const d = goal.clone().sub(g.position);
    d.y = 0;
    const dist = d.length();
    walking.current = dist > 0.08;
    if (walking.current) {
      const step = Math.min(dist, dt * 7);
      g.position.addScaledVector(d.normalize(), step);
      g.rotation.y = THREE.MathUtils.damp(g.rotation.y, Math.atan2(d.x, d.z), 12, dt);
    }
  });
  return (
    <group ref={ref} position={[0, 0, 3]} scale={1.35}>
      <WalkingPerson color="#2f5d7a" hat="#c9932f" walkingRef={walking} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.04, 0]}>
        <ringGeometry args={[0.35, 0.45, 24]} />
        <meshBasicMaterial color="#ffd36b" toneMapped={false} />
      </mesh>
      <Html position={[0, 1.8, 0]} center style={{ pointerEvents: 'none' }}>
        <div className="you3d">{name}</div>
      </Html>
    </group>
  );
}

function WalkingPerson({ color, hat, walkingRef }: { color: string; hat?: string; walkingRef: React.MutableRefObject<boolean> }) {
  const inner = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!inner.current) return;
    const t = clock.elapsedTime * 10;
    inner.current.position.y = walkingRef.current ? Math.abs(Math.sin(t)) * 0.14 : 0;
  });
  return (
    <group ref={inner}>
      <Person color={color} hat={hat} />
    </group>
  );
}

const ROUTES = ['s:lumberyard', 's:mine', 's:granary', 's:smith', 's:baker', 's:store', 'board', 'g:forest', 'g:fields', 'g:mine', 'cottage', 'festival', 'guildhall', 'caravan'];

/** Townsfolk: wander from place to place, pausing at each. */
export function Townsfolk({ count = 7 }: { count?: number }) {
  const folk = useMemo(() => Array.from({ length: count }, (_, i) => ({
    color: ['#8e4a3a', '#4a6e8e', '#6e8e4a', '#8e7a4a', '#6a4a8e', '#4a8e7a', '#8e4a6e'][i % 7],
    hat: i % 3 === 0 ? '#5a3a1a' : undefined,
    seed: i * 7 + 3,
  })), [count]);
  return <>{folk.map((f, i) => <Wanderer key={i} {...f} />)}</>;
}

function Wanderer({ color, hat, seed }: { color: string; hat?: string; seed: number }) {
  const ref = useRef<THREE.Group>(null);
  const walking = useRef(false);
  const state = useRef({ leg: seed % ROUTES.length, wait: (seed % 5) * 0.8, from: frontOf(ROUTES[seed % ROUTES.length], 4) });
  useFrame((_, dt) => {
    const g = ref.current;
    if (!g) return;
    const s = state.current;
    if (s.wait > 0) {
      s.wait -= dt;
      walking.current = false;
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
    walking.current = true;
    g.position.addScaledVector(d.normalize(), Math.min(dist, dt * 2.2));
    g.rotation.y = THREE.MathUtils.damp(g.rotation.y, Math.atan2(d.x, d.z), 8, dt);
  });
  return (
    <group ref={ref} position={state.current.from.toArray() as [number, number, number]} scale={1.3}>
      <WalkingPerson color={color} hat={hat} walkingRef={walking} />
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

/** Bushes, flowers and grass tufts scattered over the island, kept off paths and places. */
export function Decor() {
  const items = useMemo(() => {
    const keepClear = ['g:forest', 'g:mine', 'g:fields', 's:lumberyard', 's:mine', 's:granary', 's:smith', 's:baker', 's:store', 'guildhall', 'auction', 'caravan', 'cottage', 'board', 'festival']
      .map(p => at(p));
    const out: { p: [number, number, number]; kind: 'tuft' | 'bush' | 'flower'; c: string; s: number }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; out.length < 140 && i < 2000; i++) {
      const a = rnd() * Math.PI * 2;
      const r = 6 + Math.sqrt(rnd()) * 23;
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (keepClear.some(([px, , pz]) => Math.hypot(px - x, pz - z) < 4.8)) continue;
      // Paths run from the fountain to each place: stay a little off those lines.
      if (keepClear.some(([px, , pz]) => {
        const len = Math.hypot(px, pz);
        const t = (x * px + z * pz) / (len * len);
        return t > 0 && t < 1 && Math.hypot(x - px * t, z - pz * t) < 1.4;
      })) continue;
      const roll = rnd();
      const kind = roll < 0.55 ? 'tuft' : roll < 0.8 ? 'flower' : 'bush';
      const c = kind === 'flower' ? ['#f2c94c', '#eb5757', '#f2f2f2', '#bb6bd9'][Math.floor(rnd() * 4)] : kind === 'bush' ? '#4f8a3f' : '#6aa457';
      out.push({ p: [x, 0, z], kind, c, s: 0.7 + rnd() * 0.6 });
    }
    return out;
  }, []);
  return (
    <group>
      {items.map((d, i) => (
        <group key={i} position={d.p} scale={d.s}>
          {d.kind === 'tuft' && (
            <mesh position={[0, 0.18, 0]} castShadow>
              <coneGeometry args={[0.16, 0.42, 4]} />
              <meshStandardMaterial color={d.c} flatShading />
            </mesh>
          )}
          {d.kind === 'bush' && (
            <mesh position={[0, 0.35, 0]} castShadow>
              <icosahedronGeometry args={[0.55, 0]} />
              <meshStandardMaterial color={d.c} flatShading />
            </mesh>
          )}
          {d.kind === 'flower' && (
            <>
              <mesh position={[0, 0.15, 0]}><cylinderGeometry args={[0.02, 0.02, 0.3, 4]} /><meshStandardMaterial color="#4f8a3f" /></mesh>
              <mesh position={[0, 0.32, 0]}><icosahedronGeometry args={[0.1, 0]} /><meshStandardMaterial color={d.c} flatShading /></mesh>
            </>
          )}
        </group>
      ))}
    </group>
  );
}
