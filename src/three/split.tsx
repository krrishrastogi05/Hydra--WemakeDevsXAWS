// Before/after split view: the scene is drawn twice per frame into the two halves of one canvas (scissor test),
// no action on the left, the plan on the right. Shared layers (terrain, trees, rain) are drawn as they are;
// layers that differ either live inside a <SideGroup> (shown only in their own pass) or swap their data in a
// side hook (building colours), so nothing heavy is duplicated.
import { useFrame } from '@react-three/fiber';
import { createContext, useContext, useEffect, useRef, type ReactNode } from 'react';
import type * as THREE from 'three';
import { useStore } from '../store';

export type Side = 'left' | 'right';
const SideCtx = createContext<Side | null>(null);
const hooks = new Set<(side: Side | null) => void>();

/** Called before each pass with the side being drawn, and with null once the frame is done. */
export function useSideHook(fn: (side: Side | null) => void) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    const h = (s: Side | null) => ref.current(s);
    hooks.add(h);
    return () => { hooks.delete(h); };
  }, []);
}

/** The flood result this subtree shows: its side's result in the split view, else the one picked in the timeline. */
export function useShownResult() {
  const side = useContext(SideCtx);
  return useStore(s => (side === 'left' ? s.baseline : side === 'right' ? (s.current ?? s.baseline) : ((s.view === 'baseline' ? s.baseline : s.current) ?? s.baseline)));
}

export function SideGroup({ side, children }: { side: Side; children: ReactNode }) {
  const ref = useRef<THREE.Group>(null);
  useSideHook(s => { if (ref.current) ref.current.visible = s === null || s === side; });
  return <SideCtx.Provider value={side}><group ref={ref}>{children}</group></SideCtx.Provider>;
}

/** Whether the split view is on and has a plan run to compare against. */
export function useSplitOn() {
  return useStore(s => s.split && s.mode === 'flood' && !!s.current && s.currentKey !== '' && s.current !== s.baseline);
}

/** Takes over rendering while mounted (frame priority 1): left pass, right pass, then restore. */
export function SplitRenderer() {
  useFrame(({ gl, scene, camera, size }) => {
    const w = size.width, h = size.height, cut = Math.round(w * useStore.getState().splitX);
    const autoClear = gl.autoClear, autoShadow = gl.shadowMap.autoUpdate;
    gl.autoClear = false;
    gl.setScissorTest(true);
    gl.setViewport(0, 0, w, h);
    gl.clear();
    ([['left', 0, cut], ['right', cut, w - cut]] as [Side, number, number][]).forEach(([side, x, width], k) => {
      hooks.forEach(fn => fn(side));
      // the shadow map is the same on both sides (only colours and water differ): draw it once
      gl.shadowMap.autoUpdate = false;
      gl.shadowMap.needsUpdate = k === 0;
      gl.setScissor(x, 0, width, h);
      gl.clear();
      gl.render(scene, camera);
    });
    gl.setScissorTest(false);
    gl.autoClear = autoClear;
    gl.shadowMap.autoUpdate = autoShadow;
    hooks.forEach(fn => fn(null));
  }, 1);
  return null;
}
