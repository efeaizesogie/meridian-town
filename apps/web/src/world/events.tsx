// Moments: porters carrying goods when a contract is delivered or the caravan fills an order,
// and fireworks over the Festival stage when the town hits its target.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import type { World } from '../App';
import type { Item } from '../types';
import { play } from '../juice';
import { at } from './layout';
import { CHARACTERS, Character } from './kit';

type V3 = [number, number, number];

interface Trip { id: number; from: THREE.Vector3; to: THREE.Vector3; item: Item; qty: number; model: string; start: number }

const CRATE: Record<string, string> = { wood: '#8a5a33', ore: '#7a7f88', wheat: '#e3c25a', bread: '#c9853a', tool: '#5d6470' };
let tripId = 1;

/** Stand a little in front of a place, toward the fountain. */
function frontOf(place: string, dist: number): THREE.Vector3 {
  const [x, , z] = at(place);
  const v = new THREE.Vector3(x, 0, z);
  const len = v.length();
  return len > 0.01 ? v.multiplyScalar((len - dist) / len) : v;
}

/** Watch the world for deliveries and caravan fills, and send a porter for each. */
export function Porters({ world }: { world: World }) {
  const [trips, setTrips] = useState<Trip[]>([]);
  const prevJobs = useRef<Map<number, { remaining: number; shop: string; item: Item; deadlineMs: number }> | null>(null);
  const seenFills = useRef<number | null>(null);

  useEffect(() => {
    const now = performance.now();
    const add: Trip[] = [];
    const jobs = new Map(world.jobs.map(j => [j.id, { remaining: j.remaining, shop: j.shop_id, item: j.item, deadlineMs: j.deadline_ns / 1e6 }]));
    const chainNow = Date.now() - world.clock.skewMs;
    if (prevJobs.current) {
      for (const [id, before] of prevJobs.current) {
        const after = jobs.get(id);
        // Delivered: fewer remaining, or gone before its deadline (filled, not expired).
        const delivered = after ? before.remaining - after.remaining : chainNow < before.deadlineMs ? before.remaining : 0;
        if (delivered > 0) {
          add.push({ id: tripId++, from: frontOf('board', 0), to: frontOf(`s:${before.shop}`, 2.2), item: before.item, qty: delivered, model: CHARACTERS.male[(id * 3) % 6], start: now });
        }
      }
    }
    prevJobs.current = jobs;

    const last = world.caravan?.last;
    if (last?.settled) {
      if (seenFills.current !== null && seenFills.current !== last.day) {
        last.fills.forEach((f, i) => add.push({
          id: tripId++, from: frontOf('caravan', 0), to: frontOf(`s:${f.shop_id}`, 2.2), item: f.item, qty: f.quantity,
          model: CHARACTERS.female[(i * 5 + last.day) % 6], start: now + i * 900,
        }));
      }
      seenFills.current = last.day;
    }
    if (add.length) setTrips(t => [...t, ...add].slice(-12));
  }, [world.jobs, world.caravan?.last]);

  // ?porters=1 previews a trip from the board to every shop.
  useEffect(() => {
    if (!new URLSearchParams(location.search).has('porters')) return;
    const now = performance.now();
    setTrips(['smith', 'baker', 'granary', 'mine'].map((s, i) => ({
      id: tripId++, from: frontOf(i % 2 ? 'caravan' : 'board', 0), to: frontOf(`s:${s}`, 2.2),
      item: (['ore', 'wheat', 'wheat', 'ore'] as Item[])[i], qty: 5 + i * 4, model: CHARACTERS.male[i], start: now + i * 600,
    })));
  }, []);

  return (
    <>
      {trips.map(t => (
        <Porter key={t.id} trip={t} onDone={() => setTrips(ts => ts.filter(x => x.id !== t.id))} />
      ))}
    </>
  );
}

function Porter({ trip, onDone }: { trip: Trip; onDone: () => void }) {
  const ref = useRef<THREE.Group>(null);
  const [arrived, setArrived] = useState(false);
  const speed = 4.2;
  const dist = trip.from.distanceTo(trip.to);
  useFrame(() => {
    const g = ref.current;
    if (!g) return;
    const t = (performance.now() - trip.start) / 1000;
    if (t < 0) {
      g.visible = false;
      return;
    }
    g.visible = true;
    const k = Math.min(1, (t * speed) / Math.max(dist, 0.01));
    g.position.lerpVectors(trip.from, trip.to, k);
    const d = trip.to.clone().sub(trip.from);
    g.rotation.y = Math.atan2(d.x, d.z);
    if (k >= 1 && !arrived) {
      setArrived(true);
      play('coin');
      setTimeout(onDone, 1600);
    }
  });
  return (
    <group ref={ref} position={trip.from.toArray() as V3} visible={false}>
      {!arrived && (
        <>
          <group scale={2.1}>
            <Character model={trip.model} anim="walk" speed={1.3} />
          </group>
          {/* the crate, held in front at chest height */}
          <mesh position={[0, 1.15, 0.55]} castShadow>
            <boxGeometry args={[0.7, 0.55, 0.55]} />
            <meshStandardMaterial color="#9b6b3c" flatShading />
          </mesh>
          <mesh position={[0, 1.45, 0.55]}>
            <boxGeometry args={[0.6, 0.08, 0.45]} />
            <meshStandardMaterial color={CRATE[trip.item]} flatShading />
          </mesh>
        </>
      )}
      <Html position={[0, 2.6, 0]} center zIndexRange={[7, 0]} style={{ pointerEvents: 'none' }}>
        <div className={`porter3d ${arrived ? 'done' : ''}`}>{arrived ? `+${trip.qty} ${trip.item} delivered` : `${trip.qty} ${trip.item}`}</div>
      </Html>
    </group>
  );
}

// ---------- fireworks ----------

const MAX = 2400;
const COLORS = ['#ffc23d', '#ff4d3d', '#3dd6ff', '#9d5bff', '#4dff7a', '#ff5cc8'];

/** A soft round spark, drawn once in code (no texture files). */
function sparkTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

interface Particle { x: number; y: number; z: number; vx: number; vy: number; vz: number; life: number; max: number; c: THREE.Color; rocket: boolean }

/** Rockets from the Festival stage that burst into coloured sparks; bloom does the glow. */
export function Fireworks({ active }: { active: boolean }) {
  const origin = useMemo(() => {
    const [x, , z] = at('festival');
    return new THREE.Vector3(x, 1.5, z);
  }, []);
  const parts = useRef<Particle[]>([]);
  const launchIn = useRef(0);
  const spark = useMemo(sparkTexture, []);
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(MAX * 3), 3));
    g.setDrawRange(0, 0);
    return g;
  }, []);

  useFrame((_, dtRaw) => {
    const dt = Math.min(dtRaw, 0.05);
    const ps = parts.current;
    if (active) {
      launchIn.current -= dt;
      if (launchIn.current <= 0) {
        launchIn.current = 0.45 + Math.random() * 0.6;
        ps.push({
          x: origin.x + (Math.random() - 0.5) * 3, y: origin.y, z: origin.z + (Math.random() - 0.5) * 2,
          vx: (Math.random() - 0.5) * 2.5, vy: 15 + Math.random() * 5, vz: (Math.random() - 0.5) * 2,
          life: 0, max: 0.9 + Math.random() * 0.3, c: new THREE.Color('#fff2c4'), rocket: true,
        });
      }
    }
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life += dt;
      p.vy -= (p.rocket ? 4 : 5.5) * dt;
      p.vx *= p.rocket ? 1 : 0.985;
      p.vz *= p.rocket ? 1 : 0.985;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.life >= p.max) {
        ps.splice(i, 1);
        if (p.rocket && ps.length < MAX - 120) {
          // Burst: a sphere of sparks in one or two colours.
          const a = new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]);
          const b = new THREE.Color(COLORS[Math.floor(Math.random() * COLORS.length)]);
          const n = 150 + Math.floor(Math.random() * 60);
          for (let k = 0; k < n; k++) {
            const u = Math.random() * 2 - 1, th = Math.random() * Math.PI * 2, r = Math.sqrt(1 - u * u);
            const sp = 6 + Math.random() * 2.5;
            ps.push({ x: p.x, y: p.y, z: p.z, vx: r * Math.cos(th) * sp, vy: u * sp, vz: r * Math.sin(th) * sp, life: 0, max: 1.3 + Math.random() * 0.7, c: (k % 2 ? a : b).clone(), rocket: false });
          }
          play('firework');
        }
      }
    }
    const pos = geo.attributes.position as THREE.BufferAttribute;
    const col = geo.attributes.color as THREE.BufferAttribute;
    const n = Math.min(ps.length, MAX);
    for (let i = 0; i < n; i++) {
      const p = ps[i];
      pos.setXYZ(i, p.x, p.y, p.z);
      const fade = p.rocket ? 1 : Math.max(0, 1 - p.life / p.max);
      col.setXYZ(i, p.c.r * fade * 5, p.c.g * fade * 5, p.c.b * fade * 5);
    }
    geo.setDrawRange(0, n);
    pos.needsUpdate = true;
    col.needsUpdate = true;
  });

  return (
    <points geometry={geo} frustumCulled={false}>
      <pointsMaterial map={spark} size={0.6} vertexColors transparent depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} sizeAttenuation />
    </points>
  );
}

/** Fireworks for 30 seconds whenever a new Festival is hit (or with ?fireworks=1). */
export function useFestivalCelebration(world: World) {
  const [until, setUntil] = useState(() => (new URLSearchParams(location.search).has('fireworks') ? Date.now() + 60_000 : 0));
  const seen = useRef<number | null>(null);
  useEffect(() => {
    const n = world.weeks.length;
    const last = world.weeks.at(-1);
    if (seen.current !== null && n > seen.current && last?.hit) setUntil(Date.now() + 30_000);
    seen.current = n;
  }, [world.weeks]);
  // A player burned MERI for fireworks: light them for everyone, once per boost.
  const lastBoost = useRef<number | null>(null);
  const fw = (world as World & { boosts?: { kind: string; at_ns: number }[] | null }).boosts?.find(b => b.kind === 'fireworks');
  useEffect(() => {
    if (!fw) return;
    const fresh = Date.now() - fw.at_ns / 1e6 < 60_000;
    if (lastBoost.current !== fw.at_ns && fresh) setUntil(Date.now() + 30_000);
    lastBoost.current = fw.at_ns;
  }, [fw?.at_ns]); // eslint-disable-line react-hooks/exhaustive-deps
  const [, tick] = useState(0);
  useEffect(() => {
    if (!until) return;
    const t = setTimeout(() => tick(x => x + 1), Math.max(0, until - Date.now()) + 50);
    return () => clearTimeout(t);
  }, [until]);
  return Date.now() < until;
}
