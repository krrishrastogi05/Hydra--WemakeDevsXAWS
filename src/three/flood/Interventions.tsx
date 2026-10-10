// Placed interventions, placement previews (green = valid, red = not allowed) and the drain being drawn.
import { useMemo } from 'react';
import * as THREE from 'three';
import { useStore, footprintFor } from '../../store';
import type { Grid } from '../../sim/grid';
import { validate } from '../../sim/flood/model';
import type { Intervention } from '../../sim/flood/types';
import { cellX, cellY, cellZ } from '../geo';

const box = new THREE.BoxGeometry(1, 1, 1);
const SHRUB = new THREE.SphereGeometry(1, 8, 6);
const RING = new THREE.TorusGeometry(1.25, 0.32, 8, 20).rotateX(Math.PI / 2);
const DISK = new THREE.CircleGeometry(1.0, 18).rotateX(-Math.PI / 2);
const PIN = new THREE.ConeGeometry(0.55, 1.6, 10).rotateX(Math.PI);

function Segments({ grid, cells, color, y = 0.25, w = 1.4, h = 0.5, opacity = 1 }: { grid: Grid; cells: number[]; color: string; y?: number; w?: number; h?: number; opacity?: number }) {
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
        <mesh key={k} geometry={box} position={s.p} rotation={[0, s.rot, 0]} scale={[s.len, h, w]} castShadow={opacity === 1}>
          <meshStandardMaterial color={color} roughness={0.7} transparent={opacity < 1} opacity={opacity} depthWrite={opacity === 1} />
        </mesh>
      ))}
    </group>
  );
}

function Garden({ grid, cells, ghost }: { grid: Grid; cells: number[]; ghost?: string }) {
  const x = cells.reduce((a, c) => a + cellX(grid, c), 0) / cells.length, z = cells.reduce((a, c) => a + cellZ(grid, c), 0) / cells.length;
  const y = Math.min(...cells.map(c => cellY(grid, c)));
  const size = Math.sqrt(cells.length) * grid.dx;
  if (ghost) return <mesh geometry={box} position={[x, y + 0.3, z]} scale={[size, 0.6, size]}><meshBasicMaterial color={ghost} transparent opacity={0.45} depthWrite={false} /></mesh>;
  return (
    <group position={[x, y, z]}>
      <mesh geometry={box} position={[0, 0.05, 0]} scale={[size - 0.6, 0.3, size - 0.6]} receiveShadow><meshStandardMaterial color="#3d6b35" roughness={1} /></mesh>
      {[[-2.6, -2.2, 1.3], [2.4, -2.6, 1.1], [-2.2, 2.5, 1.2], [2.7, 2.1, 1.4], [0.2, 0.1, 1.0], [-0.4, -3.4, 0.8], [3.4, 0.4, 0.9]].map(([dx, dz, s], k) => (
        <mesh key={k} geometry={SHRUB} position={[dx, 0.35 + s * 0.7, dz]} scale={[s, s * 0.85, s]} castShadow><meshStandardMaterial color={k % 2 ? '#4f8a3f' : '#6aa84f'} roughness={0.9} /></mesh>
      ))}
    </group>
  );
}

function Pit({ grid, cell, ghost }: { grid: Grid; cell: number; ghost?: string }) {
  const p: [number, number, number] = [cellX(grid, cell), cellY(grid, cell), cellZ(grid, cell)];
  if (ghost) return <mesh geometry={RING} position={[p[0], p[1] + 0.4, p[2]]} scale={1.3}><meshBasicMaterial color={ghost} transparent opacity={0.6} depthWrite={false} /></mesh>;
  return (
    <group position={p}>
      <mesh geometry={RING} position={[0, 0.25, 0]} castShadow><meshStandardMaterial color="#b7b2a6" roughness={0.8} /></mesh>
      <mesh geometry={DISK} position={[0, 0.2, 0]}><meshStandardMaterial color="#1b1712" roughness={1} /></mesh>
      <mesh geometry={PIN} position={[0, 4.2, 0]}><meshStandardMaterial color="#fbbf24" emissive="#f59e0b" emissiveIntensity={0.6} /></mesh>
    </group>
  );
}

function Item({ grid, iv }: { grid: Grid; iv: Intervention }) {
  if (iv.type === 'garden') return <Garden grid={grid} cells={iv.cells!} />;
  if (iv.type === 'pit') return <Pit grid={grid} cell={iv.cells![0]} />;
  if (iv.type === 'drain') return <><Segments grid={grid} cells={iv.cells!} color="#d7d3ca" /><Segments grid={grid} cells={iv.cells!} color="#38bdf8" y={0.52} w={0.45} h={0.08} /></>;
  if (iv.type === 'desilt') return <Segments grid={grid} cells={grid.unitCells.get(iv.unit!) ?? []} color="#a78bfa" y={0.42} w={0.8} h={0.12} />;
  return null;   // rooftop tanks are drawn by <Buildings>
}

export function Interventions() {
  const grid = useStore(s => s.grid)!;
  const plan = useStore(s => s.plan);
  const tool = useStore(s => s.tool), hover = useStore(s => s.hover), draft = useStore(s => s.draft);
  const ghost = useMemo(() => {
    if (!hover || hover.cell < 0 || tool === 'inspect' || tool === 'erase' || tool === 'rwh') return null;
    if (tool === 'desilt') {
      const unit = grid.drain[hover.cell];
      return unit >= 0 ? { kind: 'desilt' as const, cells: grid.unitCells.get(unit) ?? [], ok: !validate(grid, { id: 'g', type: 'desilt', unit }, plan) } : null;
    }
    if (tool === 'drain') return { kind: 'cell' as const, cells: [hover.cell], ok: !validate(grid, { id: 'g', type: 'drain', cells: [hover.cell] }, plan) };
    const cells = footprintFor(tool, grid, hover.cell);
    return { kind: tool, cells, ok: !validate(grid, { id: 'g', type: tool, cells }, plan) };
  }, [hover, tool, grid, plan]);
  const draftOk = useMemo(() => (draft ? !validate(grid, { id: 'g', type: 'drain', cells: draft }, plan) : true), [draft, grid, plan]);
  return (
    <group>
      {plan.map(iv => <Item key={iv.id} grid={grid} iv={iv} />)}
      {ghost?.kind === 'garden' && <Garden grid={grid} cells={ghost.cells} ghost={ghost.ok ? '#4ade80' : '#ef4444'} />}
      {ghost?.kind === 'pit' && <Pit grid={grid} cell={ghost.cells[0]} ghost={ghost.ok ? '#fbbf24' : '#ef4444'} />}
      {ghost?.kind === 'cell' && !draft && <Segments grid={grid} cells={ghost.cells} color={ghost.ok ? '#7dd3fc' : '#ef4444'} opacity={0.55} h={0.6} w={3} />}
      {ghost?.kind === 'desilt' && <Segments grid={grid} cells={ghost.cells} color={ghost.ok ? '#c4b5fd' : '#ef4444'} opacity={0.6} y={0.6} w={1.4} h={0.25} />}
      {draft && <Segments grid={grid} cells={draft} color={draftOk ? '#7dd3fc' : '#ef4444'} opacity={0.7} h={0.7} w={2.2} />}
    </group>
  );
}
