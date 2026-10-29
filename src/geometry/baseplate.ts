import type { Manifold } from 'manifold-3d';
import {
  BASEPLATE_HEIGHT,
  BASEPLATE_OUTER_RADIUS,
  BASEPLATE_PROFILE,
  GRID,
  HOLE_OFFSET,
  MAGNET_DEPTH,
  MAGNET_DIAMETER,
  SOLID_BOTTOM,
  WEIGHTED_BOTTOM,
  WEIGHT_POCKET_DEPTH,
  WEIGHT_POCKET_SIZE,
} from './constants';
import { box, cylinderAt, prism, roundedLoft, roundedRect, subtractAll } from './kernel';

export type PlateStyle = 'thin' | 'solid' | 'weighted';

export interface PlateParams {
  width: number;
  depth: number;
  style: PlateStyle;
  magnets: boolean;
  /** Drawer interior size in mm; 0 means "use width/depth in units". */
  drawerW: number;
  drawerD: number;
  /** Where leftover drawer space goes: -1 all at the start, 0 split evenly, 1 all at the end. */
  alignX: number;
  alignY: number;
}

export const defaultPlate: PlateParams = {
  width: 3,
  depth: 3,
  style: 'thin',
  magnets: false,
  drawerW: 0,
  drawerD: 0,
  alignX: 0,
  alignY: 0,
};

export interface AxisLayout {
  units: number;
  padStart: number;
  padEnd: number;
  length: number;
}

export interface PlateLayout {
  x: AxisLayout;
  y: AxisLayout;
  bottom: number;
  height: number;
}

function axis(units: number, drawer: number, align: number): AxisLayout {
  if (drawer > 0) {
    const n = Math.max(1, Math.floor(drawer / GRID + 1e-9));
    const pad = Math.max(0, drawer - n * GRID);
    const a = Math.min(1, Math.max(-1, align));
    const padStart = (pad * (1 + a)) / 2;
    return { units: n, padStart, padEnd: pad - padStart, length: n * GRID + pad };
  }
  const n = Math.max(1, Math.round(units));
  return { units: n, padStart: 0, padEnd: 0, length: n * GRID };
}

export function plateBottom(p: PlateParams): number {
  if (p.style === 'weighted') return WEIGHTED_BOTTOM;
  if (p.style === 'solid' || p.magnets) return SOLID_BOTTOM;
  return 0;
}

export function plateLayout(p: PlateParams): PlateLayout {
  const bottom = plateBottom(p);
  return {
    x: axis(p.width, p.drawerW, p.alignX),
    y: axis(p.depth, p.drawerD, p.alignY),
    bottom,
    height: bottom + BASEPLATE_HEIGHT,
  };
}

export function socketCutter(w: number, d: number, cx: number, cy: number, bottom: number): Manifold {
  const levels = BASEPLATE_PROFILE.map(([inset, z]) => ({ z: bottom + z, inset }));
  if (bottom === 0) levels[0] = { z: -1, inset: levels[0].inset };
  levels.push({ z: bottom + BASEPLATE_HEIGHT + 1, inset: -1 });
  return roundedLoft(w, d, BASEPLATE_OUTER_RADIUS, levels, cx, cy);
}

/** Plate spans x in [0, length.x], y in [0, length.y], z in [0, height]. */
export function buildPlate(p: PlateParams): Manifold {
  const L = plateLayout(p);
  const W = L.x.length;
  const D = L.y.length;
  const plate = prism(roundedRect(W, D, BASEPLATE_OUTER_RADIUS, W / 2, D / 2), 0, L.height);

  const cutters: Manifold[] = [];
  for (let i = 0; i < L.x.units; i++) {
    for (let j = 0; j < L.y.units; j++) {
      const cx = L.x.padStart + (i + 0.5) * GRID;
      const cy = L.y.padStart + (j + 0.5) * GRID;
      cutters.push(socketCutter(GRID, GRID, cx, cy, L.bottom));

      if (p.magnets && L.bottom > 0) {
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            cutters.push(
              cylinderAt(cx + sx * HOLE_OFFSET, cy + sy * HOLE_OFFSET, L.bottom - MAGNET_DEPTH, L.bottom + 0.01, MAGNET_DIAMETER / 2),
            );
          }
        }
      }
      if (p.style === 'weighted') {
        const h = WEIGHT_POCKET_SIZE / 2;
        cutters.push(box(cx - h, cx + h, cy - h, cy + h, -1, WEIGHT_POCKET_DEPTH));
      }
    }
  }
  return subtractAll(plate, cutters);
}
