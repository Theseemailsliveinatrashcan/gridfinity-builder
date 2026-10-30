import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { defaultPlate, plateLayout, plateHardwareCutters, type PlateParams } from '../src/geometry/baseplate';
import { generate } from '../src/geometry/generate';
import { box, freeAll, initKernel, k, unionAll } from '../src/geometry/kernel';
import { planSplit, tabSolid } from '../src/geometry/split';
import { DEFAULTS } from '../src/state';

beforeAll(async () => { await initKernel(); });
const owned: Manifold[] = [];
afterEach(() => { owned.splice(0).forEach(m => m.delete()); freeAll(); });
const noRoom = 'No room for a dovetail on one or more cuts: glue those seams';
function checkTabs(p: PlateParams, bedX: number, bedY: number, axis: 'x' | 'y') {
  const L = plateLayout(p);
  const spec = (a: typeof L.x) => ({ cells: a.cells, padStart: a.padStart, padEnd: a.padEnd, origin: a.padStart });
  const plan = planSplit(spec(L.x), spec(L.y), bedX, bedY, 5)!;
  const r = generate({ ...DEFAULTS, kind: 'plate', plate: p, print: { ...DEFAULTS.print, split: true, bedX, bedY, clearance: 0.6 } });
  expect(r.pieces.every(piece => piece.fitsBed)).toBe(true);
  const hardware = unionAll(plateHardwareCutters(p));
  const isX = axis === 'x';
  const cuts = isX ? plan.xCuts : plan.yCuts;
  expect(cuts.length).toBeGreaterThan(0);
  let count = 0;
  const found = new Set<number>();
  for (const piece of r.pieces) {
    const indices = piece.name.match(/piece-(\d+)-(\d+)$/)!;
    const cut = cuts[Number(indices[isX ? 1 : 2]) - 1];
    if (cut === undefined) continue;
    const api = k();
    const m = new api.Manifold(new api.Mesh({ numProp: 3, vertProperties: piece.positions, triVerts: piece.indices })); owned.push(m);
    expect(m.status()).toBe('NoError');
    const protrusions = m.intersect(isX
      ? box(cut + 0.001, cut + 5.01, -1, L.y.length + 1, 0, L.bottom)
      : box(-1, L.x.length + 1, cut + 0.001, cut + 5.01, 0, L.bottom));
    for (const tab of protrusions.decompose()) {
      const bb = tab.boundingBox(), v = isX ? 1 : 0;
      const at = (bb.min[v] + bb.max[v]) / 2;
      expect((isX ? L.y.centres : L.x.centres).some(c => Math.abs(c - at) < 1e-4)).toBe(true);
      const slot = tabSolid(isX, cut, at, -1.2, L.bottom + 0.2, 0.6);
      if (hardware) expect(Math.abs(slot.intersect(hardware).volume())).toBeLessThan(1e-9);
      found.add(cut); count++;
    }
  }
  expect(count).toBeGreaterThan(0);
  return { r, found, L };
}

describe('half-cell joint regressions', () => {
  it('puts joints in zero-whole-cell rows of an 84×30 drawer on both axes', () => {
    const p = { ...defaultPlate, halfCells: true, style: 'solid' as const, drawerW: 84, drawerD: 30 };
    const a = checkTabs(p, 60, 40, 'x');
    expect(a.r.pieces).toHaveLength(2);
    expect(a.r.warnings).toEqual([]);
    const b = checkTabs({ ...p, drawerW: 30, drawerD: 84 }, 40, 60, 'y');
    expect(b.r.pieces).toHaveLength(2);
    expect(b.r.warnings).toEqual([]);
  });

  for (const mountHoles of ['none', 'countersink', 'counterbore'] as const) {
    it(`uses leading-half centres and clears magnets/${mountHoles} at maximum clearance`, () => {
      const p = { ...defaultPlate, halfCells: true, style: 'solid' as const, drawerW: 200, drawerD: 200, alignX: 1, alignY: 1, magnets: true, mountHoles };
      const layout = plateLayout(p);
      const oldSlot = tabSolid(true, 32, 32, -1.2, layout.bottom + 0.2, 0.6);
      expect(oldSlot.intersect(unionAll(plateHardwareCutters(p))!).volume()).toBeGreaterThan(0.05);
      const x = checkTabs(p, 60, 220, 'x');
      expect(x.found.has(32)).toBe(true);
      const y = checkTabs(p, 220, 60, 'y');
      expect(y.found.has(32)).toBe(true);
    });
  }

  it('warns and replans flat if no full-width slot fits on any seam', () => {
    const p = { ...defaultPlate, halfCells: true, style: 'solid' as const, drawerW: 126, drawerD: 10 };
    const req = { ...DEFAULTS, kind: 'plate' as const, plate: p, print: { ...DEFAULTS.print, split: true, bedX: 63, bedY: 40, clearance: 0.6 } };
    const r = generate(req), flat = generate({ ...req, print: { ...req.print, connector: 'none' as const } });
    expect(r.warnings).toContain(noRoom);
    expect(r.pieces.map(p => [p.min, p.max])).toEqual(flat.pieces.map(p => [p.min, p.max]));
    expect(r.pieces.every(p => p.fitsBed)).toBe(true);
  });

  it('splits socket-free 600×10 padding into three fitting pieces', () => {
    const p = { ...defaultPlate, halfCells: true, style: 'solid' as const, drawerW: 600, drawerD: 10 };
    expect(plateLayout(p).y.cells).toEqual([]);
    const r = generate({ ...DEFAULTS, kind: 'plate', plate: p, print: { ...DEFAULTS.print, split: true, connector: 'none', bedX: 220, bedY: 220 } });
    expect(r.pieces).toHaveLength(3);
    expect(r.pieces.every(p => p.fitsBed)).toBe(true);
    expect(r.warnings).toEqual([]);
  });
});
