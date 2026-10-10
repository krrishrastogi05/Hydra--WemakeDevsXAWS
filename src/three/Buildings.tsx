// Buildings: OSM footprints extruded to their storeys, pastel walls, concrete roofs, black rooftop tanks.
// Colours switch to flood risk (red = water above plinth, amber = water at the door) or data provenance.
import { useEffect, useMemo, useRef } from 'react';
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { useStore } from '../store';
import type { Grid } from '../sim/grid';
import { VE, half, hash } from './geo';
import { useTools } from './useTools';
import { DEPTH } from '../sim/flood/engine';

const PASTEL = ['#e9c9a3', '#e3d29b', '#b8d6c2', '#a9c4e2', '#ecb7b0', '#ede4cf', '#cdbfe2', '#f2d377', '#d9e3a8', '#f0c1d4', '#c9e0e8', '#f4d6b5'];
const ROOF = new THREE.Color('#c9c3b6');
export const FLOODED = '#ef4444', AT_RISK = '#f59e0b';

export interface BuildingMesh { geometry: THREE.BufferGeometry; starts: Int32Array; tops: { x: number; y: number; z: number; r: number }[]; baseColor: Float32Array }

export function buildBuildings(g: Grid): BuildingMesh {
  const h = half(g), geos: THREE.BufferGeometry[] = [], starts: number[] = [], tops: BuildingMesh['tops'] = [], cols: number[] = [];
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
    const y0 = base * VE - 1.5, height = b.levels * 3.2 + b.plinth + 1.5;
    const pts = b.poly.map(([x, z]) => new THREE.Vector2(x - h, -(z - h)));
    if (pts.length > 2 && pts[0].equals(pts[pts.length - 1])) pts.pop();
    starts.push(vcount);
    if (pts.length < 3) { tops.push({ x: 0, y: -999, z: 0, r: 0 }); return; }
    const geo = new THREE.ExtrudeGeometry(new THREE.Shape(pts), { depth: height, bevelEnabled: false });
    geo.rotateX(-Math.PI / 2);
    geo.translate(0, y0, 0);
    geo.deleteAttribute('uv');
    const wall = new THREE.Color(b.critical ? '#f4f4f0' : b.use === 'Commercial' ? '#c7d2dc' : b.use === 'Religious' ? '#f3dfa6' : PASTEL[Math.floor(hash(k + 7) * PASTEL.length)]);
    const nrm = geo.getAttribute('normal'), cnt = nrm.count, col = new Float32Array(cnt * 3);
    for (let v = 0; v < cnt; v++) (nrm.getY(v) > 0.5 ? ROOF : wall).toArray(col, v * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    cols.push(...col);
    geos.push(geo);
    vcount += cnt;
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length, cz = -pts.reduce((a, p) => a + p.y, 0) / pts.length;
    tops.push({ x: cx, y: y0 + height, z: cz, r: Math.sqrt(Math.max(b.area, 20)) });
  });
  const geometry = mergeGeometries(geos, false)!;
  geos.forEach(x => x.dispose());
  return { geometry, starts: Int32Array.from([...starts, vcount]), tops, baseColor: Float32Array.from(cols) };
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
  const overlay = useStore(s => s.overlay);
  const plan = useStore(s => s.plan);
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const showRisk = useStore(s => s.peak || s.time > 0);
  const mesh = useMemo(() => buildBuildings(grid), [grid]);
  const { buildings } = useTools();
  const tankRef = useRef<THREE.InstancedMesh>(null), rwhRef = useRef<THREE.InstancedMesh>(null);

  // wall colours: pastel, flood risk, or data provenance
  useEffect(() => {
    const attr = mesh.geometry.getAttribute('color') as THREE.BufferAttribute, arr = attr.array as Float32Array;
    arr.set(mesh.baseColor);
    const nrm = mesh.geometry.getAttribute('normal');
    const paint = (k: number, hex: string) => {
      const c = new THREE.Color(hex);
      for (let v = mesh.starts[k]; v < mesh.starts[k + 1]; v++) if (nrm.getY(v) <= 0.5) c.toArray(arr, v * 3);
    };
    if (overlay === 'sources') grid.site.buildings.forEach((b, k) => paint(k, b.synthetic ? '#c084fc' : '#f8fafc'));
    else if (result && showRisk) grid.site.buildings.forEach((b, k) => {
      const d = result.doorstep[k];
      if (d > b.plinth) paint(k, FLOODED); else if (d > DEPTH.wet) paint(k, AT_RISK);
    });
    attr.needsUpdate = true;
  }, [mesh, overlay, result, showRisk, grid]);

  // rooftop water tanks (decorative: most Indian flat roofs carry one) and blue RWH tanks from the plan
  const rwh = useMemo(() => new Set(plan.filter(p => p.type === 'rwh').map(p => p.building!)), [plan]);
  const tankIds = useMemo(() => mesh.tops.map((t, k) => (t.y > -999 && grid.site.buildings[k].use === 'Residential' && hash(k * 3 + 1) < 0.55 ? k : -1)).filter(k => k >= 0), [mesh, grid]);
  useEffect(() => {
    const m = new THREE.Matrix4(), place = (inst: THREE.InstancedMesh | null, ids: number[], s: number) => {
      if (!inst) return;
      ids.forEach((k, j) => { const t = mesh.tops[k]; m.makeScale(s, s, s).setPosition(t.x + 1.2, t.y + s * 0.6, t.z + 0.8); inst.setMatrixAt(j, m); });
      inst.count = ids.length; inst.instanceMatrix.needsUpdate = true; inst.computeBoundingSphere();
    };
    place(tankRef.current, tankIds.filter(k => !rwh.has(k)), 1);
    place(rwhRef.current, [...rwh].filter(k => mesh.tops[k]?.y > -999), 1.9);
  }, [mesh, tankIds, rwh]);

  return (
    <group>
      <mesh geometry={mesh.geometry} castShadow receiveShadow
        onPointerMove={e => e.faceIndex != null && buildings.onPointerMove(e, buildingOfFace(mesh, e.faceIndex))}
        onClick={e => e.faceIndex != null && buildings.onClick(e, buildingOfFace(mesh, e.faceIndex))}
        onPointerOut={buildings.onPointerOut}>
        <meshStandardMaterial vertexColors roughness={0.82} metalness={0.02} />
      </mesh>
      <instancedMesh ref={tankRef} args={[undefined, undefined, Math.max(1, tankIds.length)]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 1.2, 10]} />
        <meshStandardMaterial color="#1d1f22" roughness={0.6} />
      </instancedMesh>
      <instancedMesh ref={rwhRef} args={[undefined, undefined, Math.max(1, grid.site.buildings.length)]} castShadow>
        <cylinderGeometry args={[0.55, 0.55, 1.2, 14]} />
        <meshStandardMaterial color="#38bdf8" emissive="#0ea5e9" emissiveIntensity={0.45} roughness={0.4} />
      </instancedMesh>
    </group>
  );
}
