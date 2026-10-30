import type { CrossSection, Manifold } from 'manifold-3d';
import { binLayout, type BinParams } from './bin';
import { LIP_DEPTH } from './constants';
import { box, extrudeAlongX, k, prism, subtractAll } from './kernel';

export function dividerLayout(p: BinParams) {
  const L = binLayout(p);
  const active = !p.vase && !p.solid && p.removableDividers !== 'none';
  if (active && p.labelSlot !== 'none') throw new Error("Removable dividers can't be combined with label cards or sockets yet.");
  if (active && (![p.dividerCountX, p.dividerCountY].every(n => Number.isInteger(n) && n >= 1 && n <= 10))) throw new Error('Divider counts must be integers from 1 to 10.');
  if (active && (p.slotPitch < 4 || p.slotPitch > 20 || p.slotWidth <= p.dividerThickness || p.slotWidth >= p.slotPitch)) throw new Error('Divider slots need pitch 4–20 mm and width greater than the plate thickness but less than the pitch.');
  const margin = Math.max(3.75 - L.wall, 0) + p.slotWidth / 2 + 0.8;
  const positions = (span: number) => {
    const n = Math.floor((span / 2 - margin) / p.slotPitch);
    return n < 0 ? [] : Array.from({ length: n * 2 + 1 }, (_, i) => (i - n) * p.slotPitch);
  };
  const inset = p.lip === 'normal' ? Math.max(0, LIP_DEPTH - L.wall) : 0;
  const ribDepth = inset + 0.3 + 0.3 + 1.5; // end clearance + axial travel + engagement
  if (active && ribDepth > (Math.min(L.cavW, L.cavD) - 8) / 2) throw new Error('Bin too small for securely captured removable dividers.');
  const x = active && ['x', 'both'].includes(p.removableDividers) ? positions(L.cavD) : [];
  const y = active && ['y', 'both'].includes(p.removableDividers) ? positions(L.cavW) : [];
  const installed = (slots: number[], count: number) => {
    if (!slots.length) return [];
    if (count > slots.length) throw new Error('Not enough guide slots for the requested divider count.');
    const end = slots[slots.length - 1], pairs = Math.floor(count / 2);
    const positive: number[] = [];
    let previous = 0;
    for (let i = 0; i < pairs; i++) {
      const target = end * (count % 2 ? 2 * (i + 1) : 2 * i + 1) / (count + 1);
      const index = Math.max(previous + 1, Math.min(Math.round(end / p.slotPitch) - (pairs - i - 1), Math.round(target / p.slotPitch)));
      positive.push(index * p.slotPitch); previous = index;
    }
    return [...positive.slice().reverse().map(at => -at), ...(count % 2 ? [0] : []), ...positive];
  };
  return { L, x, y, installX: installed(x, p.dividerCountX), installY: installed(y, p.dividerCountY), ribDepth,
    spanX: L.cavW - 2 * inset - 0.6, spanY: L.cavD - 2 * inset - 0.6,
    height: L.interiorTop - L.floorZ - 0.1 };
}

export function addDividerRails(part: Manifold, p: BinParams): Manifold {
  const d = dividerLayout(p);
  if (!d.x.length && !d.y.length) return part;
  const clearInterior = p.compartmentsX > 1 || p.compartmentsY > 1 || p.scoop > 0 || p.tab !== 'none';
  const ribs: CrossSection[] = [], channels: CrossSection[] = [], slots: Manifold[] = [];
  for (const axis of ['x', 'y'] as const) for (const at of d[axis]) {
    const width = axis === 'x' ? d.L.cavW : d.L.cavD;
    const orient = (m: Manifold) => axis === 'x' ? m : m.rotate([0, 0, 90]);
    const outline = (cs: CrossSection) => axis === 'x' ? cs : cs.rotate(90);
    for (const end of [-1, 1]) for (const side of [-1, 1]) {
      const x0 = end < 0 ? -width / 2 - 0.01 : width / 2 - d.ribDepth;
      const y0 = at + (side < 0 ? -p.slotWidth / 2 - 0.8 : p.slotWidth / 2);
      ribs.push(outline(k().CrossSection.square([d.ribDepth + 0.01, 0.8]).translate([x0, y0])));
      if (p.removableDividers === 'both' && (axis === 'x' ? d.installX : d.installY).includes(at)) {
        const inner = end < 0 ? -width / 2 + d.ribDepth : width / 2 - d.ribDepth;
        const start = end < 0 ? inner - 0.5 : inner - 0.01;
        slots.push(orient(extrudeAlongX([[y0, d.L.interiorTop + 0.01], [y0 + 0.4, d.L.interiorTop - 0.5], [y0 + 0.8, d.L.interiorTop + 0.01]], start, start + 0.51)));
      }
    }
    // Clear the drop-in route through any crossing fixed dividers or scoops.
    if (clearInterior) channels.push(outline(k().CrossSection.square([width - 0.02, p.slotWidth]).translate([-width / 2 + 0.01, at - p.slotWidth / 2])));
  }
  const guides = prism(k().CrossSection.union(ribs), d.L.floorZ - 0.01, d.L.interiorTop);
  if (channels.length) slots.push(prism(k().CrossSection.union(channels), d.L.floorZ, d.L.interiorTop + 0.01));
  return subtractAll(part.add(guides), slots);
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
    for (const centre of axis === 'x' ? d.installY : d.installX) plate = plate.subtract(box(centre - gap / 2, centre + gap / 2, -t, t, axis === 'x' ? h / 2 : -1, axis === 'x' ? h + 1 : h / 2 + 0.05));
  }
  return axis === 'x' ? plate.translate([0, at, d.L.floorZ]) : plate.rotate([0, 0, 90]).translate([at, 0, d.L.floorZ]);
}

export function printableDivider(p: BinParams, axis: 'x' | 'y'): Manifold {
  let plate = buildDivider(p, axis).translate([0, 0, -binLayout(p).floorZ]);
  if (axis === 'y') plate = plate.rotate([0, 0, -90]);
  return plate.warp(v => { const y = v[1]; v[1] = v[2]; v[2] = p.dividerThickness / 2 - y; });
}
