import { magnetCutter, type MagnetOptions } from './magnets';
import type { Manifold } from 'manifold-3d';
import { cellCentres, cellPitches } from './bin';
import { socketCutter } from './baseplate';
import { BASE_PROFILE, BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, BASE_TOP_SIZE_GAP, BASEPLATE_HEIGHT, GRID, HOLE_OFFSET } from './constants';
import { k, prism, roundedLoft, roundedRect, subtractAll } from './kernel';

export interface LidParams extends MagnetOptions {
  width: number;
  depth: number;
  style: 'flat' | 'stackable';
  handle: boolean;
  magnets: boolean;
}

export const defaultLid: LidParams = {
  width: 2, depth: 1, style: 'flat', handle: false, magnets: false, magnetStyle: 'plain', magnetChamfer: false,
};

/** Length of the refined pocket's loading slot from the pocket centre (see magnetCutter). */
const REFINED_SLOT = 11;
/** Foot inset at the top of a refined pocket: the slot must reach past it to open outside. */
const FOOT_INSET = 2.15;

/**
 * Lids have one continuous foot, so a refined pocket can only be loaded if its
 * slot reaches the lid's outer wall. Returns, per pocket, the loading direction
 * in degrees (0 = +X), or undefined when no direction reaches the outside.
 */
export function refinedLidDirections(p: LidParams): { x: number; y: number; angle?: number }[] {
  const xs = cellPitches(p.width), ys = cellPitches(p.depth);
  const cxs = cellCentres(xs), cys = cellCentres(ys);
  const hx = (p.width * GRID - BASE_TOP_SIZE_GAP) / 2 - FOOT_INSET;
  const hy = (p.depth * GRID - BASE_TOP_SIZE_GAP) / 2 - FOOT_INSET;
  const out: { x: number; y: number; angle?: number }[] = [];
  cxs.forEach((cx, i) => cys.forEach((cy, j) => {
    if (xs[i] !== GRID || ys[j] !== GRID) return;
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const x = cx + sx * HOLE_OFFSET, y = cy + sy * HOLE_OFFSET;
      const options: [number, boolean][] = [
        [sx < 0 ? 180 : 0, sx < 0 ? x - REFINED_SLOT <= -hx : x + REFINED_SLOT >= hx],
        [sx < 0 ? 0 : 180, sx < 0 ? x + REFINED_SLOT >= hx : x - REFINED_SLOT <= -hx],
        [sy < 0 ? 270 : 90, sy < 0 ? y - REFINED_SLOT <= -hy : y + REFINED_SLOT >= hy],
        [sy < 0 ? 90 : 270, sy < 0 ? y + REFINED_SLOT >= hy : y - REFINED_SLOT <= -hy],
      ];
      out.push({ x, y, angle: options.find(([, ok]) => ok)?.[0] });
    }
  }));
  return out;
}

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
    if (p.magnets && p.magnetStyle !== 'refined' && xs[i] === GRID && ys[j] === GRID) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        cuts.push(magnetCutter(p.magnetStyle, p.magnetChamfer).rotate([0, 0, sx < 0 ? 180 : 0]).translate([cx + sx * HOLE_OFFSET, cy + sy * HOLE_OFFSET, 0]));
      }
    }
  }));
  if (p.magnets && p.magnetStyle === 'refined') {
    // Pockets whose slot can't reach the outer wall get a plain pocket instead.
    for (const { x, y, angle } of refinedLidDirections(p)) {
      const cutter = angle === undefined ? magnetCutter('plain', false) : magnetCutter('refined').rotate([0, 0, angle]);
      cuts.push(cutter.translate([x, y, 0]));
    }
  }
  // Recess the first cell's floor, keeping the stacking surface clear.
  if (p.handle) cuts.push(prism(roundedRect(Math.min(xs[0] - 10, 24), 8, 4, cxs[0], cys[0]), floorTop - 1, top + 1));
  return subtractAll(k().Manifold.union(parts), cuts);
}
