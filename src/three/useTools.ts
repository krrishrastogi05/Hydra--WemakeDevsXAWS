// Pointer handling for the terrain and buildings: hover, inspect, place, draw drains, erase.
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import { useStore, footprintFor } from '../store';
import { cellAt, lineCells } from './geo';
import type { Intervention } from '../sim/flood/types';

type Controls = { enabled: boolean } | null;

export function useTools() {
  const controls = useThree(s => s.controls) as unknown as Controls;
  const drawing = useRef(false);

  const interventionAt = (cell: number, building: number): Intervention | undefined => {
    const { plan, grid } = useStore.getState();
    if (building >= 0) return plan.find(p => p.type === 'rwh' && p.building === building);
    return plan.find(p => p.cells?.includes(cell)) ?? (grid && grid.drain[cell] >= 0 ? plan.find(p => p.type === 'desilt' && p.unit === grid.drain[cell]) : undefined);
  };

  const terrain = {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => {
      const { grid, draft } = useStore.getState();
      if (!grid) return;
      const cell = cellAt(grid, e.point.x, e.point.z), h = useStore.getState().hover;
      if (!h || h.cell !== cell) useStore.setState({ hover: cell >= 0 ? { cell, building: -1 } : null });
      if (drawing.current && draft && cell >= 0 && cell !== draft[draft.length - 1]) {
        const ext = lineCells(grid, draft[draft.length - 1], cell).slice(1).filter(c => !draft.includes(c));
        useStore.setState({ draft: [...draft, ...ext].slice(0, 160) });
      }
    },
    // only clear when what we left was the ground: a house may have just taken the hover in this same event
    onPointerOut: () => { const h = useStore.getState().hover; if (!drawing.current && h && h.building < 0) useStore.setState({ hover: null }); },
    onPointerDown: (e: ThreeEvent<PointerEvent>) => {
      const { tool, grid } = useStore.getState();
      if (tool !== 'drain' || !grid || e.button !== 0) return;
      const cell = cellAt(grid, e.point.x, e.point.z);
      if (cell < 0) return;
      e.stopPropagation();
      drawing.current = true;
      if (controls) controls.enabled = false;
      useStore.setState({ draft: [cell] });
      const finish = () => {
        window.removeEventListener('pointerup', finish);
        drawing.current = false;
        if (controls) controls.enabled = true;
        const { draft, add } = useStore.getState();
        if (draft && draft.length >= 2) add({ type: 'drain', cells: draft });
        else if (draft) useStore.getState().notify('Drag along the street to draw a drain (at least 2 cells)');
        useStore.setState({ draft: null });
      };
      window.addEventListener('pointerup', finish);
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (e.delta > 4) return;   // that was an orbit drag
      const { tool, grid, add, remove } = useStore.getState();
      if (!grid) return;
      const cell = cellAt(grid, e.point.x, e.point.z);
      if (cell < 0) return;
      e.stopPropagation();
      if (tool === 'inspect') useStore.setState({ selection: { kind: 'cell', cell } });
      else if (tool === 'garden' || tool === 'pit') add({ type: tool, cells: footprintFor(tool, grid, cell) });
      else if (tool === 'desilt') {
        if (grid.drain[cell] >= 0) add({ type: 'desilt', unit: grid.drain[cell] });
        else useStore.getState().notify('Click an existing roadside drain (the brown lines along streets)');
      } else if (tool === 'rwh') useStore.getState().notify('Click a building roof to add rainwater harvesting');
      else if (tool === 'erase') { const iv = interventionAt(cell, -1); if (iv) remove(iv.id); }
    },
  };

  const buildings = {
    onPointerMove: (e: ThreeEvent<PointerEvent>, building: number) => {
      e.stopPropagation();
      const h = useStore.getState().hover;
      if (!h || h.building !== building) useStore.setState({ hover: { cell: -1, building } });
    },
    onPointerOut: () => { const h = useStore.getState().hover; if (h && h.building >= 0) useStore.setState({ hover: null }); },
    onClick: (e: ThreeEvent<MouseEvent>, building: number) => {
      if (e.delta > 4) return;
      e.stopPropagation();
      const { tool, add, remove } = useStore.getState();
      if (tool === 'rwh') add({ type: 'rwh', building });
      else if (tool === 'erase') { const iv = interventionAt(-1, building); if (iv) remove(iv.id); }
      else if (tool === 'inspect') useStore.setState({ selection: { kind: 'building', building } });
      else useStore.getState().notify('That is a building. Pick open ground, a street or a drain for this tool');
    },
  };
  return { terrain, buildings };
}
