import type { Manifold } from 'manifold-3d';
import { binLayout, type BinParams } from './bin';
import { LIP_DEPTH } from './constants';
import { box, k, subtractAll } from './kernel';

export function dividerLayout(p: BinParams) {
  const L = binLayout(p);
  const active = !p.vase && !p.solid && p.removableDividers !== 'none';
  if (active && (p.slotPitch < 4 || p.slotPitch > 20 || p.slotWidth <= p.dividerThickness || p.slotWidth >= p.slotPitch)) throw new Error('Divider slots need pitch 4–20 mm and width greater than the plate thickness but less than the pitch.');
  const margin = Math.max(3.75 - L.wall, 0) + p.slotWidth / 2 + 0.8;
  const positions = (span: number) => {
    const n = Math.floor((span / 2 - margin) / p.slotPitch);
    return n < 0 ? [] : Array.from({ length: n * 2 + 1 }, (_, i) => (i - n) * p.slotPitch);
  };
  const inset = p.lip === 'normal' ? Math.max(0, LIP_DEPTH - L.wall) : 0;
  return { L, x: active && ['x', 'both'].includes(p.removableDividers) ? positions(L.cavD) : [],
    y: active && ['y', 'both'].includes(p.removableDividers) ? positions(L.cavW) : [],
    spanX: L.cavW - 2 * inset - 0.3, spanY: L.cavD - 2 * inset - 0.3,
    height: L.interiorTop - L.floorZ - 0.1 };
}

export function addDividerRails(part: Manifold, p: BinParams): Manifold {
  const d = dividerLayout(p);
  if (!d.x.length && !d.y.length) return part;
  const ribs: Manifold[] = [], slots: Manifold[] = [];
  for (const axis of ['x', 'y'] as const) for (const at of d[axis]) {
    const width = axis === 'x' ? d.L.cavW : d.L.cavD;
    const orient = (m: Manifold) => axis === 'x' ? m : m.rotate([0, 0, 90]);
    for (const end of [-1, 1]) for (const side of [-1, 1]) {
      const x0 = end < 0 ? -width / 2 - 0.01 : width / 2 - 2;
      const y0 = at + (side < 0 ? -p.slotWidth / 2 - 0.8 : p.slotWidth / 2);
      ribs.push(orient(box(x0, x0 + 2.01, y0, y0 + 0.8, d.L.floorZ - 0.01, d.L.interiorTop)));
    }
    // Clear the drop-in route through any crossing fixed dividers or scoops.
    slots.push(orient(box(-width / 2 + 0.01, width / 2 - 0.01, at - p.slotWidth / 2, at + p.slotWidth / 2, d.L.floorZ, d.L.interiorTop + 0.01)));
  }
  return subtractAll(part.add(k().Manifold.union(ribs)), slots);
}

/** Plate in assembly coordinates at slot 0; optional offset selects another slot. */
export function buildDivider(p: BinParams, axis: 'x' | 'y', at = 0): Manifold {
  const d = dividerLayout(p), span = axis === 'x' ? d.spanX : d.spanY;
  const t = p.dividerThickness, h = d.height;
  if (span < 4 || h < 2) throw new Error('Bin too small for a removable divider.');
  let plate = box(-span / 2, span / 2, -t / 2, t / 2, 0, h);
  const notch = k().Manifold.cylinder(t + 2, Math.min(5, span / 6), Math.min(5, span / 6), 32).rotate([90, 0, 0]).translate([0, t / 2 + 1, h]);
  plate = plate.subtract(notch);
  if (p.removableDividers === 'both') {
    const gap = t + 0.3;
    plate = plate.subtract(box(-gap / 2, gap / 2, -t, t, axis === 'x' ? h / 2 : -1, axis === 'x' ? h + 1 : h / 2 + 0.05));
  }
  return axis === 'x' ? plate.translate([0, at, d.L.floorZ]) : plate.rotate([0, 0, 90]).translate([-at, 0, d.L.floorZ]);
}

export function printableDivider(p: BinParams, axis: 'x' | 'y'): Manifold {
  let plate = buildDivider(p, axis).translate([0, 0, -binLayout(p).floorZ]);
  if (axis === 'y') plate = plate.rotate([0, 0, -90]);
  return plate.warp(v => { const y = v[1]; v[1] = v[2]; v[2] = p.dividerThickness / 2 - y; });
}
