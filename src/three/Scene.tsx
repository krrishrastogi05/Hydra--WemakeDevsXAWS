// The 3D stage: monsoon light, orbit camera, and every layer of the neighbourhood.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { Terrain } from './Terrain';
import { Buildings } from './Buildings';
import { Drains, Rain, Water } from './Water';
import { Interventions } from './Interventions';
import { Markers } from './Markers';

function CameraRig() {
  const controls = useThree(s => s.controls) as unknown as { target: THREE.Vector3; update: () => void } | null;
  const camera = useThree(s => s.camera);
  const goal = useRef<THREE.Vector3 | null>(null), stamp = useRef(0);
  useFrame(() => {
    const fly = useStore.getState().flyTo;
    if (fly && fly.t !== stamp.current) { stamp.current = fly.t; goal.current = new THREE.Vector3(fly.x, 0, fly.z); }
    if (!goal.current || !controls) return;
    const d = goal.current.clone().sub(controls.target).multiplyScalar(0.08);
    controls.target.add(d); camera.position.add(d); controls.update();
    if (d.length() < 0.05) goal.current = null;
  });
  return null;
}

export function Scene() {
  const grid = useStore(s => s.grid);
  return (
    <Canvas shadows dpr={[1, 2]} gl={{ antialias: true, alpha: true }} camera={{ position: [240, 330, 470], fov: 42, near: 1, far: 5000 }}>
      <fog attach="fog" args={['#0d1621', 900, 2200]} />
      <hemisphereLight args={['#c9dcf5', '#5a4636', 0.75]} />
      <ambientLight intensity={0.18} />
      <directionalLight position={[-260, 420, 220]} intensity={1.65} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-420} shadow-camera-right={420} shadow-camera-top={420} shadow-camera-bottom={-420} shadow-camera-far={1500} />
      {grid && (
        <group key={grid.site.id}>
          <Terrain />
          <Buildings />
          <Drains />
          <Interventions />
          <Water />
          <Rain />
          <Markers />
        </group>
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.46} minDistance={40} maxDistance={1400} target={[0, 0, 30]} />
      <CameraRig />
    </Canvas>
  );
}
