// Heat mode in 3D: sun light for the chosen hour, the exposure / shade map on the ground, trees, shade structures,
// placement previews and the pedestrian places (bus stops, markets, gates, parks) coloured by their exposure index.
import { Html } from '@react-three/drei';
import { useEffect, useMemo, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store';
import { useHeat } from '../../heatStore';
import { COVER } from '../../sim/types';
import { fmtINR, type Grid } from '../../sim/grid';
import { DAY_START, HEAT_CATALOG, HEAT_PARAMS, HEAT_SCENARIOS, STEP_H, heatCostOf, validateHeat } from '../../sim/heat/model';
import { sunPosition } from '../../sim/heat/solar';
import type { HeatIntervention, HeatResult, HeatSite } from '../../sim/heat/types';
import { VE, cellX, cellY, cellZ, half } from '../geo';
import { terrainGeometry } from '../Terrain';
import { Beacon, GHOST_ORDER, GhostMat, NO, OK } from '../Ghost';

/** Exposure ramp: pale yellow (mild) -> orange -> deep red (high). Shared with the legend. */
export function exposureColor(v: number): [number, number, number] {
  const t = Math.max(0, Math.min(1, (v - 30) / 50));
  const stops: [number, number, number][] = [[254, 240, 138], [251, 146, 60], [220, 38, 38], [127, 29, 29]];
  const x = t * (stops.length - 1), k = Math.min(stops.length - 2, Math.floor(x)), f = x - k;
  return stops[k].map((a, j) => Math.round(a + (stops[k + 1][j] - a) * f)) as [number, number, number];
}
export const indexColor = (v: number) => (v >= HEAT_PARAMS.high ? '#ef4444' : v >= HEAT_PARAMS.moderate ? '#f59e0b' : '#22c55e');
export const frameIndex = (r: HeatResult, hour: number) => Math.max(0, Math.min(r.steps.length - 1, Math.round((hour - DAY_START - STEP_H / 2) / STEP_H)));

export function useHeatResult() {
  return useHeat(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
}

/** Sun and sky for the chosen day and hour. */
export function HeatLights() {
  const grid = useStore(s => s.grid);
  const hour = useHeat(s => s.hour), scenarioId = useHeat(s => s.scenarioId), summary = useHeat(s => s.summary);
  const sc = HEAT_SCENARIOS.find(x => x.id === scenarioId) ?? HEAT_SCENARIOS[0];
  const [lat, lon] = grid?.site.center ?? [23, 80];
  const { elev, az } = sunPosition(lat, lon, sc.doy, summary ? 13 : hour);
  const e = Math.max(2, elev) * Math.PI / 180, a = az * Math.PI / 180, d = 700;
  const pos: [number, number, number] = [Math.sin(a) * Math.cos(e) * d, Math.sin(e) * d, -Math.cos(a) * Math.cos(e) * d];
  const low = Math.max(0, Math.min(1, elev / 35));
  const sunCol = new THREE.Color('#ffb36b').lerp(new THREE.Color('#fff4dc'), low);
  return (
    <>
      <fog attach="fog" args={['#2a1d14', 900, 2300]} />
      <hemisphereLight args={['#ffe2b8', '#5a4030', 0.55 + 0.25 * low]} />
      <ambientLight intensity={0.12} />
      <directionalLight position={pos} intensity={elev > 0 ? 1.5 + 0.9 * low : 0.15} color={sunCol} castShadow
        shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004}
        shadow-camera-left={-420} shadow-camera-right={420} shadow-camera-top={420} shadow-camera-bottom={-420} shadow-camera-far={2000} />
    </>
  );
}

function overlayTexture(g: Grid, r: HeatResult, summary: boolean, hour: number) {
  const cnv = document.createElement('canvas');
  cnv.width = g.nx; cnv.height = g.ny;
  const ctx = cnv.getContext('2d')!, img = ctx.createImageData(g.nx, g.ny), k = frameIndex(r, hour);
  for (let i = 0; i < g.n; i++) {
    if (g.cover[i] === COVER.BUILDING || g.cover[i] === COVER.WATER || g.cover[i] === COVER.CHANNEL) continue;
    if (summary) {
      if (r.weight[i] <= 0) continue;
      const [cr, cg, cb] = exposureColor(r.exposure[i]);
      img.data.set([cr, cg, cb, 95 + Math.round(95 * Math.min(1, r.weight[i] / 1.5))], i * 4);
    } else if (r.frames) {
      const t = r.frames[k * g.n + i] / 255;   // 1 = full sun
      img.data.set(t > 0.5 ? [255, 196, 92, Math.round(70 + 90 * t)] : [30, 64, 120, Math.round(120 * (1 - t))], i * 4);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cnv);
  tex.magFilter = THREE.LinearFilter;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function HeatOverlay() {
  const grid = useStore(s => s.grid)!;
  const r = useHeatResult(), summary = useHeat(s => s.summary), overlay = useHeat(s => s.overlay);
  const hour = useHeat(s => Math.round(s.hour * 2) / 2);
  const geo = useMemo(() => terrainGeometry(grid), [grid]);
  const tex = useMemo(() => (r && overlay === 'exposure' ? overlayTexture(grid, r, summary, hour) : null), [grid, r, summary, hour, overlay]);
  if (!tex) return null;
  return (
    <mesh geometry={geo} renderOrder={1}>
      <meshBasicMaterial map={tex} transparent depthWrite={false} polygonOffset polygonOffsetFactor={-2} polygonOffsetUnits={-2} />
    </mesh>
  );
}

const TRUNK = new THREE.CylinderGeometry(0.25, 0.35, 1, 6).translate(0, 0.5, 0);
const CROWN = new THREE.IcosahedronGeometry(1, 1);
const box = new THREE.BoxGeometry(1, 1, 1);

export interface TreeSpec { x: number; y: number; z: number; h: number; r: number; synthetic: boolean; planned: boolean }
export function treeSpecs(g: Grid, hs: Pick<HeatSite, 'trees'>, plan: HeatIntervention[]): TreeSpec[] {
  const h = half(g), at = (x: number, z: number) => g.z[Math.min(g.n - 1, Math.max(0, Math.floor(z / g.dx) * g.nx + Math.floor(x / g.dx)))] * VE;
  return [
    ...hs.trees.map(t => ({ x: t.x - h, y: at(t.x, t.z), z: t.z - h, h: t.h, r: t.r, synthetic: t.synthetic, planned: false })),
    ...plan.filter(p => p.type === 'tree').map(p => ({ x: cellX(g, p.cells![0]), y: cellY(g, p.cells![0]), z: cellZ(g, p.cells![0]), h: HEAT_PARAMS.newTree.h, r: HEAT_PARAMS.newTree.r, synthetic: false, planned: true })),
  ];
}

export function Trees() {
  const grid = useStore(s => s.grid)!, sources = useStore(s => s.overlay === 'sources');
  const hs = useHeat(s => s.heat), plan = useHeat(s => s.plan);
  const specs = useMemo(() => (hs ? treeSpecs(grid, hs, plan) : []), [grid, hs, plan]);
  return <TreeField specs={specs} sources={sources} />;
}

const LEAF = ['#4f6b3a', '#5a7a42', '#46613a', '#64804a', '#56703f'];

/** Instanced trees: tapered trunks, faceted crowns with per-tree turn, squash and a muted two-tone green. */
export function TreeField({ specs, sources }: { specs: TreeSpec[]; sources: boolean }) {
  const { trunks, crowns } = useMemo(() => {
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), trunks = new THREE.InstancedMesh(TRUNK, new THREE.MeshStandardMaterial({ color: '#5b4632', roughness: 1 }), Math.max(1, specs.length));
    const crowns = new THREE.InstancedMesh(CROWN, new THREE.MeshStandardMaterial({ roughness: 0.92, flatShading: true }), Math.max(1, specs.length));
    const col = new THREE.Color();
    specs.forEach((t, k) => {
      const trunkH = t.h * HEAT_PARAMS.trunkShare + 0.6, j = Math.sin(k * 12.9898) * 43758.5453 % 1, jj = Math.abs(j);
      m.compose(new THREE.Vector3(t.x, t.y, t.z), q.identity(), new THREE.Vector3(1, trunkH, 1)); trunks.setMatrixAt(k, m);
      const ch = t.h * (1 - HEAT_PARAMS.trunkShare);
      q.setFromEuler(e.set(jj * 0.4, jj * 6.28, (1 - jj) * 0.3));
      m.compose(new THREE.Vector3(t.x, t.y + trunkH + ch * 0.35, t.z), q, new THREE.Vector3(t.r * (0.92 + 0.16 * jj), ch * (0.56 + 0.12 * jj), t.r * (1.06 - 0.14 * jj))); crowns.setMatrixAt(k, m);
      if (t.planned) col.set('#4ade80');
      else if (sources && t.synthetic) col.set('#c084fc');
      else col.set(LEAF[k % LEAF.length]).offsetHSL(0, 0, (jj - 0.5) * 0.06);
      crowns.setColorAt(k, col);
    });
    trunks.count = crowns.count = specs.length;
    for (const x of [trunks, crowns]) { x.castShadow = true; x.receiveShadow = true; x.raycast = () => {}; x.instanceMatrix.needsUpdate = true; x.computeBoundingSphere(); }
    if (crowns.instanceColor) crowns.instanceColor.needsUpdate = true;
    return { trunks, crowns };
  }, [specs, sources]);
  return <group><primitive object={trunks} /><primitive object={crowns} /></group>;
}

const treeCache = new Map<string, Promise<Pick<HeatSite, 'trees'>>>();

/** Flood mode shows the neighbourhood's real trees too: only the tree list is fetched, no heat simulation runs. */
export function SiteTrees() {
  const grid = useStore(s => s.grid)!, sources = useStore(s => s.overlay === 'sources');
  const [hs, setHs] = useState<Pick<HeatSite, 'trees'> | null>(null);
  useEffect(() => {
    const id = grid.site.id;
    if (!treeCache.has(id)) treeCache.set(id, fetch(`${import.meta.env.BASE_URL}data/${id}.heat.json`).then(r => r.json()).catch(() => ({ trees: [] })));
    let live = true;
    treeCache.get(id)!.then(x => { if (live) setHs(x); });
    return () => { live = false; };
  }, [grid]);
  const specs = useMemo(() => (hs ? treeSpecs(grid, hs, []) : []), [grid, hs]);
  return <TreeField specs={specs} sources={sources} />;
}

const ghostMat = (color: string, opacity: number) => <GhostMat color={color} opacity={opacity} />;
function GroundMark({ grid, cell, color }: { grid: Grid; cell: number; color: string }) {
  return <mesh geometry={box} position={[cellX(grid, cell), cellY(grid, cell) + 0.15, cellZ(grid, cell)]} scale={[grid.dx * 0.96, 0.3, grid.dx * 0.96]} renderOrder={GHOST_ORDER}>{ghostMat(color, 0.55)}</mesh>;
}

function Shade({ grid, cells, color, opacity = 1, ghost }: { grid: Grid; cells: number[]; color: string; opacity?: number; ghost?: boolean }) {
  return (
    <group>
      {cells.map(c => {
        const y = cellY(grid, c);
        return (
          <group key={c} position={[cellX(grid, c), y, cellZ(grid, c)]}>
            <mesh geometry={box} position={[0, HEAT_PARAMS.canopyTop, 0]} scale={[grid.dx * 0.96, 0.25, grid.dx * 0.96]} castShadow={!ghost && opacity === 1} renderOrder={ghost ? GHOST_ORDER : 0}>
              {ghost ? ghostMat(color, opacity) : <meshStandardMaterial color={color} roughness={0.6} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} />}
            </mesh>
            {opacity === 1 && [[-1, -1], [1, 1]].map(([a, b], k) => (
              <mesh key={k} geometry={box} position={[a * grid.dx * 0.42, HEAT_PARAMS.canopyTop / 2, b * grid.dx * 0.42]} scale={[0.18, HEAT_PARAMS.canopyTop, 0.18]}>
                <meshStandardMaterial color="#6b7280" />
              </mesh>
            ))}
          </group>
        );
      })}
    </group>
  );
}


export function HeatInterventions() {
  const grid = useStore(s => s.grid)!, tool = useStore(s => s.tool), hover = useStore(s => s.hover), draft = useStore(s => s.draft);
  const hs = useHeat(s => s.heat), plan = useHeat(s => s.plan);
  const ghost = useMemo(() => {
    if (!hs || !hover || hover.cell < 0 || (tool !== 'tree' && tool !== 'canopy' && tool !== 'walkway')) return null;
    const iv: HeatIntervention = { id: 'g', type: tool, cells: [hover.cell] }, err = validateHeat(grid, hs, iv, plan);
    return { tool, cell: hover.cell, ok: !err, err, label: `${HEAT_CATALOG[tool].short} · ${fmtINR(heatCostOf(grid, iv))}` };
  }, [hs, hover, tool, grid, plan]);
  const draftErr = useMemo(() => (hs && draft ? validateHeat(grid, hs, { id: 'g', type: 'walkway', cells: draft }, plan) : null), [hs, draft, grid, plan]);
  const draftOk = !draftErr;
  const drawing = !!draft && tool === 'walkway';
  const tip = drawing ? draft![draft!.length - 1] : ghost ? ghost.cell : -1, tipOk = drawing ? draftOk : !!ghost?.ok;
  const label = drawing ? `Walkway · ${draft!.length * grid.dx} m · ${fmtINR(heatCostOf(grid, { id: 'g', type: 'walkway', cells: draft! }))}` : ghost?.label ?? '';
  return (
    <group>
      {plan.filter(p => p.type === 'canopy' || p.type === 'walkway').map(p => <Shade key={p.id} grid={grid} cells={p.cells!} color={p.type === 'canopy' ? '#e9a23b' : '#d9822b'} />)}
      {ghost && !draft && <GroundMark grid={grid} cell={ghost.cell} color={ghost.ok ? OK : NO} />}
      {tip >= 0 && <Beacon x={cellX(grid, tip)} y={cellY(grid, tip)} z={cellZ(grid, tip)} ok={tipOk} label={label} reason={drawing ? draftErr : ghost?.err} />}
      {ghost && ghost.tool === 'tree' && (
        <mesh geometry={CROWN} position={[cellX(grid, ghost.cell), cellY(grid, ghost.cell) + 6, cellZ(grid, ghost.cell)]} scale={[3.5, 3, 3.5]} renderOrder={GHOST_ORDER}>
          {ghostMat(ghost.ok ? OK : NO, 0.45)}
        </mesh>
      )}
      {ghost && ghost.tool !== 'tree' && !draft && <Shade grid={grid} cells={[ghost.cell]} color={ghost.ok ? OK : NO} opacity={0.45} ghost />}
      {draft && tool === 'walkway' && <>
        {draft.map(c => <GroundMark key={c} grid={grid} cell={c} color={draftOk ? OK : NO} />)}
        <Shade grid={grid} cells={draft} color={draftOk ? OK : NO} opacity={0.5} ghost />
      </>}
    </group>
  );
}

export function HeatMarkers() {
  const grid = useStore(s => s.grid)!, showLabels = useStore(s => s.showLabels), hover = useStore(s => s.hover), tool = useStore(s => s.tool);
  const hs = useHeat(s => s.heat), r = useHeatResult();
  const h = half(grid);
  const scored = useMemo(() => (hs && r ? hs.receptors.map((p, k) => ({ p, s: r.receptors[k] })).sort((a, b) => b.s.index - a.s.index) : []), [hs, r]);
  const yAt = (x: number, z: number) => grid.z[Math.min(grid.n - 1, Math.max(0, Math.floor(z / grid.dx) * grid.nx + Math.floor(x / grid.dx)))] * VE;
  return (
    <group>
      {scored.map(({ p, s }, k) => {
        const x = p.x - h, z = p.z - h, y = yAt(p.x, p.z), col = indexColor(s.index);
        return (
          <group key={p.id}>
            <mesh position={[x, y + 7, z]} rotation={[Math.PI, 0, 0]}><coneGeometry args={[1.4, 4, 10]} /><meshBasicMaterial color={col} toneMapped={false} /></mesh>
            {(showLabels || k < 5) && (
              <Html position={[x, y + 13, z]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
                <div className={`tag tag-heat${s.index >= HEAT_PARAMS.high ? ' hot' : ''}`}><b style={{ background: col }}>{Math.round(s.index)}</b>{p.name}</div>
              </Html>
            )}
          </group>
        );
      })}
      {hover && hover.cell >= 0 && (tool === 'inspect' || tool === 'erase') && (
        <lineSegments position={[cellX(grid, hover.cell), cellY(grid, hover.cell) + 1, cellZ(grid, hover.cell)]} scale={[grid.dx, 2, grid.dx]}>
          <edgesGeometry args={[box]} />
          <lineBasicMaterial color={tool === 'erase' ? '#f87171' : '#fde68a'} />
        </lineSegments>
      )}
    </group>
  );
}
