// Placed interventions, placement previews (green = valid, red = not allowed) and the drain being drawn.
import { useMemo } from 'react';
import * as THREE from 'three';
import { useStore, footprintFor } from '../../store';
import { fmtINR, type Grid } from '../../sim/grid';
import { CATALOG, costOf, validate } from '../../sim/flood/model';
import type { Intervention, InterventionType } from '../../sim/flood/types';
import { cellX, cellY, cellZ } from '../geo';
import { Beacon, GHOST_ORDER, GhostMat, NO, OK } from '../Ghost';

const box = new THREE.BoxGeometry(1, 1, 1);
const EDGES = new THREE.EdgesGeometry(box);
const SHRUB = new THREE.IcosahedronGeometry(1, 0);
const RING = new THREE.TorusGeometry(1.25, 0.32, 8, 20).rotateX(Math.PI / 2);
const COVER_LID = new THREE.CylinderGeometry(1.25, 1.25, 0.18, 20);
const GRATE = new THREE.CircleGeometry(0.8, 16).rotateX(-Math.PI / 2);
const HALO = new THREE.RingGeometry(2.1, 2.5, 32).rotateX(-Math.PI / 2);
const PLANTS: [number, number, number][] = [[-2.6, -2.2, 1.1], [2.4, -2.6, 0.9], [-2.2, 2.5, 1.0], [2.7, 2.1, 1.2], [0.2, 0.1, 0.8], [-0.4, -3.2, 0.7], [3.3, 0.4, 0.8], [-3.1, 0.2, 0.9], [1.1, 3.1, 0.75], [-1.2, 1.2, 0.6], [1.4, -1.0, 0.65]];
const PLANT_GREENS = ['#56703f', '#647f48', '#4b6338', '#6f8a52'];

function Segments({ grid, cells, color, y = 0.25, w = 1.4, h = 0.5, opacity = 1, ghost }: { grid: Grid; cells: number[]; color: string; y?: number; w?: number; h?: number; opacity?: number; ghost?: boolean }) {
  // one box per consecutive pair of cells (or a single cell), lying along the path
  const parts = useMemo(() => {
    const out: { p: THREE.Vector3; rot: number; len: number }[] = [];
    if (cells.length === 1) out.push({ p: new THREE.Vector3(cellX(grid, cells[0]), cellY(grid, cells[0]) + y, cellZ(grid, cells[0])), rot: 0, len: grid.dx * 0.8 });
    for (let k = 0; k + 1 < cells.length; k++) {
      const a = cells[k], b = cells[k + 1], x0 = cellX(grid, a), z0 = cellZ(grid, a), x1 = cellX(grid, b), z1 = cellZ(grid, b);
      out.push({ p: new THREE.Vector3((x0 + x1) / 2, (cellY(grid, a) + cellY(grid, b)) / 2 + y, (z0 + z1) / 2), rot: -Math.atan2(z1 - z0, x1 - x0), len: Math.hypot(x1 - x0, z1 - z0) + w * 0.6 });
    }
    return out;
  }, [grid, cells, y, w]);
  return (
    <group>
      {parts.map((s, k) => (
        <mesh key={k} geometry={box} position={s.p} rotation={[0, s.rot, 0]} scale={[s.len, h, w]} castShadow={!ghost && opacity === 1} renderOrder={ghost ? GHOST_ORDER : 0}>
          {ghost ? <GhostMat color={color} opacity={opacity} /> : <meshStandardMaterial color={color} roughness={0.7} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} />}
        </mesh>
      ))}
    </group>
  );
}

function Garden({ grid, cells, ghost }: { grid: Grid; cells: number[]; ghost?: string }) {
  const x = cells.reduce((a, c) => a + cellX(grid, c), 0) / cells.length, z = cells.reduce((a, c) => a + cellZ(grid, c), 0) / cells.length;
  const y = Math.min(...cells.map(c => cellY(grid, c)));
  const size = Math.sqrt(cells.length) * grid.dx;
  if (ghost) return (
    <group position={[x, y + 0.3, z]}>
      <mesh geometry={box} scale={[size, 0.6, size]} renderOrder={GHOST_ORDER}><GhostMat color={ghost} opacity={0.45} /></mesh>
      <lineSegments geometry={EDGES} scale={[size, 0.6, size]} renderOrder={GHOST_ORDER + 1}><lineBasicMaterial color={ghost} depthTest={false} toneMapped={false} /></lineSegments>
    </group>
  );
  // a sunken planted bed: concrete kerb, dark soil, low faceted shrubs
  return (
    <group position={[x, y, z]}>
      <mesh geometry={box} position={[0, 0.12, 0]} scale={[size - 0.2, 0.24, size - 0.2]} receiveShadow><meshStandardMaterial color="#9b978f" roughness={0.9} /></mesh>
      <mesh geometry={box} position={[0, 0.16, 0]} scale={[size - 1.0, 0.24, size - 1.0]} receiveShadow><meshStandardMaterial color="#3e3527" roughness={1} /></mesh>
      {PLANTS.map(([dx, dz, s], k) => (
        <mesh key={k} geometry={SHRUB} position={[dx, 0.3 + s * 0.55, dz]} rotation={[0, k * 1.7, 0]} scale={[s, s * 0.8, s]} castShadow><meshStandardMaterial color={PLANT_GREENS[k % PLANT_GREENS.length]} roughness={0.9} flatShading /></mesh>
      ))}
    </group>
  );
}

function Pit({ grid, cell, ghost }: { grid: Grid; cell: number; ghost?: string }) {
  const p: [number, number, number] = [cellX(grid, cell), cellY(grid, cell), cellZ(grid, cell)];
  if (ghost) return <mesh geometry={RING} position={[p[0], p[1] + 0.4, p[2]]} scale={1.3} renderOrder={GHOST_ORDER}><GhostMat color={ghost} opacity={0.8} /></mesh>;
  // a round concrete cover with an iron grate, and a thin amber ring on the ground so it can be found from afar
  return (
    <group position={p}>
      <mesh geometry={COVER_LID} position={[0, 0.12, 0]} castShadow receiveShadow><meshStandardMaterial color="#a8a49b" roughness={0.85} /></mesh>
      <mesh geometry={GRATE} position={[0, 0.22, 0]}><meshStandardMaterial color="#2a2722" roughness={0.6} metalness={0.4} /></mesh>
      <mesh geometry={HALO} position={[0, 0.08, 0]}><meshBasicMaterial color="#fbbf24" transparent opacity={0.7} toneMapped={false} depthWrite={false} /></mesh>
    </group>
  );
}

function Item({ grid, iv }: { grid: Grid; iv: Intervention }) {
  if (iv.type === 'garden') return <Garden grid={grid} cells={iv.cells!} />;
  if (iv.type === 'pit') return <Pit grid={grid} cell={iv.cells![0]} />;
  if (iv.type === 'drain') return <><Segments grid={grid} cells={iv.cells!} color="#c9c5bc" y={0.15} h={0.3} w={1.5} /><Segments grid={grid} cells={iv.cells!} color="#38bdf8" y={0.33} w={0.55} h={0.06} /></>;
  if (iv.type === 'desilt') return <Segments grid={grid} cells={grid.unitCells.get(iv.unit!) ?? []} color="#a78bfa" y={0.42} w={0.8} h={0.12} />;
  return null;   // rooftop tanks are drawn by <Buildings>
}

export function Interventions() {
  const grid = useStore(s => s.grid)!;
  const plan = useStore(s => s.plan);
  const tool = useStore(s => s.tool), hover = useStore(s => s.hover), draft = useStore(s => s.draft);
  const ghost = useMemo(() => {
    if (!hover || hover.cell < 0 || tool === 'inspect' || tool === 'erase' || tool === 'rwh') return null;
    const check = (iv: Intervention) => { const err = validate(grid, iv, plan); return { ok: !err, err }; };
    if (tool === 'desilt') {
      const unit = grid.drain[hover.cell];
      return unit >= 0
        ? { kind: 'desilt' as const, cells: grid.unitCells.get(unit) ?? [], ...check({ id: 'g', type: 'desilt', unit }) }
        : { kind: 'none' as const, cells: [], ok: false, err: 'Click a brown roadside drain' };
    }
    if (tool === 'drain') return { kind: 'cell' as const, cells: [hover.cell], ...check({ id: 'g', type: 'drain', cells: [hover.cell] }) };
    if (tool !== 'garden' && tool !== 'pit') return null;
    const cells = footprintFor(tool, grid, hover.cell);
    return { kind: tool, cells, ...check({ id: 'g', type: tool, cells }) };
  }, [hover, tool, grid, plan]);
  const draftErr = useMemo(() => (draft ? validate(grid, { id: 'g', type: 'drain', cells: draft }, plan) : null), [draft, grid, plan]);
  const draftOk = !draftErr;
  // the pin follows the pointer (or the tip of the drain being drawn); the ground ring is sized to the footprint
  const tip = draft ? draft[draft.length - 1] : ghost ? hover!.cell : -1;
  const radius = ghost?.kind === 'garden' ? Math.sqrt(ghost.cells.length) * grid.dx * 0.75 : 4;
  const label = useMemo(() => {
    if (draft) return `Drain · ${draft.length * grid.dx} m · ${fmtINR(costOf(grid, { id: 'g', type: 'drain', cells: draft }))}`;
    if (!ghost || ghost.kind === 'none' || !(tool in CATALOG)) return '';
    const t = tool as InterventionType, iv: Intervention = t === 'desilt' ? { id: 'g', type: t, unit: grid.drain[hover!.cell] } : { id: 'g', type: t, cells: ghost.cells };
    return `${CATALOG[t].short} · ${fmtINR(costOf(grid, iv))}`;
  }, [draft, ghost, tool, grid, hover]);
  return (
    <group>
      {plan.map(iv => <Item key={iv.id} grid={grid} iv={iv} />)}
      {tip >= 0 && <Beacon x={cellX(grid, tip)} y={cellY(grid, tip)} z={cellZ(grid, tip)} radius={radius} ok={draft ? draftOk : ghost!.ok} label={label} reason={draft ? draftErr : ghost!.err} />}
      {ghost?.kind === 'garden' && <Garden grid={grid} cells={ghost.cells} ghost={ghost.ok ? OK : NO} />}
      {ghost?.kind === 'pit' && <Pit grid={grid} cell={ghost.cells[0]} ghost={ghost.ok ? OK : NO} />}
      {ghost?.kind === 'cell' && !draft && <Segments grid={grid} cells={ghost.cells} color={ghost.ok ? OK : NO} opacity={0.6} h={0.6} w={3} ghost />}
      {ghost?.kind === 'desilt' && <Segments grid={grid} cells={ghost.cells} color={ghost.ok ? OK : NO} opacity={0.65} y={0.6} w={1.4} h={0.25} ghost />}
      {draft && <Segments grid={grid} cells={draft} color={draftOk ? OK : NO} opacity={0.7} h={0.7} w={2.2} ghost />}
    </group>
  );
}
