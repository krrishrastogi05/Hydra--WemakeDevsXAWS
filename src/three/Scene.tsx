// The 3D stage: sky, light, orbit camera, and every layer of the neighbourhood.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { Terrain } from './Terrain';
import { Buildings } from './Buildings';
import { Drains, Rain, Water, rainRate } from './flood/Water';
import { Interventions } from './flood/Interventions';
import { Markers } from './flood/Markers';
import { HeatInterventions, HeatLights, HeatMarkers, HeatOverlay, Trees } from './heat/HeatLayer';
import { useHeat } from '../heatStore';
import { Effects } from './Effects';

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

const skyVert = /* glsl */`varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const skyFrag = /* glsl */`
  uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uGround; varying vec3 vDir;
  void main() {
    float h = vDir.y;
    vec3 col = h > 0.0 ? mix(uHorizon, uZenith, pow(smoothstep(0.0, 0.75, h), 0.8)) : mix(uHorizon, uGround, smoothstep(0.0, -0.25, h));
    gl_FragColor = vec4(col, 1.0);
  }`;

/** Gradient sky dome; colours are uniforms so the storm can darken it. */
function Sky({ horizon, zenith, ground, skyRef }: { horizon: string; zenith: string; ground: string; skyRef?: React.RefObject<THREE.ShaderMaterial | null> }) {
  const mat = useMemo(() => new THREE.ShaderMaterial({
    vertexShader: skyVert, fragmentShader: skyFrag, side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uHorizon: { value: new THREE.Color(horizon) }, uZenith: { value: new THREE.Color(zenith) }, uGround: { value: new THREE.Color(ground) } },
  }), [horizon, zenith, ground]);
  if (skyRef) skyRef.current = mat;
  return <mesh material={mat} renderOrder={-1} frustumCulled={false}><sphereGeometry args={[3200, 32, 16]} /></mesh>;
}

const CALM = { sun: 1.9, hemi: 0.55, fogNear: 1000, fogFar: 2600, horizon: new THREE.Color('#3a4c5f'), zenith: new THREE.Color('#0e1824'), fog: new THREE.Color('#2a3846') };
const STORM = { sun: 0.75, hemi: 0.4, fogNear: 520, fogFar: 1700, horizon: new THREE.Color('#2a3138'), zenith: new THREE.Color('#0b0f14'), fog: new THREE.Color('#222a32') };

/** Overcast monsoon light that darkens and closes in while it rains, then clears as the storm passes. */
function FloodLights({ shadowSize }: { shadowSize: number }) {
  const sun = useRef<THREE.DirectionalLight>(null), hemi = useRef<THREE.HemisphereLight>(null), sky = useRef<THREE.ShaderMaterial | null>(null);
  const scene = useThree(s => s.scene), mood = useRef(0);
  useFrame(() => {
    mood.current += (Math.min(1, rainRate() / 60) - mood.current) * 0.04;
    const t = mood.current, fog = scene.fog as THREE.Fog | null;
    if (sun.current) sun.current.intensity = THREE.MathUtils.lerp(CALM.sun, STORM.sun, t);
    if (hemi.current) hemi.current.intensity = THREE.MathUtils.lerp(CALM.hemi, STORM.hemi, t);
    if (fog) { fog.near = THREE.MathUtils.lerp(CALM.fogNear, STORM.fogNear, t); fog.far = THREE.MathUtils.lerp(CALM.fogFar, STORM.fogFar, t); fog.color.copy(CALM.fog).lerp(STORM.fog, t); }
    if (sky.current) { sky.current.uniforms.uHorizon.value.copy(CALM.horizon).lerp(STORM.horizon, t); sky.current.uniforms.uZenith.value.copy(CALM.zenith).lerp(STORM.zenith, t); }
  });
  return (
    <>
      <Sky horizon="#3a4c5f" zenith="#0e1824" ground="#1a1714" skyRef={sky} />
      <fog attach="fog" args={['#2a3846', CALM.fogNear, CALM.fogFar]} />
      <hemisphereLight ref={hemi} args={['#d6e2ef', '#4a3f35', CALM.hemi]} />
      <directionalLight ref={sun} position={[-260, 420, 220]} intensity={CALM.sun} color="#fff6ea" castShadow
        shadow-mapSize={[shadowSize, shadowSize]} shadow-bias={-0.0004} shadow-normalBias={0.6} shadow-radius={3}
        shadow-camera-left={-330} shadow-camera-right={330} shadow-camera-top={330} shadow-camera-bottom={-330} shadow-camera-far={1500} />
    </>
  );
}

/** Soft studio fill (procedural, nothing is downloaded): gives walls gentle, believable shading on every side. */
function Fill() {
  return (
    <Environment resolution={128} frames={1} environmentIntensity={0.55}>
      <Lightformer form="rect" intensity={1.4} color="#e6edf5" position={[0, 6, -10]} scale={[14, 6, 1]} />
      <Lightformer form="rect" intensity={0.7} color="#f3e8d8" position={[-9, 3, 4]} rotation-y={Math.PI / 2} scale={[10, 4, 1]} />
      <Lightformer form="rect" intensity={0.5} color="#dfe6ee" position={[9, 3, 4]} rotation-y={-Math.PI / 2} scale={[10, 4, 1]} />
      <Lightformer form="circle" intensity={1.0} color="#ffffff" position={[0, 10, 0]} rotation-x={Math.PI / 2} scale={6} />
    </Environment>
  );
}

// The neighbourhood (terrain, buildings, labels) and the camera are shared; each mode adds its own layers on top.
export function Scene() {
  const grid = useStore(s => s.grid), mode = useStore(s => s.mode), quality = useStore(s => s.quality);
  const heatReady = useHeat(s => !!s.heat && !!s.baseline && s.siteId === grid?.site.id);
  const high = quality === 'high';
  const declined = useRef(false);
  const onDecline = () => {
    if (declined.current || useStore.getState().quality === 'low') return;
    declined.current = true;
    useStore.setState({ quality: 'low' });   // not persisted: the next visit tries High again
    useStore.getState().notify('Graphics switched to Low to keep the map smooth. Change it in the map legend.');
  };
  return (
    <Canvas shadows={{ type: THREE.PCFShadowMap }} dpr={high ? [1, 1.75] : 1} gl={{ antialias: !high, alpha: false, toneMappingExposure: 1.05 }}
      camera={{ position: [240, 330, 470], fov: 42, near: 1, far: 7000 }}>
      <PerformanceMonitor bounds={() => [26, 55]} flipflops={2} onDecline={onDecline} />
      {mode === 'flood' ? <FloodLights shadowSize={high ? 2048 : 1024} /> : (
        <>
          <Sky horizon="#5a4636" zenith="#1a1410" ground="#1a1410" />
          <HeatLights />
        </>
      )}
      <Fill />
      {grid && (
        <group key={grid.site.id}>
          <Terrain />
          <Buildings />
          {mode === 'flood' && (
            <>
              <Drains />
              <Interventions />
              <Water />
              <Rain />
              <Markers />
            </>
          )}
          {mode === 'heat' && heatReady && (
            <>
              <HeatOverlay />
              <Trees />
              <HeatInterventions />
              <HeatMarkers />
            </>
          )}
        </group>
      )}
      <OrbitControls makeDefault enableDamping dampingFactor={0.08} maxPolarAngle={Math.PI * 0.46} minDistance={40} maxDistance={1400} target={[0, 0, 30]} />
      <CameraRig />
      {high && <Effects />}
    </Canvas>
  );
}
