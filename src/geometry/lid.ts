import type { Manifold } from 'manifold-3d';
import { cellCentres, cellPitches } from './bin';
import { socketCutter } from './baseplate';
import { BASE_PROFILE, BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, BASE_TOP_SIZE_GAP, BASEPLATE_HEIGHT, GRID, HOLE_OFFSET, MAGNET_DEPTH, MAGNET_DIAMETER } from './constants';
import { cylinderAt, k, prism, roundedLoft, roundedRect, subtractAll } from './kernel';

export interface LidParams {
  width: number;
  depth: number;
  style: 'flat' | 'stackable';
  handle: boolean;
  magnets: boolean;
}

export const defaultLid: LidParams = {
  width: 2, depth: 1, style: 'flat', handle: false, magnets: false,
};

export function buildLid(p: LidParams): Manifold {
  if (![p.width, p.depth].every(n => Number.isFinite(n) && n >= 0.5 && Number.isInteger(n * 2))) {
    throw new Error('Lid dimensions must be half-unit steps, at least 0.5.');
  }
  if (p.style !== 'flat' && p.style !== 'stackable') throw new Error('Unknown lid style.');
  const xs = cellPitches(p.width), ys = cellPitches(p.depth);
  const cxs = cellCentres(xs), cys = cellCentres(ys);
  const W = p.width * GRID - BASE_TOP_SIZE_GAP, D = p.depth * GRID - BASE_TOP_SIZE_GAP;
  const floorTop = BASE_PROFILE_HEIGHT + 2.25;
  const top = floorTop + (p.style === 'stackable' ? BASEPLATE_HEIGHT : 0);
  const parts = [
    roundedLoft(W, D, BASE_TOP_RADIUS, BASE_PROFILE.map(([inset, z]) => ({ z, inset }))),
    prism(roundedRect(W, D, BASE_TOP_RADIUS), BASE_PROFILE_HEIGHT, top),
  ];
  const cuts: Manifold[] = [];
  cxs.forEach((cx, i) => cys.forEach((cy, j) => {
    if (p.style === 'stackable') cuts.push(socketCutter(xs[i], ys[j], cx, cy, floorTop));
    if (p.magnets && xs[i] === GRID && ys[j] === GRID) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        cuts.push(cylinderAt(cx + sx * HOLE_OFFSET, cy + sy * HOLE_OFFSET, -1, MAGNET_DEPTH, MAGNET_DIAMETER / 2));
      }
    }
  }));
  // Recess the first cell's floor, keeping the stacking surface clear.
  if (p.handle) cuts.push(prism(roundedRect(Math.min(xs[0] - 10, 24), 8, 4, cxs[0], cys[0]), floorTop - 1, top + 1));
  return subtractAll(k().Manifold.union(parts), cuts);
}
