// The 3D stage: sky, light, orbit camera, and every layer of the neighbourhood.
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, Lightformer, OrbitControls, PerformanceMonitor } from '@react-three/drei';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import { useStore } from '../store';
import { RiskOverlay, Terrain } from './Terrain';
import { SideGroup, SplitRenderer, useSplitOn } from './split';
import { Buildings } from './Buildings';
import { Drains, Rain, Water, rainRate } from './flood/Water';
import { Interventions } from './flood/Interventions';
import { Markers } from './flood/Markers';
import { HeatInterventions, HeatLights, HeatMarkers, HeatOverlay, SiteTrees, Trees } from './heat/HeatLayer';
import { useHeat } from '../heatStore';
import { Effects } from './Effects';

/** Click-drag orbits by default (easiest gesture on a laptop trackpad, no second button needed); holding Shift
 *  switches the same drag to pan, so panning never requires a right-click-drag. */
function useShiftToPan(ref: React.RefObject<OrbitControlsImpl | null>) {
  useEffect(() => {
    const set = (pan: boolean) => { const c = ref.current; if (c) c.mouseButtons.LEFT = pan ? THREE.MOUSE.PAN : THREE.MOUSE.ROTATE; };
    const down = (e: KeyboardEvent) => e.key === 'Shift' && set(true);
    const up = (e: KeyboardEvent) => e.key === 'Shift' && set(false);
    const blur = () => set(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => { window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); window.removeEventListener('blur', blur); };
  }, [ref]);
}

const ARROWS = new Set(['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']);

/** Holding Space turns the pointer into a hand and pans the ground plane: either by moving the mouse (no click
 *  needed) or, while Space is held, with the arrow keys — whichever gesture reads as "move" to the viewer.
 *  Movement is constrained to the horizontal plane (forward/back along the view direction, strafe left/right),
 *  not raw screen-space panning, so the ground stays level. */
function useSpacePan(ref: React.RefObject<OrbitControlsImpl | null>) {
  useEffect(() => {
    let space = false, last: { x: number; y: number } | null = null, raf = 0;
    const held = new Set<string>();
    const typing = () => { const t = document.activeElement; return t instanceof HTMLElement && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable); };
    const setCursor = () => { document.body.style.cursor = space ? 'grab' : ''; };

    const panBy = (worldDx: number, worldDz_forward: number) => {
      const c = ref.current;
      if (!c) return;
      const cam = c.object as THREE.PerspectiveCamera;
      const dir = new THREE.Vector3(); cam.getWorldDirection(dir); dir.y = 0; dir.normalize();
      const right = dir.clone().cross(new THREE.Vector3(0, 1, 0)).normalize();
      const delta = new THREE.Vector3().addScaledVector(right, worldDx).addScaledVector(dir, worldDz_forward);
      c.target.add(delta);
      cam.position.add(delta);
      c.update();
    };

    const tick = () => {
      raf = requestAnimationFrame(tick);
      if (!space || !held.size) return;
      const c = ref.current;
      if (!c) return;
      const cam = c.object as THREE.PerspectiveCamera;
      const speed = cam.position.distanceTo(c.target) * 0.9;   // world units/sec, scales with zoom so it always feels the same
      const dt = 1 / 60;
      let dx = 0, dz = 0;
      if (held.has('ArrowLeft')) dx -= 1;
      if (held.has('ArrowRight')) dx += 1;
      if (held.has('ArrowUp')) dz += 1;
      if (held.has('ArrowDown')) dz -= 1;
      if (dx || dz) panBy(dx * speed * dt, dz * speed * dt);
    };

    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !space && !typing()) {
        e.preventDefault(); space = true; last = null; setCursor();
        const c = ref.current; if (c) c.enableRotate = false;
      }
      if (space && ARROWS.has(e.code)) { e.preventDefault(); held.add(e.code); }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        space = false; last = null; held.clear(); setCursor();
        const c = ref.current; if (c) c.enableRotate = true;
      }
      if (ARROWS.has(e.code)) held.delete(e.code);
    };
    const move = (e: PointerEvent) => {
      const c = ref.current;
      if (!space || !c) return;
      if (!last) { last = { x: e.clientX, y: e.clientY }; return; }
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      last = { x: e.clientX, y: e.clientY };
      if (!dx && !dy) return;
      const cam = c.object as THREE.PerspectiveCamera;
      const dist = cam.position.distanceTo(c.target);
      const scale = (2 * Math.tan((cam.fov * Math.PI) / 360) * dist) / window.innerHeight;
      panBy(-dx * scale, dy * scale);
    };
    const blur = () => { space = false; last = null; held.clear(); setCursor(); const c = ref.current; if (c) c.enableRotate = true; };

    raf = requestAnimationFrame(tick);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('pointermove', move);
    window.addEventListener('blur', blur);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('blur', blur);
      document.body.style.cursor = '';
    };
  }, [ref]);
}

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

const CALM = { sun: 2.1, hemi: 0.8, fogNear: 1000, fogFar: 2600, horizon: new THREE.Color('#3a4c5f'), zenith: new THREE.Color('#0e1824'), fog: new THREE.Color('#2a3846') };
const STORM = { sun: 0.8, hemi: 0.55, fogNear: 520, fogFar: 1700, horizon: new THREE.Color('#2a3138'), zenith: new THREE.Color('#0b0f14'), fog: new THREE.Color('#222a32') };

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
      <Sky horizon="#3a4c5f" zenith="#0e1824" ground="#2f2b28" skyRef={sky} />
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
    <Environment resolution={128} frames={1} environmentIntensity={0.9}>
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
  const split = useSplitOn();
  const declined = useRef(false);
  const orbitRef = useRef<OrbitControlsImpl>(null);
  useShiftToPan(orbitRef);
  useSpacePan(orbitRef);
  const onDecline = () => {
    const st = useStore.getState();
    if (declined.current || st.quality === 'low' || st.qualityChosen) return;
    declined.current = true;
    useStore.setState({ quality: 'low' });   // not persisted: the next visit tries High again
    useStore.getState().notify('Graphics switched to Low to keep the map smooth. Change it in the map legend.');
  };
  return (
    <Canvas shadows={{ type: high ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap }} dpr={high ? [1, 1.5] : 1} gl={{ antialias: !high, alpha: false, toneMappingExposure: 1.2 }}
      camera={{ position: [240, 330, 470], fov: 42, near: 1, far: 7000 }}>
      <PerformanceMonitor bounds={() => [26, 55]} flipflops={2} onDecline={onDecline} />
      {mode === 'flood' ? <FloodLights shadowSize={high ? 1536 : 1024} /> : (
        <>
          <Sky horizon="#5a4636" zenith="#1a1410" ground="#2f2b28" />
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
              <SiteTrees />
              <Rain />
              <Markers hotspots={!split} />
              {split ? (
                <>
                  <SideGroup side="left"><RiskOverlay /><Drains /><Water /></SideGroup>
                  <SideGroup side="right"><RiskOverlay /><Drains /><Interventions /><Water /></SideGroup>
                </>
              ) : (
                <><RiskOverlay /><Drains /><Interventions /><Water /></>
              )}
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
      <OrbitControls
        ref={orbitRef}
        makeDefault enableDamping dampingFactor={0.08}
        maxPolarAngle={Math.PI * 0.46} minDistance={40} maxDistance={1400} target={[0, 0, 30]}
        zoomSpeed={0.9} rotateSpeed={0.6} panSpeed={0.9} screenSpacePanning zoomToCursor
        mouseButtons={{ LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }}
        touches={{ ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_PAN }}
      />
      <CameraRig />
      {split ? <SplitRenderer /> : <Effects tier={high ? 'high' : 'low'} />}
    </Canvas>
  );
}
