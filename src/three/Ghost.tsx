// Placement previews shared by both modes: green = allowed, red = not allowed. They draw over water, buildings
// and everything else, and a fixed-size pin marks the spot so it reads at any zoom.
import { Html } from '@react-three/drei';
import * as THREE from 'three';

export const OK = '#4ade80', NO = '#ef4444', GHOST_ORDER = 10;

export function GhostMat({ color, opacity = 0.55 }: { color: string; opacity?: number }) {
  return <meshBasicMaterial color={color} transparent opacity={opacity} depthTest={false} depthWrite={false} toneMapped={false} />;
}

const RING = new THREE.RingGeometry(0.82, 1, 40).rotateX(-Math.PI / 2);

/** A ground ring at the target plus a screen-space pin above it; when not allowed the pin says why. */
export function Beacon({ x, y, z, ok, label, reason, radius = 4 }: { x: number; y: number; z: number; ok: boolean; label: string; reason?: string | null; radius?: number }) {
  const color = ok ? OK : NO;
  return (
    <group position={[x, y, z]}>
      <mesh geometry={RING} position={[0, 0.2, 0]} scale={radius} renderOrder={GHOST_ORDER + 1}><GhostMat color={color} opacity={0.95} /></mesh>
      <Html position={[0, 0.2, 0]} zIndexRange={[30, 30]} style={{ pointerEvents: 'none' }}>
        <div className={`ghost-pin ${ok ? 'ok' : 'no'}`}>
          <span className="ghost-tag">{ok ? '✓' : '✕'} {ok ? label : reason ?? 'Not allowed here'}</span>
          <i />
        </div>
      </Html>
    </group>
  );
}
