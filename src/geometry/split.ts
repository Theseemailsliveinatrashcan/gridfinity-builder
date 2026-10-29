import type { Manifold, Vec2 } from 'manifold-3d';
import { box, k } from './kernel';

/**
 * Choose where to cut one axis. Cuts only fall on cell boundaries.
 *
 * cells: length of each cell (mm) in order.
 * padStart / padEnd: solid margin before the first / after the last cell.
 * maxLen: longest piece the bed allows along this axis.
 * tab: how far a connector tab sticks out of the piece on the start side of
 *      each cut (added to every piece except the last).
 *
 * Returns the cell index where each piece starts (always beginning with 0),
 * using the fewest pieces and, among those, the smallest longest piece.
 * Returns undefined if even single cells do not fit.
 */
export function planAxis(
  cells: number[],
  padStart: number,
  padEnd: number,
  maxLen: number,
  tab = 0,
): number[] | undefined {
  const n = cells.length;
  const prefix = [0];
  for (const c of cells) prefix.push(prefix[prefix.length - 1] + c);
  const segLen = (i: number, j: number) =>
    prefix[j] - prefix[i] + (i === 0 ? padStart : 0) + (j === n ? padEnd : tab);

  // best[c][j]: smallest possible longest piece covering cells [0, j) with c pieces.
  const INF = Number.POSITIVE_INFINITY;
  const best: number[][] = Array.from({ length: n + 1 }, () => Array<number>(n + 1).fill(INF));
  const from: number[][] = Array.from({ length: n + 1 }, () => Array<number>(n + 1).fill(-1));
  best[0][0] = 0;
  for (let c = 1; c <= n; c++) {
    for (let j = 1; j <= n; j++) {
      for (let i = c - 1; i < j; i++) {
        if (best[c - 1][i] === INF) continue;
        const len = segLen(i, j);
        if (len > maxLen + 1e-6) continue;
        const m = Math.max(best[c - 1][i], len);
        if (m < best[c][j] - 1e-9) {
          best[c][j] = m;
          from[c][j] = i;
        }
      }
    }
    if (best[c][n] < INF) {
      const starts: number[] = [];
      let j = n;
      for (let cc = c; cc > 0; cc--) {
        const i = from[cc][j];
        starts.unshift(i);
        j = i;
      }
      return starts;
    }
  }
  return undefined;
}

/** Convert piece start indices into interior cut positions (mm). */
export function cutPositions(cells: number[], origin: number, starts: number[]): number[] {
  const cuts: number[] = [];
  let x = origin;
  for (let i = 0; i < cells.length; i++) {
    if (i > 0 && starts.includes(i)) cuts.push(x);
    x += cells[i];
  }
  return cuts;
}

export interface SplitPlan {
  xCuts: number[];
  yCuts: number[];
  /** True if the bed was rotated 90 degrees to need fewer pieces. */
  rotated: boolean;
}

export interface AxisSpec {
  cells: number[];
  padStart: number;
  padEnd: number;
  /** Coordinate of the start of the first cell. */
  origin: number;
}

export function planSplit(x: AxisSpec, y: AxisSpec, bedX: number, bedY: number, tab = 0): SplitPlan | undefined {
  const tryBed = (bx: number, by: number) => {
    const sx = planAxis(x.cells, x.padStart, x.padEnd, bx, tab);
    const sy = planAxis(y.cells, y.padStart, y.padEnd, by, tab);
    if (!sx || !sy) return undefined;
    return { sx, sy, count: sx.length * sy.length };
  };
  const a = tryBed(bedX, bedY);
  const b = bedX !== bedY ? tryBed(bedY, bedX) : undefined;
  const pick = a && b ? (b.count < a.count ? b : a) : a ?? b;
  if (!pick) return undefined;
  return {
    xCuts: cutPositions(x.cells, x.origin, pick.sx),
    yCuts: cutPositions(y.cells, y.origin, pick.sy),
    rotated: pick === b,
  };
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface Connector {
  /** Dovetail tabs live in z from 0 to height. 0 disables connectors. */
  height: number;
  /** Gap per side between tab and slot. */
  clearance: number;
  /** Positions along each cut line where a tab goes, per axis. */
  xTabAt: number[]; // y-positions of tabs on cuts perpendicular to X
  yTabAt: number[]; // x-positions of tabs on cuts perpendicular to Y
}

export const DOVETAIL_DEPTH = 5;
const DOVETAIL_NECK = 7;
const DOVETAIL_HEAD = 11;

/** Dovetail outline pointing +u from the cut at u = 0, centred at v = 0. */
function dovetail(clearance: number): Vec2[] {
  const c = clearance;
  return [
    [-0.01 - c, -DOVETAIL_NECK / 2 - c],
    [DOVETAIL_DEPTH + c, -DOVETAIL_HEAD / 2 - c],
    [DOVETAIL_DEPTH + c, DOVETAIL_HEAD / 2 + c],
    [-0.01 - c, DOVETAIL_NECK / 2 + c],
  ];
}

function tabSolid(axisIsX: boolean, cut: number, at: number, z1: number, clearance: number): Manifold {
  const pts = dovetail(clearance).map(([u, v]) => (axisIsX ? [cut + u, at + v] : [at - v, cut + u]) as Vec2);
  // keep CCW: the Y mapping is a rotation, the X mapping is identity.
  return k().CrossSection.ofPolygons([pts]).extrude(z1 + 1).translate([0, 0, -1]);
}

export interface Piece {
  name: string;
  part: Manifold;
  ix: number;
  iy: number;
}

/**
 * Cut `part` along the planned lines. With a connector, the piece before each
 * cut gets dovetail tabs in the bottom layer and the piece after gets slots.
 */
export function splitPart(part: Manifold, plan: SplitPlan, connector?: Connector): Piece[] {
  const bb = part.boundingBox();
  const big = 1;
  const xs = [bb.min[0] - big, ...plan.xCuts, bb.max[0] + big];
  const ys = [bb.min[1] - big, ...plan.yCuts, bb.max[1] + big];
  const z0 = bb.min[2] - big;
  const z1 = bb.max[2] + big;
  const pieces: Piece[] = [];
  const useTabs = !!connector && connector.height > 0;

  for (let i = 0; i + 1 < xs.length; i++) {
    for (let j = 0; j + 1 < ys.length; j++) {
      let region = box(xs[i], xs[i + 1], ys[j], ys[j + 1], z0, z1);
      if (useTabs && connector) {
        const h = connector.height;
        const adds: Manifold[] = [];
        const subs: Manifold[] = [];
        // Cut at the end of this piece in X: add tabs (within this piece's Y range).
        const inY = (v: number) => v > ys[j] && v < ys[j + 1];
        const inX = (v: number) => v > xs[i] && v < xs[i + 1];
        if (i + 1 < xs.length - 1) {
          for (const at of connector.xTabAt.filter(inY)) adds.push(tabSolid(true, xs[i + 1], at, h, 0));
        }
        if (i > 0) {
          for (const at of connector.xTabAt.filter(inY)) subs.push(tabSolid(true, xs[i], at, h + 0.2, connector.clearance));
        }
        if (j + 1 < ys.length - 1) {
          for (const at of connector.yTabAt.filter(inX)) adds.push(tabSolid(false, ys[j + 1], at, h, 0));
        }
        if (j > 0) {
          for (const at of connector.yTabAt.filter(inX)) subs.push(tabSolid(false, ys[j], at, h + 0.2, connector.clearance));
        }
        if (adds.length) region = region.add(k().Manifold.union(adds).intersect(box(-1e5, 1e5, -1e5, 1e5, -1e5, h)));
        if (subs.length) region = region.subtract(k().Manifold.union(subs));
      }
      const piece = part.intersect(region);
      if (piece.isEmpty()) continue;
      pieces.push({ name: `piece-${i + 1}-${j + 1}`, part: piece, ix: i, iy: j });
    }
  }
  return pieces;
}
