// Terrain block: a painted base map (soft land cover, OSM roads at their width) on the exaggerated DEM, diorama skirt, risk overlay.
import { useMemo } from 'react';
import * as THREE from 'three';
import { useStore } from '../store';
import { COVER } from '../sim/types';
import type { Grid } from '../sim/grid';
import { VE, half } from './geo';
import { useTools } from './useTools';

const ROAD_FILL: Record<string, string> = {
  motorway: '#2e3033', trunk: '#303235', primary: '#35373a', secondary: '#3a3c3f', tertiary: '#424447',
  residential: '#535250', unclassified: '#535250', living_street: '#5b5a57', service: '#63615d', pedestrian: '#6e6b66', track: '#75695a',
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

/** A tileable speckle so open ground and paving read as material, not flat paint. */
function grain(ctx: CanvasRenderingContext2D) {
  const t = document.createElement('canvas');
  t.width = t.height = 256;
  const c = t.getContext('2d')!, img = c.createImageData(256, 256);
  for (let i = 0; i < 256 * 256; i++) { const v = (Math.sin(i * 12.9898 + (i >> 8) * 78.233) * 43758.5453) % 1; const g = 128 + Math.round(Math.abs(v) * 60 - 30); img.data.set([g, g, g, 255], i * 4); }
  c.putImageData(img, 0, 0);
  return ctx.createPattern(t, 'repeat')!;
}

function baseMap(g: Grid, S: number) {
  const cnv = document.createElement('canvas');
  cnv.width = cnv.height = S;
  const ctx = cnv.getContext('2d')!, px = S / (g.nx * g.dx);
  // a little greyer than the site's soil colour, so data colours stay the brightest things on the map
  const ground = `#${new THREE.Color(g.site.groundColor).lerp(new THREE.Color('#a39f97'), 0.5).getHexString()}`;
  // 1. land cover at grid resolution, upscaled with smoothing: soft edges instead of 5 m staircases.
  //    Road cells (what the engine treats as road) are painted here too, so the engine's roads still show underneath.
  const lo = document.createElement('canvas');
  lo.width = g.nx; lo.height = g.ny;
  const lc = lo.getContext('2d')!, img = lc.createImageData(g.nx, g.ny), col = new THREE.Color();
  for (let i = 0; i < g.n; i++) {
    const cv = g.cover[i], j = ((Math.sin(i * 12.9898) * 43758.5453) % 1) * 0.5;
    if (cv === COVER.GREEN) col.set('#6f8a55').offsetHSL(0, 0, j * 0.05);
    else if (cv === COVER.PAVED) col.set('#a7a39b').offsetHSL(0, 0, j * 0.03);
    else if (cv === COVER.WATER) col.set('#3b5f78');
    else if (cv === COVER.CHANNEL) col.set('#34566e');
    else if (cv === COVER.ROAD) col.set(g.road[i] >= 0 ? ROAD_FILL[g.site.roads[g.road[i]].cls] ?? '#535250' : '#535250');
    else if (cv === COVER.BUILDING) col.set(ground).offsetHSL(0, -0.05, -0.1);
    else col.set(ground).offsetHSL(0, 0, j * 0.04);
    const hx = col.getHex();   // sRGB bytes (Color stores linear values internally)
    img.data.set([hx >> 16 & 255, hx >> 8 & 255, hx & 255, 255], i * 4);
  }
  lc.putImageData(img, 0, 0);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(lo, 0, 0, S, S);
  ctx.globalAlpha = 0.07; ctx.globalCompositeOperation = 'overlay';
  ctx.fillStyle = grain(ctx); ctx.fillRect(0, 0, S, S);
  ctx.globalAlpha = 1; ctx.globalCompositeOperation = 'source-over';
  // 2. crisp roads from the OSM centre lines at their mapped width, kerb first, then surface, then markings.
  //    They sit within half a grid cell (2.5 m) of the engine's road cells painted underneath.
  const roads = [...g.site.roads].sort((a, b) => (RANK[a.cls] ?? 0) - (RANK[b.cls] ?? 0));
  const path = (pts: [number, number][]) => { ctx.beginPath(); pts.forEach(([x, z], k) => k ? ctx.lineTo(x * px, z * px) : ctx.moveTo(x * px, z * px)); };
  const width = (rd: (typeof roads)[number]) => Math.max(3.5, rd.width || 5);
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const rd of roads) { path(rd.pts); ctx.strokeStyle = '#8e8a83'; ctx.lineWidth = (width(rd) + 1.2) * px; ctx.stroke(); }
  for (const rd of roads) { path(rd.pts); ctx.strokeStyle = ROAD_FILL[rd.cls] ?? '#535250'; ctx.lineWidth = width(rd) * px; ctx.stroke(); }
  for (const rd of roads) {
    if ((RANK[rd.cls] ?? 0) < 5) continue;
    path(rd.pts); ctx.setLineDash([3 * px, 4 * px]); ctx.strokeStyle = 'rgba(236,230,214,0.6)'; ctx.lineWidth = 0.22 * px; ctx.stroke(); ctx.setLineDash([]);
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
  const soil = new THREE.Color('#5c4838'), rock = new THREE.Color('#2f2b28'), top = new THREE.Color('#7a6650');
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
  const overlay = useStore(s => (s.mode === 'flood' ? s.overlay : 'none'));
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const geo = useMemo(() => terrainGeometry(grid), [grid]);
  const sharp = useStore(s => s.quality === 'high');
  const tex = useMemo(() => baseMap(grid, sharp ? 4096 : 2048), [grid, sharp]);
  const skirt = useMemo(() => skirtGeometry(grid), [grid]);
  const risk = useMemo(() => (result && overlay === 'risk' ? riskMap(grid, result.maxDepth) : null), [grid, result, overlay]);
  const { terrain } = useTools();
  const size = half(grid) * 2;
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
      {/* Closes the diorama from below, so no grazing camera angle can see a hollow gap under the block. */}
      <mesh position={[0, -14, 0]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[size, size]} />
        <meshStandardMaterial color="#2f2b28" roughness={1} side={THREE.DoubleSide} />
      </mesh>
    </group>
  );
}
