// Water surface, rain and the drain network. All three read the playback clock from the store every frame
// (imperatively, so React does not re-render 60 times a second).
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import type { SimResult } from '../sim/types';
import { VE, cellX, cellY, cellZ } from './geo';
import { terrainGeometry } from './Terrain';

const displayed = () => { const s = useStore.getState(); return (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline; };

/** Fractional frame index for a playback time in minutes. */
function frameAt(res: SimResult, t: number) {
  const step = res.nFrames > 1 ? res.frameTimes[1] - res.frameTimes[0] : 1;
  const f = Math.max(0, Math.min(res.nFrames - 1, t / step));
  const k = Math.min(res.nFrames - 2, Math.floor(f));
  return { k: Math.max(0, k), a: res.nFrames > 1 ? f - Math.max(0, k) : 0 };
}

const waterVert = /* glsl */`
  attribute float depth; attribute float ground; uniform float uVE; varying float vDepth; varying vec3 vWorld;
  void main() {
    vDepth = depth;
    vec3 p = position;
    p.y = depth > 0.003 ? ground + depth * uVE + 0.06 : ground - 0.4;
    vec4 w = modelMatrix * vec4(p, 1.0); vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }`;
const waterFrag = /* glsl */`
  uniform float uTime; varying float vDepth; varying vec3 vWorld;
  void main() {
    if (vDepth < 0.004) discard;
    float t = smoothstep(0.02, 0.42, vDepth);
    vec3 col = mix(vec3(0.62, 0.86, 0.95), vec3(0.05, 0.26, 0.52), t);
    float rip = sin(vWorld.x * 0.72 + uTime * 1.7) * sin(vWorld.z * 0.63 - uTime * 1.25) + 0.5 * sin((vWorld.x + vWorld.z) * 1.9 - uTime * 2.3);
    col += rip * 0.03;
    gl_FragColor = vec4(col, mix(0.42, 0.9, smoothstep(0.004, 0.22, vDepth)));
  }`;

export function Water() {
  const grid = useStore(s => s.grid)!;
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const geo = useMemo(() => {
    const g = terrainGeometry(grid), pos = g.getAttribute('position'), ground = new Float32Array(grid.n);
    for (let i = 0; i < grid.n; i++) ground[i] = pos.getY(i);
    g.setAttribute('ground', new THREE.BufferAttribute(ground, 1));
    g.setAttribute('depth', new THREE.BufferAttribute(new Float32Array(grid.n), 1));
    return g;
  }, [grid]);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uVE: { value: VE } } }), []);
  const peak = useMemo(() => {   // deepest water each cell saw (for the "peak flood" view)
    if (!result?.frames) return null;
    const out = new Float32Array(result.n);
    for (let f = 0; f < result.nFrames; f++) { const o = f * result.n; for (let i = 0; i < result.n; i++) { const v = result.frames[o + i]; if (v > out[i]) out[i] = v; } }
    return out;
  }, [result]);
  const last = useRef('');
  useEffect(() => { last.current = ''; }, [result]);
  useFrame(state => {
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    const s = useStore.getState(), res = result;
    const attr = geo.getAttribute('depth') as THREE.BufferAttribute, d = attr.array as Float32Array;
    if (!res?.frames || !peak) { if (last.current !== 'none') { d.fill(0); attr.needsUpdate = true; last.current = 'none'; } return; }
    const key = s.peak ? 'peak' : `t${s.time.toFixed(2)}`;
    if (key === last.current) return;
    last.current = key;
    if (s.peak) for (let i = 0; i < res.n; i++) d[i] = peak[i] / 1000;
    else {
      const { k, a } = frameAt(res, s.time), o0 = k * res.n, o1 = Math.min(res.nFrames - 1, k + 1) * res.n;
      for (let i = 0; i < res.n; i++) d[i] = (res.frames[o0 + i] * (1 - a) + res.frames[o1 + i] * a) / 1000;
    }
    attr.needsUpdate = true;
  });
  return <mesh geometry={geo} material={mat} renderOrder={2} frustumCulled={false} />;
}

const rainVert = /* glsl */`
  attribute vec4 seed; uniform float uTime; uniform float uIntensity; uniform float uSize; varying float vA;
  void main() {
    float H = 240.0;
    float y = mod(seed.z * H - uTime * (95.0 + seed.w * 40.0), H) + 10.0;
    float visible = step(seed.w, uIntensity);
    vec3 p = vec3(seed.x * uSize - uSize * 0.5 + y * 0.06, y + position.y * 4.5, seed.y * uSize - uSize * 0.5);
    vA = visible * (0.25 + 0.35 * seed.w);
    gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0) * visible + vec4(0.0, 0.0, -2.0, 1.0) * (1.0 - visible);
  }`;
const rainFrag = /* glsl */`varying float vA; void main() { gl_FragColor = vec4(0.78, 0.86, 0.95, vA); }`;

export function Rain() {
  const grid = useStore(s => s.grid)!;
  const N = 9000;
  const geo = useMemo(() => {
    const g = new THREE.BufferGeometry(), pos = new Float32Array(N * 6), seed = new Float32Array(N * 8);
    for (let k = 0; k < N; k++) {
      pos.set([0, 0, 0, 0, 1, 0], k * 6);
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      seed.set([...s, ...s], k * 8);
    }
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('seed', new THREE.BufferAttribute(seed, 4));
    return g;
  }, []);
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: rainVert, fragmentShader: rainFrag, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uIntensity: { value: 0 }, uSize: { value: grid.nx * grid.dx * 1.25 } } }), [grid]);
  useFrame(state => {
    const s = useStore.getState(), res = displayed();
    let mmh = 0;
    if (res && !s.peak && s.time > 0) { const { k, a } = frameAt(res, s.time); mmh = res.rainSeries[k] * (1 - a) + res.rainSeries[Math.min(res.nFrames - 1, k + 1)] * a; }
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uIntensity.value += (Math.min(1, mmh / 70) - mat.uniforms.uIntensity.value) * 0.08;
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}

const C_IDLE = new THREE.Color('#5f4c34'), C_NEW = new THREE.Color('#cfd8e3'), C_CLEAN = new THREE.Color('#a78bfa');
const C_FLOW = new THREE.Color('#38bdf8'), C_BUSY = new THREE.Color('#fbbf24'), C_FULL = new THREE.Color('#fb923c'), C_SUR = new THREE.Color('#ef4444');

export function Drains() {
  const grid = useStore(s => s.grid)!;
  const show = useStore(s => s.showDrains);
  const plan = useStore(s => s.plan);
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const ref = useRef<THREE.InstancedMesh>(null);
  const layout = useMemo(() => {
    if (!result) return null;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), mats: THREE.Matrix4[] = [];
    result.drainCells.forEach((c, k) => {
      const d = result.drainDown[k], x0 = cellX(grid, c), z0 = cellZ(grid, c), y0 = cellY(grid, c) + 0.15;
      let x1 = x0 + 1.6, z1 = z0, y1 = y0;
      if (d >= 0) { x1 = cellX(grid, d); z1 = cellZ(grid, d); y1 = cellY(grid, d) + 0.15; }
      const len = Math.hypot(x1 - x0, z1 - z0);
      q.setFromAxisAngle(up, -Math.atan2(z1 - z0, x1 - x0));
      m.compose(new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2), q, new THREE.Vector3(len, 0.35, 1.1));
      mats.push(m.clone());
    });
    return mats;
  }, [result, grid]);
  const base = useMemo(() => {
    if (!result) return [];
    const desilted = new Set(plan.filter(p => p.type === 'desilt').map(p => p.unit));
    return Array.from(result.drainCells, c => (grid.drain[c] < 0 ? C_NEW : desilted.has(grid.drain[c]) ? C_CLEAN : C_IDLE));
  }, [result, plan, grid]);
  useEffect(() => {
    const inst = ref.current;
    if (!inst || !layout) return;
    layout.forEach((m, k) => { inst.setMatrixAt(k, m); inst.setColorAt(k, base[k] ?? C_IDLE); });
    inst.count = layout.length;
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    (inst.material as THREE.Material).needsUpdate = true;   // instance colours exist now: recompile with them
    inst.computeBoundingSphere();
    last.current = '';
  }, [layout, base]);
  const last = useRef('');
  useFrame(() => {
    const inst = ref.current, s = useStore.getState(), res = result;
    if (!inst || !res || !layout) return;
    const key = `${s.peak}|${s.time.toFixed(1)}|${base.length}`;
    if (key === last.current) return;
    last.current = key;
    const col = new THREE.Color();
    let k0 = 0, a = 0, o0 = 0, o1 = 0;
    const nd = res.drainCells.length;
    if (res.drainFrames && !s.peak) { const f = frameAt(res, s.time); k0 = f.k; a = f.a; o0 = k0 * nd; o1 = Math.min(res.nFrames - 1, k0 + 1) * nd; }
    for (let k = 0; k < nd; k++) {
      let u: number;
      if (s.peak) { const p = res.drainPeak[res.drainCells[k]]; u = p >= 2 ? 2 : p; }
      else if (res.drainFrames) { const v0 = res.drainFrames[o0 + k], v1 = res.drainFrames[o1 + k]; u = v0 === 255 || v1 === 255 ? 2 : (v0 * (1 - a) + v1 * a) / 254; }
      else u = 0;
      if (u >= 2) col.copy(C_SUR);
      else if (u < 0.05) col.copy(base[k]);
      else if (u < 0.7) col.copy(base[k]).lerp(C_FLOW, Math.min(1, u / 0.35));
      else if (u < 0.97) col.copy(C_FLOW).lerp(C_BUSY, (u - 0.7) / 0.27);
      else col.copy(C_FULL);
      inst.setColorAt(k, col);
    }
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
  });
  if (!layout) return null;
  return (
    <instancedMesh key={layout.length} ref={ref} args={[undefined, undefined, Math.max(1, layout.length)]} visible={show} frustumCulled={false}>
      <boxGeometry />
      <meshBasicMaterial toneMapped={false} />
    </instancedMesh>
  );
}

