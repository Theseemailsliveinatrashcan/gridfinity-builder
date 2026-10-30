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
  loft,
  roundedRect,
  subtractAll,
  unionAll,
} from './kernel';

export type LipStyle = 'normal' | 'none';
export type HeightMode = 'units' | 'internal';
export type TabStyle = 'none' | 'full' | 'left' | 'center' | 'right';

export interface BinParams {
  /** Width / depth in grid units (multiples of 0.5). */
  width: number;
  depth: number;
  /** Height in 7 mm units, foot included, lip excluded. */
  height: number;
  /** 'internal': size the bin by usable depth (floor to top of the walls) instead. */
  heightMode: HeightMode;
  /** Usable depth in mm, used when heightMode is 'internal'. */
  internalDepth: number;
  wall: number;
  /** Floor thickness above the top of the foot profile (4.75 mm). */
  floor: number;
  lip: LipStyle;
  withLid: boolean;
  lidStyle: 'flat' | 'stackable';
  lidGrip: boolean;
  compartmentsX: number;
  compartmentsY: number;
  tab: TabStyle;
  labelSlot: 'none' | 'card';
  cardPlay: number;
  /** Finger scoop size, 0 (off) to 1 (half the compartment depth). */
  scoop: number;
  scoopSides: 'front' | 'all';
  solid: boolean;
  magnets: boolean;
  screws: boolean;
  cornerHolesOnly: boolean;
}

export const defaultBin: BinParams = {
  width: 2,
  depth: 1,
  height: 6,
  heightMode: 'units',
  internalDepth: 30,
  wall: 0.95,
  floor: 2.25,
  lip: 'normal',
  withLid: false,
  lidStyle: 'flat',
  lidGrip: false,
  compartmentsX: 1,
  compartmentsY: 1,
  tab: 'none',
  labelSlot: 'none',
  cardPlay: 0.25,
  scoop: 0,
  scoopSides: 'front',
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
  const wall = p.lip === 'normal' ? Math.min(p.wall, LIP_DEPTH) : p.wall;
  const floorZ = BASE_PROFILE_HEIGHT + p.floor;
  const lipSupport = p.lip === 'normal' ? LIP_SUPPORT_HEIGHT + (LIP_DEPTH - wall) : 0;
  const top = p.heightMode === 'internal' ? floorZ + p.internalDepth + lipSupport : p.height * HEIGHT_UNIT;
  const interiorTop = top - lipSupport;
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

export interface LabelCardSlot {
  width: number;
  cx: number;
  backY: number;
  bottomZ: number;
  backWall: number;
}

export function labelCardSlots(p: BinParams, L = binLayout(p)): LabelCardSlot[] {
  if (p.labelSlot !== 'card' || p.solid) return [];
  if (!Number.isFinite(p.cardPlay) || p.cardPlay < 0.1 || p.cardPlay > 0.5) throw new Error('Card play must be 0.1–0.5 mm per side.');
  const nx = Math.max(1, Math.round(p.compartmentsX)), ny = Math.max(1, Math.round(p.compartmentsY));
  const w = (L.cavW - (nx - 1) * DIVIDER_THICKNESS) / nx;
  const d = (L.cavD - (ny - 1) * DIVIDER_THICKNESS) / ny;
  const width = Math.max(20, Math.min(80, w - 4));
  const backInset = (p.lip === 'normal' ? LIP_DEPTH - L.wall : 0) + 1.5;
  if (w < width + 2 * p.cardPlay + 1.6 + 0.2 || d < backInset + 1 + p.cardPlay + 2.6) throw new Error('Compartment too small for a label card slot; reduce compartments or enlarge the bin.');
  const cardTop = L.floorZ + 0.8 + 12;
  if (p.withLid && p.lip === 'normal' && cardTop > L.top - 0.5 + 1e-9) {
    throw new Error(`Bin too short for label cards with a lid (needs ${Math.ceil((cardTop + 0.5) / HEIGHT_UNIT)} units)`);
  }
  if (L.interiorTop - L.floorZ < 4) throw new Error('Label card slots need at least 4 mm of inside height.');
  const slots: LabelCardSlot[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    const backWall = -L.cavD / 2 + j * (d + DIVIDER_THICKNESS) + d;
    slots.push({ width: +width.toFixed(4), cx: -L.cavW / 2 + i * (w + DIVIDER_THICKNESS) + w / 2,
      backY: backWall - backInset, bottomZ: L.floorZ + 0.8, backWall });
  }
  // Validate against real walls, dividers and the complete stacking lip, not just
  // the low channel. Scoops are cleared by the channel construction below.
  const shell = buildBin({ ...p, labelSlot: 'none', tab: 'none', scoop: 0, withLid: false });
  for (const slot of slots) {
    const fits = () => Math.abs(labelCardSweep(slot, p.cardPlay, shell).intersect(shell).volume()) < 1e-7;
    if (fits()) continue;
    const maximum = slot.width;
    slot.width = 20;
    if (!fits()) throw new Error('Compartments too narrow for label cards');
    let lo = 20, hi = maximum;
    while (hi - lo > 0.0001) {
      slot.width = (lo + hi) / 2;
      if (fits()) lo = slot.width; else hi = slot.width;
    }
    slot.width = Math.floor(lo * 10000) / 10000;
  }
  return slots;
}

export function labelCardSweep(slot: LabelCardSlot, play: number, bin: Manifold): Manifold {
  return labelCardChannel(slot, play, Math.max(bin.boundingBox().max[2] + 1, slot.bottomZ + 13));
}

export function labelCardChannel(slot: LabelCardSlot, play: number, top: number): Manifold {
  return box(slot.cx - slot.width / 2 - play, slot.cx + slot.width / 2 + play,
    slot.backY - 1 - play, slot.backY + play, slot.bottomZ, top);
}

/** Blank card prints flat; rotate +90° about X and translate to its slot to insert. */
export function buildLabelCard(width: number): Manifold {
  const rectangle = (inset: number): Vec2[] => [[-width / 2 + inset, -0.5 + inset], [width / 2 - inset, -0.5 + inset],
    [width / 2 - inset, 0.5 - inset], [-width / 2 + inset, 0.5 - inset]];
  return loft([{ z: 0, outline: rectangle(0) }, { z: 11.6, outline: rectangle(0) }, { z: 12, outline: rectangle(0.4) }])
    .warp(v => { const y = v[1]; v[1] = v[2]; v[2] = 0.5 - y; });
}

function labelCardRail(slot: LabelCardSlot, play: number, floor: number): Manifold {
  const x0 = slot.cx - slot.width / 2 - play - 0.8, x1 = slot.cx + slot.width / 2 + play + 0.8;
  const front = slot.backY - 1 - play - 0.8;
  const frame = box(x0, x1, front, slot.backY + play + 0.8, floor - 0.01, floor + 4);
  const base = box(x0, x1, front, slot.backWall + 0.01, floor - 0.01, slot.bottomZ);
  const fillet = extrudeAlongX(scoopProfile(0, floor, 0.8), x0, x1).mirror([0, 1, 0]).translate([0, front, 0]);
  return k().Manifold.union([frame, base, fillet]);
}

function scoopProfile(edge: number, floor: number, radius: number): Vec2[] {
  const profile: Vec2[] = [[edge - 0.01, floor - 0.01], [edge - 0.01, floor + radius]];
  for (let step = 0; step <= 16; step++) {
    const angle = Math.PI + step / 16 * Math.PI / 2;
    profile.push(step === 0 ? [edge, floor + radius] : step === 16 ? [edge + radius, floor] : [edge + radius + radius * Math.cos(angle), floor + radius + radius * Math.sin(angle)]);
  }
  profile.push([edge + radius, floor - 0.01]);
  return profile;
}

function interior(p: BinParams, L: BinLayout, slots: LabelCardSlot[]): Manifold | undefined {
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
  if (p.scoop > 0 && p.scoopSides === 'all') {
    const radius = Math.min(p.scoop * Math.min(compW, compD) / 2, height - 1);
    if (radius > 1e-6) {
      const profile = scoopProfile(0, floorZ, radius);
      // Overlap adjoining walls rather than leaving numerically coincident end faces.
      const front = extrudeAlongX(profile, -0.01, compW + 0.01);
      const left = extrudeAlongX(profile, -0.01, compD + 0.01).warp(v => { const x = v[0]; v[0] = v[1]; v[1] = compD - x; });
      const fillets = [front, left, left.mirror([1, 0, 0]).translate([compW, 0, 0])];
      if (p.tab === 'none' && p.labelSlot !== 'card') fillets.push(front.mirror([0, 1, 0]).translate([0, compD, 0]));
      const cell = k().Manifold.union(fillets);
      for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
        parts.push(cell.translate([x0 + i * (compW + t), y0 + j * (compD + t), 0]));
      }
    }
  } else if (p.scoop > 0) {
    const radius = Math.min(p.scoop * (compD / 2), height - 1);
    if (radius > 0.5) {
      for (let j = 0; j < ny; j++) {
        const yf = y0 + j * (compD + t); // front edge of this compartment row
        const profile = scoopProfile(yf, floorZ, radius);
        parts.push(extrudeAlongX(profile, x0, -x0));
      }
    }
  }

  if (p.tab !== 'none' && p.labelSlot !== 'card') {
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
          // Overlap the side walls slightly, like the fillet strips, so no zero-thickness sheets remain.
          parts.push(extrudeAlongX(profile, start - 0.01, start + tw + 0.01));
        }
      }
    }
  }

  for (const slot of slots) parts.push(labelCardRail(slot, p.cardPlay, floorZ));
  const all = unionAll(parts);
  if (!all) return undefined;
  // Keep features inside the cavity so they never poke through rounded corners.
  const clip = prism(roundedRect(cavW + 0.02, cavD + 0.02, Math.max(BASE_TOP_RADIUS - L.wall, 0.25)), floorZ - 0.02, interiorTop + 0.01);
  const features = all.intersect(clip);
  // Keep the insertion path clear of adjacent scoops as well as the channel rails.
  return subtractAll(features, slots.map(slot => labelCardChannel(slot, p.cardPlay, Math.max(interiorTop + 1, slot.bottomZ + 13))));
}

export function buildBin(p: BinParams): Manifold {
  const L = binLayout(p);
  const slots = labelCardSlots(p, L);
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

  const inside = interior(p, L, slots);
  const result = inside ? solid.add(inside) : solid;
  for (const slot of slots) {
    if (Math.abs(labelCardSweep(slot, p.cardPlay, result).intersect(result).volume()) > 1e-7) throw new Error('Compartments too narrow for label cards');
  }
  return result;
}
