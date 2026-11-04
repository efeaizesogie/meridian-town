// Kenney's CC0 model kits (public/models, see CREDITS.md): loading, cloning with shadows,
// a modular house builder, instanced scatter, and animated characters.
import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { useAnimations, useGLTF } from '@react-three/drei';
import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';

type V3 = [number, number, number];
const BASE = '/models';

export const town = (name: string) => `${BASE}/town/${name}.glb`;
export const nature = (name: string) => `${BASE}/nature/${name}.glb`;
export const person = (name: string) => `${BASE}/people/${name}.glb`;

function withShadows<T extends THREE.Object3D>(o: T): T {
  o.traverse(c => {
    if ((c as THREE.Mesh).isMesh) {
      c.castShadow = true;
      c.receiveShadow = true;
    }
  });
  return o;
}

/** Recolour every material in a model (the kits' palettes don't always fit our island). */
function tinted(mat: THREE.Material, tint?: string): THREE.Material {
  if (!tint) return mat;
  const m = (mat as THREE.MeshStandardMaterial).clone();
  m.color = new THREE.Color(tint);
  return m;
}

/** One static model, cloned so it can appear many times. */
export function Piece({ src, position, rotation = 0, scale = 1, tint }: { src: string; position?: V3; rotation?: number; scale?: number | V3; tint?: string }) {
  const { scene } = useGLTF(src);
  const obj = useMemo(() => {
    const o = withShadows(scene.clone(true));
    if (tint) o.traverse(c => { const m = c as THREE.Mesh; if (m.isMesh) m.material = tinted(m.material as THREE.Material, tint); });
    return o;
  }, [scene, tint]);
  return <primitive object={obj} position={position} rotation={[0, rotation, 0]} scale={scale} />;
}

/** Many copies of one model in a handful of draw calls (one per mesh in the model). */
export function Scatter({ src, items, tint }: { src: string; items: { p: V3; r?: number; s?: number }[]; tint?: string }) {
  const { scene } = useGLTF(src);
  const parts = useMemo(() => {
    scene.updateMatrixWorld(true);
    const out: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }[] = [];
    scene.traverse(c => {
      const m = c as THREE.Mesh;
      if (m.isMesh) out.push({ geo: m.geometry, mat: tinted(m.material as THREE.Material, tint), local: m.matrixWorld.clone() });
    });
    return out;
  }, [scene, tint]);
  return (
    <>
      {parts.map((part, k) => (
        <ScatterPart key={k} part={part} items={items} />
      ))}
    </>
  );
}

function ScatterPart({ part, items }: { part: { geo: THREE.BufferGeometry; mat: THREE.Material; local: THREE.Matrix4 }; items: { p: V3; r?: number; s?: number }[] }) {
  const ref = useRef<THREE.InstancedMesh>(null);
  useEffect(() => {
    const mesh = ref.current;
    if (!mesh) return;
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    items.forEach((it, i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), it.r ?? 0);
      m.compose(new THREE.Vector3(...it.p), q, new THREE.Vector3().setScalar(it.s ?? 1)).multiply(part.local);
      mesh.setMatrixAt(i, m);
    });
    mesh.count = items.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingSphere();
  }, [items, part]);
  return <instancedMesh ref={ref} args={[part.geo, part.mat, Math.max(1, items.length)]} castShadow receiveShadow frustumCulled={false} />;
}

export type WallStyle = 'stone' | 'wood';

/**
 * A house from the town kit: `w` × `d` cells, `floors` storeys, a door in the middle of the
 * front (+z), shuttered windows elsewhere, and a gabled roof along z. One cell = 1 unit.
 */
export function KitHouse({ w = 2, d = 2, floors = 1, style = 'stone', high = false, chimney = false, banners }: {
  w?: number; d?: number; floors?: number; style?: WallStyle; high?: boolean; chimney?: boolean; banners?: 'red' | 'green';
}) {
  const s = style === 'wood' ? 'wall-wood' : 'wall';
  const pieces: { src: string; p: V3; r: number; sc?: V3 }[] = [];
  for (let f = 0; f < floors; f++) {
    for (let i = 0; i < w; i++) {
      for (let j = 0; j < d; j++) {
        const x = i - (w - 1) / 2;
        const z = j - (d - 1) / 2;
        const front = j === d - 1;
        const midFront = front && i === Math.floor((w - 1) / 2) && f === 0;
        const window = f > 0 || (i + j) % 2 === 0 ? `${s}-window-shutters` : s;
        if (i === w - 1) pieces.push({ src: town(window), p: [x, f, z], r: 0 });
        if (i === 0) pieces.push({ src: town(window), p: [x, f, z], r: Math.PI });
        if (front) pieces.push({ src: town(midFront ? `${s}-door` : `${s}-window-shutters`), p: [x, f, z], r: -Math.PI / 2 });
        if (j === 0) pieces.push({ src: town(f === 0 && i % 2 ? `${s}-window-small` : s), p: [x, f, z], r: Math.PI / 2 });
      }
    }
  }
  // Gabled roof: one piece per row along z, stretched across the width; closed ends front and back.
  const roofSrc = high ? 'roof-high-gable' : 'roof-gable';
  for (let j = 0; j < d; j++) {
    const z = j - (d - 1) / 2;
    const end = j === 0 || j === d - 1;
    pieces.push({
      src: town(end ? `${roofSrc}-end` : roofSrc),
      p: [0, floors, z],
      r: j === 0 && d > 1 ? Math.PI : 0,
      sc: [w, 1.15, 1],
    });
  }
  if (chimney) pieces.push({ src: town('chimney'), p: [(w - 1) / 2, floors, -(d - 1) / 2], r: 0 });
  if (banners) {
    pieces.push({ src: town(`banner-${banners}`), p: [-(w - 1) / 2, 0, (d - 1) / 2], r: -Math.PI / 2 });
    pieces.push({ src: town(`banner-${banners}`), p: [(w - 1) / 2, 0, (d - 1) / 2], r: -Math.PI / 2 });
  }
  return (
    <group>
      {pieces.map((pc, k) => (
        <Piece key={k} src={pc.src} position={pc.p} rotation={pc.r} scale={pc.sc ?? 1} />
      ))}
    </group>
  );
}

export type Anim = 'idle' | 'walk' | 'sprint' | 'pick-up' | 'interact-right' | 'emote-yes' | 'sit';

/** An animated Kenney character; cross-fades between animations when `anim` changes. */
export function Character({ model, anim = 'idle', speed = 1 }: { model: string; anim?: Anim; speed?: number }) {
  const { scene, animations } = useGLTF(person(model));
  const obj = useMemo(() => withShadows(cloneSkinned(scene)), [scene]);
  const group = useRef<THREE.Group>(null);
  const { actions } = useAnimations(animations, group);
  useEffect(() => {
    const a = actions[anim] ?? actions.idle;
    if (!a) return;
    a.reset().setEffectiveTimeScale(speed).fadeIn(0.25).play();
    return () => {
      a.fadeOut(0.25);
    };
  }, [anim, actions, speed]);
  return (
    <group ref={group}>
      <primitive object={obj} />
    </group>
  );
}

/** Slowly turn something (windmill sails, a water wheel). */
export function Spin({ axis = 'x', speed = 0.6, children }: { axis?: 'x' | 'y' | 'z'; speed?: number; children: React.ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useFrame((_, dt) => ref.current && (ref.current.rotation[axis] += dt * speed));
  return <group ref={ref}>{children}</group>;
}

export const CHARACTERS = {
  male: ['character-male-a', 'character-male-b', 'character-male-c', 'character-male-d', 'character-male-e', 'character-male-f'],
  female: ['character-female-a', 'character-female-b', 'character-female-c', 'character-female-d', 'character-female-e', 'character-female-f'],
};

/** Ask the browser to start fetching the models we use most, before they're needed. */
export function preloadKit() {
  ['wall', 'wall-door', 'wall-window-shutters', 'wall-window-small', 'wall-wood', 'wall-wood-door', 'wall-wood-window-shutters', 'wall-wood-window-small',
    'roof-gable', 'roof-gable-end', 'roof-high-gable', 'roof-high-gable-end', 'chimney', 'lantern', 'fountain-round', 'stall-red', 'stall-green', 'cart']
    .forEach(n => useGLTF.preload(town(n)));
  [...CHARACTERS.male, ...CHARACTERS.female].forEach(n => useGLTF.preload(person(n)));
}
