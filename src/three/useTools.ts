// Pointer handling for the terrain and buildings: hover, inspect, place, draw (drains / walkways), erase.
// Hover, selection and drawing are shared; what a click places depends on the mode (flood plan vs heat plan).
import { useThree, type ThreeEvent } from '@react-three/fiber';
import { useRef } from 'react';
import { useStore, footprintFor } from '../store';
import { useHeat } from '../heatStore';
import { cellAt, lineCells } from './geo';
import type { Intervention } from '../sim/flood/types';
import type { HeatIntervention } from '../sim/heat/types';

type Controls = { enabled: boolean } | null;

export function useTools() {
  const controls = useThree(s => s.controls) as unknown as Controls;
  const drawing = useRef(false);

  const floodAt = (cell: number, building: number): Intervention | undefined => {
    const { plan, grid } = useStore.getState();
    if (building >= 0) return plan.find(p => p.type === 'rwh' && p.building === building);
    return plan.find(p => p.cells?.includes(cell)) ?? (grid && grid.drain[cell] >= 0 ? plan.find(p => p.type === 'desilt' && p.unit === grid.drain[cell]) : undefined);
  };
  const heatAt = (cell: number, building: number): HeatIntervention | undefined => {
    const { plan } = useHeat.getState();
    if (building >= 0) return plan.find(p => p.type === 'coolroof' && p.building === building);
    return plan.find(p => p.cells?.includes(cell));
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
      const { tool, grid, mode } = useStore.getState();
      const drawTool = mode === 'flood' ? 'drain' : 'walkway';
      if (tool !== drawTool || !grid || e.button !== 0) return;
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
        const { draft, add, notify } = useStore.getState();
        if (draft && draft.length >= 2) { if (drawTool === 'drain') add({ type: 'drain', cells: draft }); else useHeat.getState().add({ type: 'walkway', cells: draft }); }
        else if (draft) notify(drawTool === 'drain' ? 'Drag along the street to draw a drain (at least 2 cells)' : 'Drag along the footpath to draw a shaded walkway (at least 2 cells)');
        useStore.setState({ draft: null });
      };
      window.addEventListener('pointerup', finish);
    },
    onClick: (e: ThreeEvent<MouseEvent>) => {
      if (e.delta > 4) return;   // that was an orbit drag
      const { tool, grid, add, remove, mode, notify } = useStore.getState();
      if (!grid) return;
      const cell = cellAt(grid, e.point.x, e.point.z);
      if (cell < 0) return;
      e.stopPropagation();
      if (tool === 'inspect') { useStore.setState({ selection: { kind: 'cell', cell } }); return; }
      if (mode === 'heat') {
        const heat = useHeat.getState();
        if (tool === 'tree' || tool === 'canopy') heat.add({ type: tool, cells: [cell] });
        else if (tool === 'coolroof') notify('Click a building roof to make it a cool roof');
        else if (tool === 'erase') { const iv = heatAt(cell, -1); if (iv) heat.remove(iv.id); }
        return;
      }
      if (tool === 'garden' || tool === 'pit') add({ type: tool, cells: footprintFor(tool, grid, cell) });
      else if (tool === 'desilt') {
        if (grid.drain[cell] >= 0) add({ type: 'desilt', unit: grid.drain[cell] });
        else notify('Click an existing roadside drain (the brown lines along streets)');
      } else if (tool === 'rwh') notify('Click a building roof to add rainwater harvesting');
      else if (tool === 'erase') { const iv = floodAt(cell, -1); if (iv) remove(iv.id); }
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
      const { tool, add, remove, mode, notify } = useStore.getState();
      if (tool === 'inspect') { useStore.setState({ selection: { kind: 'building', building } }); return; }
      if (mode === 'heat') {
        const heat = useHeat.getState();
        if (tool === 'coolroof') heat.add({ type: 'coolroof', building });
        else if (tool === 'erase') { const iv = heatAt(-1, building); if (iv) heat.remove(iv.id); }
        else notify('That is a building. Trees and shade go on streets, paving or open ground');
        return;
      }
      if (tool === 'rwh') add({ type: 'rwh', building });
      else if (tool === 'erase') { const iv = floodAt(-1, building); if (iv) remove(iv.id); }
      else notify('That is a building. Pick open ground, a street or a drain for this tool');
    },
  };
  return { terrain, buildings };
}
