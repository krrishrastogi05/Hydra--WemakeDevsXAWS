// Terrain block: a painted base map on the exaggerated DEM, diorama skirt showing soil layers, risk overlay.
import { useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { COVER } from '../sim/types';
import type { Grid } from '../sim/model';
import { VE, half } from './geo';
import { useTools } from './useTools';

const ROAD_FILL: Record<string, string> = {
  motorway: '#2f3238', trunk: '#30333a', primary: '#34373d', secondary: '#383b41', tertiary: '#45474c',
  residential: '#6c6a65', unclassified: '#6c6a65', living_street: '#77746d', service: '#7f7b73', pedestrian: '#8a857b', track: '#8f7a5e',
};
const RANK: Record<string, number> = { track: 1, pedestrian: 1, service: 2, living_street: 3, residential: 4, unclassified: 4, tertiary: 5, secondary: 6, primary: 7, trunk: 8, motorway: 9 };

export function terrainGeometry(g: Grid) {
  const { nx, ny, n } = g, h = half(g);
  const pos = new Float32Array(n * 3), uv = new Float32Array(n * 2), idx: number[] = [];
  for (let r = 0; r < ny; r++) for (let c = 0; c < nx; c++) {
    const i = r * nx + c;
    pos.set([(c + 0.5) * g.dx - h, g.z[i] * VE, (r + 0.5) * g.dx - h], i * 3);
    uv.set([(c + 0.5) / nx, 1 - (r + 0.5) / ny], i * 2);
    if (c < nx - 1 && r < ny - 1) idx.push(i, i + nx, i + 1, i + 1, i + nx, i + nx + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function shade(hex: string, k: number) {
  const c = new THREE.Color(hex);
  c.offsetHSL(0, 0, k);
  return `#${c.getHexString()}`;
}

function baseMap(g: Grid) {
  const S = 2048, cnv = document.createElement('canvas');
  cnv.width = cnv.height = S;
  const ctx = cnv.getContext('2d')!, px = S / (g.nx * g.dx), cs = g.dx * px;
  const ground = g.site.groundColor;
  ctx.fillStyle = ground; ctx.fillRect(0, 0, S, S);
  // cells: tinted ground, gardens, yards, ponds; plot shadow under buildings; gentle noise
  for (let i = 0; i < g.n; i++) {
    const c = i % g.nx, r = (i / g.nx) | 0, cv = g.cover[i], j = (Math.sin(i * 12.9898) * 43758.5453) % 1;
    const col = cv === COVER.GREEN ? shade('#6d9450', j * 0.05) : cv === COVER.PAVED ? shade('#a6a198', j * 0.03) : cv === COVER.WATER ? '#3d6f95' : cv === COVER.CHANNEL ? '#2f5f86'
      : cv === COVER.BUILDING ? shade(ground, -0.08) : shade(ground, j * 0.035);
    ctx.fillStyle = col; ctx.fillRect(c * cs, r * cs, cs + 0.6, cs + 0.6);
  }
  // roads are painted from the simulation grid's road cells, so what you see is exactly what the engine and the
  // inspector treat as road: continuous strokes between neighbouring road cells (round joins), kerb first, then surface
  const fillOf = (i: number) => ROAD_FILL[(g.road[i] >= 0 ? g.site.roads[g.road[i]].cls : 'residential')] ?? '#6c6a65';
  const isRoad = (i: number) => g.cover[i] === COVER.ROAD;
  const strokes = new Map<string, Path2D>();
  const add = (fill: string, i: number, j: number) => {
    if (!strokes.has(fill)) strokes.set(fill, new Path2D());
    const p = strokes.get(fill)!;
    p.moveTo(((i % g.nx) + 0.5) * cs, (((i / g.nx) | 0) + 0.5) * cs);
    p.lineTo(((j % g.nx) + 0.5) * cs, (((j / g.nx) | 0) + 0.5) * cs);
  };
  for (let i = 0; i < g.n; i++) {
    if (!isRoad(i)) continue;
    const c = i % g.nx, r = (i / g.nx) | 0, f = fillOf(i);
    add(f, i, i);   // a dot, so isolated cells still show
    if (c + 1 < g.nx && isRoad(i + 1)) add(f, i, i + 1);
    if (r + 1 < g.ny && isRoad(i + g.nx)) add(f, i, i + g.nx);
  }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const [fill, p] of strokes) { ctx.strokeStyle = shade(fill, -0.09); ctx.lineWidth = cs * 1.16; ctx.stroke(p); }
  for (const [fill, p] of strokes) { ctx.strokeStyle = fill; ctx.lineWidth = cs * 1.0; ctx.stroke(p); }
  const roads = [...g.site.roads].sort((a, b) => (RANK[a.cls] ?? 0) - (RANK[b.cls] ?? 0));
  const path = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, z], k) => k ? ctx.lineTo(x * px, z * px) : ctx.moveTo(x * px, z * px)); };
  for (const rd of roads) {
    if ((RANK[rd.cls] ?? 0) < 5) continue;
    path(rd.pts); ctx.setLineDash([3 * px, 4 * px]); ctx.strokeStyle = 'rgba(240,232,210,0.55)'; ctx.lineWidth = 0.25 * px; ctx.stroke(); ctx.setLineDash([]);
  }
  const tex = new THREE.CanvasTexture(cnv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

function riskMap(g: Grid, maxDepth: Float32Array) {
  const cnv = document.createElement('canvas');
  cnv.width = g.nx; cnv.height = g.ny;
  const ctx = cnv.getContext('2d')!, img = ctx.createImageData(g.nx, g.ny);
  for (let i = 0; i < g.n; i++) {
    const d = maxDepth[i];
    if (d < 0.05 || g.cover[i] === COVER.BUILDING) continue;
    const t = Math.min(1, (d - 0.05) / 0.4);   // 5 cm -> 45 cm: amber to deep red
    img.data.set([Math.round(250 - 40 * t), Math.round(190 - 150 * t), Math.round(60 - 20 * t), Math.round(110 + 120 * t)], i * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cnv);
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/** Vertical walls around the block (soil and rock layers), like a diorama cut. */
function skirtGeometry(g: Grid) {
  const { nx, ny } = g, h = half(g), bottom = -14, pos: number[] = [], col: number[] = [], idx: number[] = [];
  const soil = new THREE.Color('#6b4f3a'), rock = new THREE.Color('#3b332d'), top = new THREE.Color('#7f6146');
  const side = (cells: number[], outward: [number, number]) => {
    const base = pos.length / 3;
    cells.forEach((i, k) => {
      const x = (i % nx + 0.5) * g.dx - h + outward[0] * 0.01, z = (((i / nx) | 0) + 0.5) * g.dx - h + outward[1] * 0.01, y = g.z[i] * VE;
      for (const [yy, cc] of [[y, top], [y - 2.2, soil], [y - 2.2, rock], [bottom, rock]] as [number, THREE.Color][]) { pos.push(x, yy, z); col.push(cc.r, cc.g, cc.b); }
      if (k) { const a = base + (k - 1) * 4, b = base + k * 4; for (const o of [0, 2]) idx.push(a + o, b + o, a + o + 1, a + o + 1, b + o, b + o + 1); }
    });
  };
  const row = (r: number) => Array.from({ length: nx }, (_, c) => r * nx + c), colm = (c: number) => Array.from({ length: ny }, (_, r) => r * nx + c);
  side(row(ny - 1), [0, 1]); side(colm(nx - 1), [1, 0]); side(row(0), [0, -1]); side(colm(0), [-1, 0]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

export function Terrain() {
  const grid = useStore(s => s.grid)!;
  const overlay = useStore(s => s.overlay);
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const geo = useMemo(() => terrainGeometry(grid), [grid]);
  const tex = useMemo(() => baseMap(grid), [grid]);
  const skirt = useMemo(() => skirtGeometry(grid), [grid]);
  const risk = useMemo(() => (result && overlay === 'risk' ? riskMap(grid, result.maxDepth) : null), [grid, result, overlay]);
  const { terrain } = useTools();
  return (
    <group>
      <mesh geometry={geo} receiveShadow {...terrain}>
        <meshStandardMaterial map={tex} roughness={0.96} metalness={0} />
      </mesh>
      {risk && (
        <mesh geometry={geo} renderOrder={1}>
          <meshBasicMaterial map={risk} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
        </mesh>
      )}
      <mesh geometry={skirt}>
        <meshStandardMaterial vertexColors roughness={1} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
