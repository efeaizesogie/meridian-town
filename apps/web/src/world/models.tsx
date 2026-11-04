// Low-poly building blocks, modelled in code: houses, roofs, trees, rocks, people, carts.
// Flat shading and a warm palette give the hand-made diorama look.
import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { PALETTE } from './layout';

type V3 = [number, number, number];

export function Mat({ color, emissive, intensity = 0, rough = 0.85 }: { color: string; emissive?: string; intensity?: number; rough?: number }) {
  return <meshStandardMaterial color={color} roughness={rough} metalness={0} flatShading emissive={emissive ?? '#000000'} emissiveIntensity={intensity} />;
}

/** A gabled roof: a triangular prism with a little overhang. */
export function Roof({ w, d, h, color, position = [0, 0, 0] }: { w: number; d: number; h: number; color: string; position?: V3 }) {
  const geo = useMemo(() => {
    const o = 0.18;
    const shape = new THREE.Shape();
    shape.moveTo(-w / 2 - o, 0);
    shape.lineTo(w / 2 + o, 0);
    shape.lineTo(0, h);
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: d + o * 2, bevelEnabled: false });
    g.translate(0, 0, -(d + o * 2) / 2);
    return g;
  }, [w, d, h]);
  return (
    <mesh geometry={geo} position={position} castShadow receiveShadow>
      <Mat color={color} />
    </mesh>
  );
}

export function House({ w = 2.4, d = 2, h = 1.6, roofH = 1.1, wall = PALETTE.wall, roof, lit = 0, chimney = false, door = true }: {
  w?: number; d?: number; h?: number; roofH?: number; wall?: string; roof: string; lit?: number; chimney?: boolean; door?: boolean;
}) {
  const win = (x: number, z: number, ry = 0) => (
    <mesh position={[x, h * 0.58, z]} rotation={[0, ry, 0]}>
      <boxGeometry args={[0.36, 0.36, 0.06]} />
      <Mat color={lit > 0.1 ? PALETTE.windowLit : PALETTE.window} emissive={PALETTE.windowLit} intensity={lit * 2.2} rough={0.3} />
    </mesh>
  );
  return (
    <group>
      <mesh position={[0, h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[w, h, d]} />
        <Mat color={wall} />
      </mesh>
      {/* timber base */}
      <mesh position={[0, 0.08, 0]} receiveShadow>
        <boxGeometry args={[w + 0.12, 0.16, d + 0.12]} />
        <Mat color={PALETTE.stone} />
      </mesh>
      <Roof w={w} d={d} h={roofH} color={roof} position={[0, h, 0]} />
      {door && (
        <mesh position={[0, 0.5, d / 2 + 0.02]}>
          <boxGeometry args={[0.46, 0.84, 0.06]} />
          <Mat color={PALETTE.woodDark} />
        </mesh>
      )}
      {win(-w / 3.2, d / 2 + 0.03)}
      {win(w / 3.2, d / 2 + 0.03)}
      {win(w / 2 + 0.03, 0, Math.PI / 2)}
      {chimney && (
        <mesh position={[w / 3, h + roofH * 0.7, -d / 5]} castShadow>
          <boxGeometry args={[0.34, 0.9, 0.34]} />
          <Mat color={PALETTE.stone} />
        </mesh>
      )}
    </group>
  );
}

export function Tree({ position, scale = 1, hue = 0 }: { position: V3; scale?: number; hue?: number }) {
  const greens = ['#4f8f45', '#3f7a3a', '#5a9a4c', '#46833f'];
  const c = greens[Math.abs(Math.round(hue * 10)) % greens.length];
  return (
    <group position={position} scale={scale}>
      <mesh position={[0, 0.45, 0]} castShadow>
        <cylinderGeometry args={[0.12, 0.18, 0.9, 6]} />
        <Mat color={PALETTE.wood} />
      </mesh>
      <mesh position={[0, 1.25, 0]} castShadow>
        <coneGeometry args={[0.85, 1.3, 7]} />
        <Mat color={c} />
      </mesh>
      <mesh position={[0, 1.95, 0]} castShadow>
        <coneGeometry args={[0.6, 1.05, 7]} />
        <Mat color={c} />
      </mesh>
    </group>
  );
}

export function Rock({ position, scale = 1, color = PALETTE.stone }: { position: V3; scale?: number; color?: string }) {
  return (
    <mesh position={position} scale={scale} rotation={[0.3, position[0], 0.2]} castShadow receiveShadow>
      <dodecahedronGeometry args={[0.5, 0]} />
      <Mat color={color} />
    </mesh>
  );
}

/** A villager: body, head, little bob as they walk or idle. */
export function Person({ color, skin = '#f0c9a0', hat, walking = false, phase = 0 }: { color: string; skin?: string; hat?: string; walking?: boolean; phase?: number }) {
  const ref = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const t = clock.elapsedTime * (walking ? 9 : 2) + phase;
    ref.current.position.y = walking ? Math.abs(Math.sin(t)) * 0.12 : Math.sin(t) * 0.025;
    ref.current.rotation.z = walking ? Math.sin(t) * 0.08 : 0;
  });
  return (
    <group ref={ref}>
      <mesh position={[0, 0.42, 0]} castShadow>
        <capsuleGeometry args={[0.2, 0.42, 4, 8]} />
        <Mat color={color} />
      </mesh>
      <mesh position={[0, 0.93, 0]} castShadow>
        <sphereGeometry args={[0.19, 10, 8]} />
        <Mat color={skin} />
      </mesh>
      {hat && (
        <mesh position={[0, 1.1, 0]} castShadow>
          <coneGeometry args={[0.24, 0.3, 8]} />
          <Mat color={hat} />
        </mesh>
      )}
    </group>
  );
}

export function Wagon({ cover = '#efe3c8' }: { cover?: string }) {
  return (
    <group>
      <mesh position={[0, 0.55, 0]} castShadow>
        <boxGeometry args={[1.6, 0.4, 0.9]} />
        <Mat color={PALETTE.wood} />
      </mesh>
      <mesh position={[0, 0.95, 0]} castShadow rotation={[0, 0, Math.PI / 2]}>
        <cylinderGeometry args={[0.5, 0.5, 1.5, 10, 1, false, 0, Math.PI]} />
        <meshStandardMaterial color={cover} roughness={0.9} side={THREE.DoubleSide} flatShading />
      </mesh>
      {[-0.55, 0.55].flatMap(x => [-0.5, 0.5].map(z => (
        <mesh key={`${x}${z}`} position={[x, 0.3, z]} rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[0.28, 0.28, 0.1, 10]} />
          <Mat color={PALETTE.woodDark} />
        </mesh>
      )))}
    </group>
  );
}

export function Lantern({ position, lit }: { position: V3; lit: number }) {
  return (
    <group position={position}>
      <mesh position={[0, 0.9, 0]} castShadow>
        <cylinderGeometry args={[0.05, 0.07, 1.8, 6]} />
        <Mat color={PALETTE.woodDark} />
      </mesh>
      <mesh position={[0, 1.85, 0]}>
        <boxGeometry args={[0.26, 0.3, 0.26]} />
        <Mat color="#ffd27a" emissive="#ffb347" intensity={0.2 + lit * 4} rough={0.3} />
      </mesh>
      {lit > 0.15 && <pointLight position={[0, 1.85, 0]} color="#ffb860" intensity={lit * 6} distance={7} decay={2} />}
    </group>
  );
}

export function LogPile({ position }: { position: V3 }) {
  return (
    <group position={position}>
      {[0, 1, 2].map(r => [0, 1, 2 - r].slice(0, 3 - r).map((_, i) => (
        <mesh key={`${r}${i}`} position={[0, 0.16 + r * 0.28, (i - (2 - r) / 2) * 0.3]} rotation={[0, 0, Math.PI / 2]} castShadow>
          <cylinderGeometry args={[0.14, 0.14, 1.1, 7]} />
          <Mat color={r % 2 ? '#8a5a33' : '#7a4e2b'} />
        </mesh>
      )))}
    </group>
  );
}

/** A spinning, glowing crystal of ore (the mine's stock you can see). */
export function Ore({ position, scale = 1 }: { position: V3; scale?: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => ref.current && (ref.current.rotation.y = clock.elapsedTime * 0.6 + position[0]));
  return (
    <mesh ref={ref} position={position} scale={scale} castShadow>
      <octahedronGeometry args={[0.32, 0]} />
      <Mat color="#d9773a" emissive="#ff7a2e" intensity={0.6} rough={0.4} />
    </mesh>
  );
}

/** Wheat: many small swaying tufts in one instanced draw. */
export function WheatField({ width, depth, fill, color }: { width: number; depth: number; fill: number; color: string }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  const spots = useMemo(() => {
    const out: [number, number, number][] = [];
    for (let x = -width / 2; x <= width / 2; x += 0.45) for (let z = -depth / 2; z <= depth / 2; z += 0.45) out.push([x + (Math.sin(x * 9 + z) * 0.12), 0, z + Math.cos(z * 7 + x) * 0.12]);
    return out;
  }, [width, depth]);
  const m = useMemo(() => new THREE.Object3D(), []);
  useFrame(({ clock }) => {
    const mesh = ref.current;
    if (!mesh) return;
    const t = clock.elapsedTime;
    spots.forEach(([x, , z], i) => {
      const h = (0.55 + 0.35 * Math.sin(i * 1.7)) * (0.25 + 0.75 * fill);
      m.position.set(x, h / 2, z);
      m.rotation.set(Math.sin(t * 1.3 + x * 0.8) * 0.12, 0, Math.cos(t * 1.1 + z * 0.8) * 0.12);
      m.scale.set(1, h / 0.8, 1);
      m.updateMatrix();
      mesh.setMatrixAt(i, m.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, spots.length]} castShadow receiveShadow>
      <coneGeometry args={[0.13, 0.8, 5]} />
      <Mat color={color} />
    </instancedMesh>
  );
}
