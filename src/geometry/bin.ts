import type { Manifold, Vec2 } from 'manifold-3d';
import {
  BASE_PROFILE,
  BASE_PROFILE_HEIGHT,
  BASE_TOP_RADIUS,
  BASE_TOP_SIZE_GAP,
  DIVIDER_THICKNESS,
  GRID,
  HEIGHT_UNIT,
  HOLE_OFFSET,
  LIP_DEPTH,
  LIP_HEIGHT,
  LIP_SUPPORT_HEIGHT,
  LIP_TIP_TRIM,
  MAGNET_DEPTH,
  MAGNET_DIAMETER,
  SCREW_DEPTH,
  SCREW_DIAMETER,
  TAB_ANGLE_DEG,
  TAB_DEPTH,
  TAB_TIP,
} from './constants';
import {
  box,
  cylinderAt,
  extrudeAlongX,
  k,
  prism,
  roundedLoft,
  roundedRect,
  subtractAll,
  unionAll,
} from './kernel';

export type LipStyle = 'normal' | 'none';
export type TabStyle = 'none' | 'full' | 'left' | 'center' | 'right';

export interface BinParams {
  /** Width / depth in grid units (multiples of 0.5). */
  width: number;
  depth: number;
  /** Height in 7 mm units, foot included, lip excluded. */
  height: number;
  wall: number;
  /** Floor thickness above the top of the foot profile (4.75 mm). */
  floor: number;
  lip: LipStyle;
  compartmentsX: number;
  compartmentsY: number;
  tab: TabStyle;
  /** Finger scoop size, 0 (off) to 1 (half the compartment depth). */
  scoop: number;
  solid: boolean;
  magnets: boolean;
  screws: boolean;
  cornerHolesOnly: boolean;
}

export const defaultBin: BinParams = {
  width: 2,
  depth: 1,
  height: 6,
  wall: 0.95,
  floor: 2.25,
  lip: 'normal',
  compartmentsX: 1,
  compartmentsY: 1,
  tab: 'none',
  scoop: 0,
  solid: false,
  magnets: false,
  screws: false,
  cornerHolesOnly: false,
};

/** Cell pitches along one axis: whole 42 mm cells plus an optional 21 mm half cell. */
export function cellPitches(units: number): number[] {
  const whole = Math.floor(units + 1e-9);
  const cells = Array<number>(whole).fill(GRID);
  if (units - whole > 0.25) cells.push(GRID / 2);
  return cells;
}

/** Centre coordinate of each cell, with the whole grid centred on 0. */
export function cellCentres(pitches: number[]): number[] {
  const total = pitches.reduce((a, b) => a + b, 0);
  let x = -total / 2;
  return pitches.map((p) => {
    const c = x + p / 2;
    x += p;
    return c;
  });
}

export interface BinLayout {
  outerW: number;
  outerD: number;
  top: number;
  floorZ: number;
  /** Highest Z the interior features (dividers, tabs) may reach. */
  interiorTop: number;
  cavW: number;
  cavD: number;
  wall: number;
}

export function binLayout(p: BinParams): BinLayout {
  const outerW = p.width * GRID - BASE_TOP_SIZE_GAP;
  const outerD = p.depth * GRID - BASE_TOP_SIZE_GAP;
  const top = p.height * HEIGHT_UNIT;
  const wall = p.lip === 'normal' ? Math.min(p.wall, LIP_DEPTH) : p.wall;
  const floorZ = BASE_PROFILE_HEIGHT + p.floor;
  const interiorTop = p.lip === 'normal' ? top - LIP_SUPPORT_HEIGHT - (LIP_DEPTH - wall) : top;
  return { outerW, outerD, top, floorZ, interiorTop, cavW: outerW - 2 * wall, cavD: outerD - 2 * wall, wall };
}

export function validateBin(p: BinParams): string[] {
  const errors: string[] = [];
  const L = binLayout(p);
  if (p.width < 0.5 || p.depth < 0.5) errors.push('Width and depth must be at least 0.5 units.');
  if (L.interiorTop - L.floorZ < 3 && !p.solid) errors.push('Bin is too short for this floor and lip; add height.');
  if (L.cavW < 4 || L.cavD < 4) errors.push('Walls are too thick for this bin size.');
  return errors;
}

function foot(cellW: number, cellD: number, cx: number, cy: number): Manifold {
  const w = cellW - BASE_TOP_SIZE_GAP;
  const d = cellD - BASE_TOP_SIZE_GAP;
  return roundedLoft(
    w,
    d,
    BASE_TOP_RADIUS,
    BASE_PROFILE.map(([inset, z]) => ({ z, inset })),
    cx,
    cy,
  );
}

function holeCentres(p: BinParams): Vec2[] {
  const xs = cellPitches(p.width);
  const ys = cellPitches(p.depth);
  const cxs = cellCentres(xs);
  const cys = cellCentres(ys);
  const pts: Vec2[] = [];
  cxs.forEach((cx, i) => {
    cys.forEach((cy, j) => {
      if (xs[i] < GRID || ys[j] < GRID) return; // half cells have no room for holes
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          if (p.cornerHolesOnly) {
            const outerX = sx < 0 ? i === 0 : i === cxs.length - 1;
            const outerY = sy < 0 ? j === 0 : j === cys.length - 1;
            if (!outerX || !outerY) continue;
          }
          pts.push([cx + sx * HOLE_OFFSET, cy + sy * HOLE_OFFSET]);
        }
      }
    });
  });
  return pts;
}

/**
 * Hollow cut: the cavity, plus (with a lip) the support chamfer and the
 * stacking-lip socket that the next bin's foot sits in.
 */
function cavityCut(p: BinParams, L: BinLayout): Manifold | undefined {
  const { outerW: W, outerD: D, top, floorZ, wall } = L;
  const r = BASE_TOP_RADIUS;
  if (p.lip === 'none') {
    return p.solid ? undefined : roundedLoft(W, D, r, [
      { z: floorZ, inset: wall },
      { z: top + 1, inset: wall },
    ]);
  }
  const lipTop = top + LIP_HEIGHT;
  const lipLevels = [
    { z: top, inset: LIP_DEPTH },
    { z: top + 0.7, inset: 1.9 },
    { z: top + 2.5, inset: 1.9 },
    { z: lipTop, inset: 0 },
    { z: lipTop + 1, inset: -1 },
  ];
  if (p.solid) return roundedLoft(W, D, r, lipLevels);
  const supportBottom = top - LIP_SUPPORT_HEIGHT - (LIP_DEPTH - wall);
  return roundedLoft(W, D, r, [
    { z: floorZ, inset: wall },
    { z: supportBottom, inset: wall },
    { z: top - LIP_SUPPORT_HEIGHT, inset: LIP_DEPTH },
    ...lipLevels,
  ]);
}

function interior(p: BinParams, L: BinLayout): Manifold | undefined {
  if (p.solid) return undefined;
  const { cavW, cavD, floorZ, interiorTop } = L;
  const t = DIVIDER_THICKNESS;
  const nx = Math.max(1, Math.round(p.compartmentsX));
  const ny = Math.max(1, Math.round(p.compartmentsY));
  const compW = (cavW - (nx - 1) * t) / nx;
  const compD = (cavD - (ny - 1) * t) / ny;
  const x0 = -cavW / 2;
  const y0 = -cavD / 2;
  const parts: Manifold[] = [];

  for (let i = 1; i < nx; i++) {
    const x = x0 + i * compW + (i - 1) * t;
    parts.push(box(x, x + t, y0, -y0, floorZ - 0.01, interiorTop));
  }
  for (let j = 1; j < ny; j++) {
    const y = y0 + j * compD + (j - 1) * t;
    parts.push(box(x0, -x0, y, y + t, floorZ - 0.01, interiorTop));
  }

  const height = interiorTop - floorZ;
  if (p.scoop > 0) {
    const radius = Math.min(p.scoop * (compD / 2), height - 1);
    if (radius > 0.5) {
      for (let j = 0; j < ny; j++) {
        const yf = y0 + j * (compD + t); // front edge of this compartment row
        // Fillet between the front wall and the floor: corner, then a concave
        // quarter circle from (yf, floor + r) to (yf + r, floor).
        const profile: Vec2[] = [
          [yf - 0.01, floorZ - 0.01],
          [yf - 0.01, floorZ + radius],
        ];
        const steps = 16;
        for (let s = 0; s <= steps; s++) {
          const a = Math.PI + (s / steps) * (Math.PI / 2);
          profile.push([yf + radius + radius * Math.cos(a), floorZ + radius + radius * Math.sin(a)]);
        }
        profile.push([yf + radius, floorZ - 0.01]);
        parts.push(extrudeAlongX(profile, x0, -x0));
      }
    }
  }

  if (p.tab !== 'none') {
    const depth = Math.min(TAB_DEPTH, compD * 0.5);
    const rise = Math.tan((TAB_ANGLE_DEG * Math.PI) / 180) * depth + TAB_TIP;
    if (rise < height - 1) {
      for (let j = 0; j < ny; j++) {
        const yb = y0 + j * (compD + t) + compD; // back edge of this compartment row
        const zt = interiorTop;
        const profile: Vec2[] = [
          [yb + 0.01, zt - rise],
          [yb + 0.01, zt],
          [yb - depth, zt],
          [yb - depth, zt - TAB_TIP],
        ];
        for (let i = 0; i < nx; i++) {
          const cx0 = x0 + i * (compW + t);
          const tw = p.tab === 'full' ? compW : Math.min(GRID, compW);
          let start = cx0;
          if (p.tab === 'center') start = cx0 + (compW - tw) / 2;
          if (p.tab === 'right') start = cx0 + compW - tw;
          parts.push(extrudeAlongX(profile, start, start + tw));
        }
      }
    }
  }

  const all = unionAll(parts);
  if (!all) return undefined;
  // Keep features inside the cavity so they never poke through rounded corners.
  const clip = prism(roundedRect(cavW + 0.02, cavD + 0.02, Math.max(BASE_TOP_RADIUS - L.wall, 0.25)), floorZ - 0.02, interiorTop + 0.01);
  return all.intersect(clip);
}

export function buildBin(p: BinParams): Manifold {
  const L = binLayout(p);
  const xs = cellPitches(p.width);
  const ys = cellPitches(p.depth);
  const cxs = cellCentres(xs);
  const cys = cellCentres(ys);

  const feet: Manifold[] = [];
  cxs.forEach((cx, i) => cys.forEach((cy, j) => feet.push(foot(xs[i], ys[j], cx, cy))));

  const blockTop = p.lip === 'normal' ? L.top + LIP_HEIGHT - LIP_TIP_TRIM : L.top;
  const body = prism(roundedRect(L.outerW, L.outerD, BASE_TOP_RADIUS), BASE_PROFILE_HEIGHT, blockTop);
  let solid = k().Manifold.union([...feet, body]);

  const cutters: Manifold[] = [];
  const cavity = cavityCut(p, L);
  if (cavity) cutters.push(cavity);
  const holes = holeCentres(p);
  for (const [x, y] of holes) {
    if (p.magnets) cutters.push(cylinderAt(x, y, -1, MAGNET_DEPTH, MAGNET_DIAMETER / 2));
    if (p.screws) {
      const depth = Math.min(SCREW_DEPTH, L.floorZ - 0.6);
      cutters.push(cylinderAt(x, y, -1, depth, SCREW_DIAMETER / 2, 20));
    }
  }
  solid = subtractAll(solid, cutters);

  const inside = interior(p, L);
  return inside ? solid.add(inside) : solid;
}
