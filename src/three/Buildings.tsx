// Buildings: OSM footprints extruded to their storeys, plaster walls with windows, parapets, black rooftop tanks.
// Colours switch to flood risk (red = water above plinth, amber = water at the door) or data provenance.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useStore } from '../store';
import type { Grid } from '../sim/grid';
import { VE, half, hash } from './geo';
import { useTools } from './useTools';
import { DEPTH } from '../sim/flood/engine';
import { useHeat } from '../heatStore';

// Muted plaster and concrete, as Indian neighbourhoods actually look; strong colour is kept for flood risk only.
const PLASTER = ['#e8e2d6', '#ddd5c4', '#d6cbb5', '#cfc4ae', '#e2d9c8', '#c9c3b8', '#d9c7a8', '#cdb8a0', '#d8cfc6', '#bfb7ab'];
const ROOFS = ['#b9b3a7', '#aea89c', '#c2bcb0', '#a39d92'];
export const FLOODED = '#d64545', AT_RISK = '#e0a030';
const FLOOR_H = 3.2, PARAPET_H = 0.9, PARAPET_W = 0.28;

export interface BuildingMesh { geometry: THREE.BufferGeometry; edges: THREE.BufferGeometry; starts: Int32Array; tops: { x: number; y: number; z: number; r: number; base: number }[]; baseColor: Float32Array }

/** A soft dark radial gradient, reused by every building as a cheap "grounded" contact shadow that needs no
 *  real-time shadow map or post-processing, so it looks right even on the Low graphics tier. */
let blobTex: THREE.CanvasTexture | null = null;
function blobTexture() {
  if (blobTex) return blobTex;
  const s = 64, cnv = document.createElement('canvas');
  cnv.width = cnv.height = s;
  const ctx = cnv.getContext('2d')!, g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.38)'); g.addColorStop(0.7, 'rgba(0,0,0,0.18)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, s, s);
  blobTex = new THREE.CanvasTexture(cnv);
  return blobTex;
}

/** Per-vertex attributes the facade shader needs: where the ground floor starts and where the roof is (world y). */
function tagFloors(geo: THREE.BufferGeometry, floorBase: number, roof: number) {
  const n = geo.getAttribute('position').count;
  geo.setAttribute('floorBase', new THREE.BufferAttribute(new Float32Array(n).fill(floorBase), 1));
  geo.setAttribute('roofY', new THREE.BufferAttribute(new Float32Array(n).fill(roof), 1));
}

function paintVerts(geo: THREE.BufferGeometry, roof: THREE.Color, wall: THREE.Color) {
  const nrm = geo.getAttribute('normal'), cnt = nrm.count, col = new Float32Array(cnt * 3);
  for (let v = 0; v < cnt; v++) (nrm.getY(v) > 0.5 ? roof : wall).toArray(col, v * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  return col;
}

export function buildBuildings(g: Grid): BuildingMesh {
  const h = half(g), geos: THREE.BufferGeometry[] = [], shells: THREE.BufferGeometry[] = [], starts: number[] = [], tops: BuildingMesh['tops'] = [], cols: number[] = [];
  let vcount = 0;
  g.site.buildings.forEach((b, k) => {
    const cells = g.bCells[k].length ? g.bCells[k] : g.frontage[k];
    let base = Infinity;
    for (const c of cells) base = Math.min(base, g.z[c]);
    if (!isFinite(base)) {
      const cx = b.poly.reduce((a, p) => a + p[0], 0) / b.poly.length, cz = b.poly.reduce((a, p) => a + p[1], 0) / b.poly.length;
      const ci = Math.min(g.n - 1, Math.max(0, Math.floor(cz / g.dx) * g.nx + Math.floor(cx / g.dx)));
      base = g.z[ci];
    }
    const y0 = base * VE - 1.5, height = b.levels * FLOOR_H + b.plinth + 1.5, roofY = y0 + height;
    const pts = b.poly.map(([x, z]) => new THREE.Vector2(x - h, -(z - h)));
    if (pts.length > 2 && pts[0].equals(pts[pts.length - 1])) pts.pop();
    starts.push(vcount);
    if (pts.length < 3) { tops.push({ x: 0, y: -999, z: 0, r: 0, base: 0 }); return; }
    const jitter = (hash(k * 11 + 3) - 0.5) * 0.06;
    const wall = new THREE.Color(b.critical ? '#f2f1ec' : b.use === 'Commercial' ? '#c3cad1' : b.use === 'Religious' ? '#e3d2a4' : PLASTER[Math.floor(hash(k + 7) * PLASTER.length)]).offsetHSL(0, 0, jitter);
    const roof = new THREE.Color(ROOFS[Math.floor(hash(k * 5 + 2) * ROOFS.length)]).offsetHSL(0, 0, jitter * 0.6);
    // the block itself
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: height, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y0, 0);
    geo.deleteAttribute('uv');
    tagFloors(geo, y0 + 1.5 + b.plinth, roofY);
    cols.push(...paintVerts(geo, roof, wall));
    geos.push(geo); shells.push(geo);
    vcount += geo.getAttribute('position').count;
    // a low parapet around the roof edge: one thin wall per footprint edge (part of this building, so picking still works)
    const lip = wall.clone().offsetHSL(0, 0, 0.03);
    for (let e = 0; e < pts.length; e++) {
      const a = pts[e], c = pts[(e + 1) % pts.length], len = a.distanceTo(c);
      if (len < 0.8) continue;
      const box = new THREE.BoxGeometry(len + PARAPET_W, PARAPET_H, PARAPET_W).toNonIndexed();
      box.deleteAttribute('uv');
      box.rotateY(Math.atan2(c.y - a.y, c.x - a.x));
      box.translate((a.x + c.x) / 2, roofY + PARAPET_H / 2, -(a.y + c.y) / 2);
      tagFloors(box, 1e4, roofY);   // no windows on parapets
      cols.push(...paintVerts(box, lip, lip));
      geos.push(box);
      vcount += box.getAttribute('position').count;
    }
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cz = -pts.reduce((a, p) => a + p.y, 0) / pts.length;
    tops.push({ x: cx, y: roofY, z: cz, r: Math.sqrt(Math.max(b.area, 20)), base: y0 });
  });
  const geometry = mergeGeometries(geos, false)!;
  // model-style outlines: corners and roof / ground edges of the blocks
  const shell = mergeGeometries(shells.map(x => { const c = new THREE.BufferGeometry(); c.setAttribute('position', x.getAttribute('position')); return c; }), false)!;
  const edges = new THREE.EdgesGeometry(shell, 30);
  shell.dispose();
  geos.forEach(x => x.dispose());
  return { geometry, edges, starts: Int32Array.from([...starts, vcount]), tops, baseColor: Float32Array.from(cols) };
}

/** Walls get floors and windows from world position: a band per 3.2 m storey, panes every ~2.6 m, a darker plinth. */
function facadeMaterial() {
  const m = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.86, metalness: 0, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
  m.onBeforeCompile = sh => {
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float floorBase; attribute float roofY; varying float vFloorBase; varying float vRoofY; varying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvFloorBase = floorBase; vRoofY = roofY; vWPos = (modelMatrix * vec4(transformed, 1.0)).xyz; vWNrm = normalize(mat3(modelMatrix) * objectNormal);');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vFloorBase; varying float vRoofY; varying vec3 vWPos; varying vec3 vWNrm;')
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (abs(vWNrm.y) < 0.5 && vFloorBase < 5000.0) {
          float local = vWPos.y - vFloorBase;
          if (local < 0.0) diffuseColor.rgb *= 0.78;
          else if (vWPos.y < vRoofY - 0.5) {
            float fy = fract(local / ${FLOOR_H.toFixed(1)});
            vec2 tng = normalize(vec2(-vWNrm.z, vWNrm.x));
            float fx = fract(dot(vWPos.xz, tng) / 2.6);
            float pane = step(0.32, fy) * step(fy, 0.78) * step(0.22, fx) * step(fx, 0.72);
            float near = 1.0 - smoothstep(350.0, 950.0, distance(vWPos, cameraPosition));   // panes fade with distance, so far blocks read as plaster, not dice
            diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.2, 0.24, 0.28), pane * 0.55 * near);
            diffuseColor.rgb *= 1.0 - 0.1 * step(fy, 0.05) * near;
          }
        }`);
  };
  m.customProgramCacheKey = () => 'hydra-facade';
  return m;
}

/** Building index for a triangle of the merged mesh (non-indexed: 3 vertices per face). */
export function buildingOfFace(m: BuildingMesh, face: number) {
  const v = face * 3;
  let lo = 0, hi = m.starts.length - 2;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (m.starts[mid] <= v) lo = mid; else hi = mid - 1; }
  return lo;
}

export function Buildings() {
  const grid = useStore(s => s.grid)!;
  const mode = useStore(s => s.mode);
  const overlay = useStore(s => s.overlay);
  const plan = useStore(s => s.plan);
  const coolRoofs = useHeat(s => s.plan);
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const showRisk = useStore(s => s.peak || s.time > 0);
  const mesh = useMemo(() => buildBuildings(grid), [grid]);
  const material = useMemo(facadeMaterial, []);
  const { buildings } = useTools();
  const tankRef = useRef<THREE.InstancedMesh>(null), rwhRef = useRef<THREE.InstancedMesh>(null), shadowRef = useRef<THREE.InstancedMesh>(null);

  // wall colours: pastel, flood risk (flood mode), cool roofs (heat mode), or data provenance
  useEffect(() => {
    const attr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute, arr = attr.array as Float32Array;
    arr.set(mesh.baseColor);
    const nrm = mesh.geometry.getAttribute('normal');
    // tints into the existing plaster colour rather than overwriting it, so risk colour still reads as a wall, not a flat paint fill
    const paint = (k: number, hex: string, mix = 1) => {
      const c = new THREE.Color(hex), base = new THREE.Color();
      for (let v = mesh.starts[k]; v < mesh.starts[k + 1]; v++) if (nrm.getY(v) <= 0.5) {
        const i = v * 3;
        base.fromArray(arr, i).lerp(c, mix).toArray(arr, i);
      }
    };
    if (overlay === 'sources') grid.site.buildings.forEach((b, k) => paint(k, b.synthetic ? '#c084fc' : '#f8fafc'));
    else if (mode === 'heat') {
      const white = new THREE.Color('#f8fbff');
      for (const p of coolRoofs) if (p.type === 'coolroof') for (let v = mesh.starts[p.building!]; v < mesh.starts[p.building! + 1]; v++) if (nrm.getY(v) > 0.5) white.toArray(arr, v * 3);
    } else if (result && showRisk) grid.site.buildings.forEach((b, k) => {
      const d = result.doorstep[k];
      if (d > b.plinth) paint(k, FLOODED, 0.65); else if (d > DEPTH.wet) paint(k, AT_RISK, 0.65);
    });
    attr.needsUpdate = true;
  }, [mesh, overlay, result, showRisk, grid, mode, coolRoofs]);

  // rooftop water tanks (decorative: most Indian flat roofs carry one) and blue RWH tanks from the plan
  const rwh = useMemo(() => new Set(mode === 'flood' ? plan.filter(p => p.type === 'rwh').map(p => p.building!) : []), [plan, mode]);
  const tankIds = useMemo(() => mesh.tops.map((t, k) => (t.y > -999 && grid.site.buildings[k].use === 'Residential' && hash(k * 3 + 1) < 0.55 ? k : -1)).filter(k => k >= 0), [mesh, grid]);
  const groundIds = useMemo(() => mesh.tops.map((t, k) => (t.y > -999 ? k : -1)).filter(k => k >= 0), [mesh]);
  useEffect(() => {
    const m = new THREE.Matrix4(), place = (inst: THREE.InstancedMesh | null, ids: number[], s: number) => {
      if (!inst) return;
      ids.forEach((k, j) => { const t = mesh.tops[k]; m.makeScale(s, s, s).setPosition(t.x + 1.2, t.y + s * 0.6, t.z + 0.8); inst.setMatrixAt(j, m); });
      inst.count = ids.length; inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere();
    };
    place(tankRef.current, tankIds.filter(k => !rwh.has(k)), 1);
    place(rwhRef.current, [...rwh].filter(k => mesh.tops[k]?.y > -999), 1.9);
  }, [mesh, tankIds, rwh]);
  useEffect(() => {
    const inst = shadowRef.current;
    if (!inst) return;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));
    groundIds.forEach((k, j) => { const t = mesh.tops[k], s = t.r * 1.9; m.compose(new THREE.Vector3(t.x, t.base + 0.03, t.z), q, new THREE.Vector3(s, s, 1)); inst.setMatrixAt(j, m); });
    inst.count = groundIds.length; inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere();
  }, [mesh, groundIds]);

  return (
    <group>
      {/* cheap always-on "grounding" for buildings: a soft dark blob under each footprint, independent of real shadow maps or post-processing */}
      <instancedMesh ref={shadowRef} args={[undefined, undefined, Math.max(1, groundIds.length)]} renderOrder={1} raycast={() => null}>
        <planeGeometry args={[1, 1]} />
        <meshBasicMaterial map={blobTexture()} transparent depthWrite={false} toneMapped={false} polygonOffset polygonOffsetFactor={-1} polygonOffsetUnits={-1} />
      </instancedMesh>
      <mesh geometry={mesh.geometry} material={material} castShadow receiveShadow
        onPointerMove={e => e.faceIndex != null && buildings.onPointerMove(e, buildingOfFace(mesh, e.faceIndex))}
        onClick={e => e.faceIndex != null && buildings.onClick(e, buildingOfFace(mesh, e.faceIndex))}
        onPointerOut={buildings.onPointerOut}>
      </mesh>
      <lineSegments geometry={mesh.edges} raycast={() => null}><lineBasicMaterial color="#1b1f24" transparent opacity={0.22} /></lineSegments>
      <instancedMesh ref={tankRef} args={[undefined, undefined, Math.max(1, tankIds.length)]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 1.2, 10]} />
        <meshStandardMaterial color="#1d1f22" roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={rwhRef} args={[undefined, undefined, Math.max(1, grid.site.buildings.length)]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 1.2, 14]} />
        <meshStandardMaterial color="#3b9fd6" emissive="#0e7fb8" emissiveIntensity={0.18} roughness={0.45} />
      </instancedMesh>
    </group>
  );
}
