// Hotspot beacons, road / place names, schools and hospitals, and the hovered-cell outline.
import { Html } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import { useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { useStore } from '../../store';
import { VE, cellX, cellY, cellZ, half } from '../geo';

const RING = new THREE.RingGeometry(5, 6.4, 40).rotateX(-Math.PI / 2);
const CELL_EDGES = new THREE.EdgesGeometry(new THREE.BoxGeometry(1, 1, 1));

function Beacon({ x, y, z, rank, on }: { x: number; y: number; z: number; rank: number; on: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    const t = (clock.elapsedTime * 0.5 + rank * 0.17) % 1;
    if (ref.current) { ref.current.scale.setScalar(1 + t * 2); (ref.current.material as THREE.MeshBasicMaterial).opacity = 0.5 * (1 - t); }
  });
  return <mesh ref={ref} geometry={RING} position={[x, y + 0.8, z]} visible={on}><meshBasicMaterial color="#e05252" transparent depthWrite={false} toneMapped={false} /></mesh>;
}

const HOT_SLOTS = 6, FAR = 950;

/** True when the camera is pulled far back: street and place names then step aside so the map stays legible. */
function useFar() {
  const [far, setFar] = useState(false), ref = useRef(false);
  useFrame(({ camera, controls }) => {
    const target = (controls as unknown as { target?: THREE.Vector3 } | null)?.target;
    const d = target ? camera.position.distanceTo(target) : camera.position.length();
    const next = ref.current ? d > FAR - 80 : d > FAR;   // hysteresis, so it does not flicker at the threshold
    if (next !== ref.current) { ref.current = next; setFar(next); }
  });
  return far;
}

// Labels are HTML overlays. They stay mounted and are hidden with CSS: unmounting drei <Html> during a render
// makes React warn about synchronously unmounting a root, and remounting is slower than toggling.
export function Markers() {
  const grid = useStore(s => s.grid)!;
  const showLabels = useStore(s => s.showLabels);
  const result = useStore(s => (s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline);
  const hover = useStore(s => s.hover), tool = useStore(s => s.tool);
  const far = useFar();
  const h = half(grid);
  const critical = useMemo(() => grid.site.buildings.map((b, k) => ({ b, k })).filter(({ b }) => b.critical).map(({ b, k }) => {
    const x = b.poly.reduce((a, p) => a + p[0], 0) / b.poly.length - h, z = b.poly.reduce((a, p) => a + p[1], 0) / b.poly.length - h;
    const cells = grid.bCells[k].length ? grid.bCells[k] : grid.frontage[k];
    const y = (cells.length ? Math.max(...cells.map(c => grid.z[c])) : 0) * VE + b.levels * 3.2 + 4;
    return { x, y, z, label: b.name || b.use, kind: b.use };
  }), [grid, h]);
  const hotspots = (result?.hotspots ?? []).slice(0, HOT_SLOTS);
  const hide = (on: boolean) => (on ? undefined : { display: 'none' });
  return (
    <group>
      {Array.from({ length: HOT_SLOTS }, (_, k) => {
        const hs = hotspots[k], x = hs ? hs.x - h : 0, z = hs ? hs.z - h : 0, y = hs ? cellY(grid, hs.cell) : -50;
        return (
          <group key={`hot${k}`}>
            <Beacon x={x} y={y} z={z} rank={k} on={!!hs} />
            <Html position={[x, y + 10, z]} center zIndexRange={[6, 0]} style={{ pointerEvents: 'none' }}>
              <div className="tag tag-hot" style={hide(!!hs)}><b>{k + 1}</b>{hs?.road} · {hs ? Math.round(hs.maxDepth * 100) : 0} cm</div>
            </Html>
          </group>
        );
      })}
      {grid.site.labels.map((l, k) => (
        <Html key={k} position={[l.x - h, (grid.z[Math.min(grid.n - 1, Math.floor(l.z / grid.dx) * grid.nx + Math.floor(l.x / grid.dx))] ?? 0) * VE + 6, l.z - h]} center zIndexRange={[4, 0]} style={{ pointerEvents: 'none' }}>
          <div className={`tag tag-${l.kind}`} style={hide(showLabels && (!far || l.kind === 'place'))}>{l.text}</div>
        </Html>
      ))}
      {critical.map((c, k) => (
        <Html key={`c${k}`} position={[c.x, c.y, c.z]} center zIndexRange={[5, 0]} style={{ pointerEvents: 'none' }}>
          <div className="tag tag-crit" style={hide(showLabels && !far)}>{c.kind === 'Hospital' || c.kind === 'Clinic' ? '✚' : '▲'} {c.label}</div>
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
