// ?kit=1: a close look at the model kits, for checking how the pieces fit.
import { useEffect, useRef } from 'react';
import { CameraControls } from '@react-three/drei';
import { Character, KitHouse, Piece, nature, town } from './kit';

export function KitPreview() {
  const cam = useRef<CameraControls>(null);
  useEffect(() => {
    const v = new URLSearchParams(location.search).get('kit');
    if (v === 'back') cam.current?.setLookAt(1, 5, -9, 0.5, 1, 0, false);
    else cam.current?.setLookAt(1, 4.5, 9, 0.5, 1, 1, false);
  }, []);
  return (
    <>
      <CameraControls ref={cam} makeDefault />
      <ambientLight intensity={0.6} />
      <directionalLight position={[6, 10, 8]} intensity={2.4} castShadow />
      <color attach="background" args={['#bfe0f2']} />
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[40, 40]} />
        <meshStandardMaterial color="#7fb069" />
      </mesh>
      <group position={[-4, 0, 0]}><KitHouse w={2} d={2} chimney /></group>
      <group position={[0, 0, 0]}><KitHouse w={3} d={2} floors={2} style="wood" high banners="red" /></group>
      <group position={[4.5, 0, 0]}><KitHouse w={2} d={3} style="wood" /></group>
      <group position={[-2, 0, 3]} scale={2}><Character model="character-male-c" anim="walk" /></group>
      <group position={[0, 0, 3]} scale={2}><Character model="character-female-b" anim="idle" /></group>
      <Piece src={nature('tree_default')} position={[3, 0, 3]} scale={2} />
      <Piece src={town('stall-red')} position={[5, 0, 3]} />
      <Piece src={town('lantern')} position={[6, 0, 3]} />
    </>
  );
}
