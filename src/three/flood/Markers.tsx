// Hotspot beacons, road / place names, schools and hospitals, and the hovered-cell outline.
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store';
import { VE, cellX, cellY, cellZ, half } from '../geo';

const RING = new THREE.RingGeometry(5, 6.4, 40).rotateX(-Math.PI / 2);
const CELL_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

function Beacon({ x, y, z, rank }: { x: number; y: number; z: number; rank: number }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * 0.6 + rank * 0.17) % 1;
    if (ref.current) { ref.current.scale.setScalar(1 + t * 2.2); (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.75 * (1 - t); }
  });
  return <mesh ref={ref} geometry={RING} position={[x, y + 0.8, z]}><meshBasicMaterial color="#f87171" transparent depthWrite={false} toneMapped={false} /></mesh>;
}

export function Markers() {
  const grid = useStore(s => s.grid)!;
  const showLabels = useStore(s => s.showLabels);
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const hover = useStore(s => s.hover), tool = useStore(s => s.tool);
  const h = half(grid);
  const critical = useMemo(() => grid.site.buildings.map((b, k) => ({ b, k })).filter(({ b }) => b.critical).map(({ b, k }) => {
    const x = b.poly.reduce((a, p) => a + p[0], 0) / b.poly.length - h, z = b.poly.reduce((a, p) => a + p[1], 0) / b.poly.length - h;
    const cells = grid.bCells[k].length ? grid.bCells[k] : grid.frontage[k];
    const y = (cells.length ? Math.max(...cells.map(c => grid.z[c])) : 0) * VE + b.levels * 3.2 + 4;
    return { x, y, z, label: b.name || b.use, kind: b.use };
  }), [grid, h]);
  const hotspots = (result?.hotspots ?? []).slice(0, 6);
  return (
    <group>
      {hotspots.map((hs, k) => {
        const x = hs.x - h, z = hs.z - h, y = cellY(grid, hs.cell);
        return (
          <group key={`${hs.cell}-${k}`}>
            <Beacon x={x} y={y} z={z} rank={k} />
            <Html position={[x, y + 10, z]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
              <div className="tag tag-hot"><b>{k + 1}</b>{hs.road} · {Math.round(hs.maxDepth * 100)} cm</div>
            </Html>
          </group>
        );
      })}
      {showLabels && grid.site.labels.map((l, k) => (
        <Html key={k} position={[l.x - h, (grid.z[Math.min(grid.n - 1, Math.floor(l.z / grid.dx) * grid.nx + Math.floor(l.x / grid.dx))] ?? 0) * VE + 6, l.z - h]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`tag tag-${l.kind}`}>{l.text}</div>
        </Html>
      ))}
      {showLabels && critical.map((c, k) => (
        <Html key={`c${k}`} position={[c.x, c.y, c.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="tag tag-crit">{c.kind === 'Hospital' || c.kind === 'Clinic' ? '✚' : '▲'} {c.label}</div>
        </Html>
      ))}
      {hover && hover.cell >= 0 && (tool === 'inspect' || tool === 'erase') && (
        <lineSegments geometry={CELL_EDGES} position={[cellX(grid, hover.cell), cellY(grid, hover.cell) + 1, cellZ(grid, hover.cell)]} scale={[grid.dx, 2, grid.dx]}>
          <lineBasicMaterial color={tool === 'erase' ? '#f87171' : '#e2e8f0'} />
        </lineSegments>
      )}
    </group>
  );
}
