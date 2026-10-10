// Water surface, rain and the drain network. All three read the playback clock from the store every frame
// (imperatively, so React does not re-render 60 times a second).
import { useFrame } from '@react-three/fiber';
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store';
import type { SimResult } from '../../sim/flood/types';
import { VE, cellX, cellY, cellZ } from '../geo';
import { terrainGeometry } from '../Terrain';

const displayed = () => { const s = useStore.getState(); return (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline; };

/** Fractional frame index for a playback time in minutes. */
function frameAt(res: SimResult, t: number) {
  const step = res.nFrames > 1 ? res.frameTimes[1] - res.frameTimes[0] : 1;
  const f = Math.max(0, Math.min(res.nFrames - 1, t / step));
  const k = Math.min(res.nFrames - 2, Math.floor(f));
  return { k: Math.max(0, k), a: res.nFrames > 1 ? f - Math.max(0, k) : 0 };
}

/** Rain falling at the playback time, mm/h (0 at the peak view or before play). Shared by the rain and the storm light. */
export function rainRate() {
  const s = useStore.getState(), res = displayed();
  if (!res || s.peak || s.time <= 0) return 0;
  const { k, a } = frameAt(res, s.time);
  return res.rainSeries[k] * (1 - a) + res.rainSeries[Math.min(res.nFrames - 1, k + 1)] * a;
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
  uniform float uTime; uniform vec3 uSun; uniform float uRain; uniform vec3 uSky; varying float vDepth; varying vec3 vWorld;
  float wave(vec2 p, float t) { return sin(p.x * 0.72 + t * 1.7) * sin(p.y * 0.63 - t * 1.25) + 0.5 * sin((p.x + p.y) * 1.9 - t * 2.3); }
  void main() {
    if (vDepth < 0.004) discard;
    // water is the key data on the map, so it stays clearly blue against the taupe ground: grey-teal when shallow, deep blue when deep
    vec3 col = mix(vec3(0.36, 0.58, 0.66), vec3(0.03, 0.19, 0.39), smoothstep(0.02, 0.42, vDepth));
    vec2 p = vWorld.xz;
    float h0 = wave(p, uTime), hx = wave(p + vec2(0.4, 0.0), uTime), hz = wave(p + vec2(0.0, 0.4), uTime);
    vec3 n = normalize(vec3(-(hx - h0) * 0.3, 1.0, -(hz - h0) * 0.3));
    if (uRain > 0.01) {   // raindrop rings, one per 3 m tile, each on its own phase
      vec2 cell = floor(p / 3.0), f = fract(p / 3.0) - 0.5;
      float rnd = fract(sin(dot(cell, vec2(12.9898, 78.233))) * 43758.5453), ph = fract(uTime * 0.9 + rnd);
      float r = length(f + (rnd - 0.5) * 0.3), ring = smoothstep(0.045, 0.0, abs(r - ph * 0.45)) * (1.0 - ph) * uRain;
      n = normalize(n + vec3(f.x, 0.0, f.y) * ring * 1.2);
      col += ring * 0.06;
    }
    vec3 V = normalize(cameraPosition - vWorld);
    float fres = pow(1.0 - max(dot(n, V), 0.0), 3.0);
    col = mix(col, uSky, fres * 0.45);
    col += pow(max(dot(n, normalize(normalize(uSun) + V)), 0.0), 80.0) * 0.4 * (1.0 - 0.7 * uRain);
    float a = mix(0.62, 0.93, smoothstep(0.02, 0.25, vDepth)) * smoothstep(0.003, 0.015, vDepth);
    gl_FragColor = vec4(col, a);
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
  const mat = useMemo(() => new THREE.ShaderMaterial({ vertexShader: waterVert, fragmentShader: waterFrag, transparent: true, depthWrite: false, uniforms: { uTime: { value: 0 }, uVE: { value: VE }, uSun: { value: new THREE.Vector3(-260, 420, 220) }, uRain: { value: 0 }, uSky: { value: new THREE.Color('#8c99a6') } } }), []);
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
    mat.uniforms.uRain.value += (Math.min(1, rainRate() / 50) - mat.uniforms.uRain.value) * 0.08;
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
    vec3 p = vec3(seed.x * uSize - uSize * 0.5 + y * (0.04 + 0.05 * seed.y), y + position.y * (3.5 + 3.5 * uIntensity), seed.y * uSize - uSize * 0.5);
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
    const mmh = rainRate();
    mat.uniforms.uTime.value = state.clock.elapsedTime;
    mat.uniforms.uIntensity.value += (Math.min(1, mmh / 70) - mat.uniforms.uIntensity.value) * 0.08;
  });
  return <lineSegments geometry={geo} material={mat} frustumCulled={false} renderOrder={3} />;
}

const C_IDLE = new THREE.Color('#2b2620'), C_NEW = new THREE.Color('#9aa6b2'), C_CLEAN = new THREE.Color('#8b78d6');
const C_FLOW = new THREE.Color('#38bdf8'), C_BUSY = new THREE.Color('#fbbf24'), C_FULL = new THREE.Color('#fb923c'), C_SUR = new THREE.Color('#ef4444');

export function Drains() {
  const grid = useStore(s => s.grid)!;
  const show = useStore(s => s.showDrains);
  const plan = useStore(s => s.plan);
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const ref = useRef<THREE.InstancedMesh>(null);
  const lipRef = useRef<THREE.InstancedMesh>(null);
  const layout = useMemo(() => {
    if (!result) return null;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), mats: THREE.Matrix4[] = [], lips: THREE.Matrix4[] = [];
    result.drainCells.forEach((c, k) => {
      const d = result.drainDown[k], x0 = cellX(grid, c), z0 = cellZ(grid, c), y0 = cellY(grid, c);
      let x1 = x0 + 1.6, z1 = z0, y1 = y0;
      if (d >= 0) { x1 = cellX(grid, d); z1 = cellZ(grid, d); y1 = cellY(grid, d); }
      const len = Math.hypot(x1 - x0, z1 - z0), mid = new THREE.Vector3((x0 + x1) / 2, (y0 + y1) / 2, (z0 + z1) / 2);
      q.setFromAxisAngle(up, -Math.atan2(z1 - z0, x1 - x0));
      lips.push(m.compose(mid.clone().setY(mid.y + 0.12), q, new THREE.Vector3(len + 0.3, 0.24, 1.35)).clone());   // concrete channel walls
      mats.push(m.compose(mid.clone().setY(mid.y + 0.27), q, new THREE.Vector3(len, 0.08, 0.62)).clone());       // the water line inside
    });
    return { mats, lips };
  }, [result, grid]);
  const base = useMemo(() => {
    if (!result) return [];
    const desilted = new Set(plan.filter(p => p.type === 'desilt').map(p => p.unit));
    return Array.from(result.drainCells, c => (grid.drain[c] < 0 ? C_NEW : desilted.has(grid.drain[c]) ? C_CLEAN : C_IDLE));
  }, [result, plan, grid]);
  useEffect(() => {
    const inst = ref.current;
    if (!inst || !layout) return;
    layout.mats.forEach((m, k) => { inst.setMatrixAt(k, m); inst.setColorAt(k, base[k] ?? C_IDLE); });
    inst.count = layout.mats.length;
    const lip = lipRef.current;
    if (lip) { layout.lips.forEach((m, k) => lip.setMatrixAt(k, m)); lip.count = layout.lips.length; lip.instanceMatrix.needsUpdate = true; lip.computeBoundingSphere(); }
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
    <group visible={show}>
      <instancedMesh key={`lip${layout.lips.length}`} ref={lipRef} args={[undefined, undefined, Math.max(1, layout.lips.length)]} frustumCulled={false} receiveShadow raycast={() => null}>
        <boxGeometry />
        <meshStandardMaterial color="#86837c" roughness={0.9} />
      </instancedMesh>
      <instancedMesh key={layout.mats.length} ref={ref} args={[undefined, undefined, Math.max(1, layout.mats.length)]} frustumCulled={false} raycast={() => null}>
        <boxGeometry />
        <meshBasicMaterial toneMapped={false} />
      </instancedMesh>
    </group>
  );
}

