import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildPlate, defaultPlate, plateLayout } from '../src/geometry/baseplate';
import { buildBin, defaultBin } from '../src/geometry/bin';
import { freeAll, initKernel } from '../src/geometry/kernel';
import { planSplit } from '../src/geometry/split';
import { DEFAULTS, sanitize } from '../src/state';
import { generate } from '../src/geometry/generate';

beforeAll(async () => { await initKernel(); });
afterEach(() => freeAll());
const p = { ...defaultPlate, drawerW: 200, drawerD: 100, halfCells: true };
describe('drawer half-cell fill', () => {
  it('fits 4 whole plus a half column and 2 rows in a 200×100 drawer', () => {
    const L = plateLayout(p), m = buildPlate(p);
    expect(L.x.cells).toEqual([42, 42, 42, 42, 21]);
    expect(L.y.cells).toEqual([42, 42]);
    expect(L.x.padStart + L.x.padEnd).toBeCloseTo(11);
    expect(m.status()).toBe('NoError');
    expect(m.genus()).toBe(10);
    expect(m.boundingBox().max).toEqual([200, 100, 5]);
    expect(buildPlate({ ...p, halfCells: false }).genus()).toBe(8);
  });
  it('respects either padding side and makes half-by-half corner sockets', () => {
    for (const align of [-1, 0, 1]) {
      const L = plateLayout({ ...p, drawerD: 200, alignX: align, alignY: align });
      expect(L.x.cells[align > 0 ? 0 : L.x.cells.length - 1]).toBe(21);
      expect(L.x.centres.length).toBe(5);
      const m = buildPlate({ ...p, drawerD: 200, alignX: align, alignY: align });
      expect(m.status()).toBe('NoError');
      expect(m.genus()).toBe(25);
    }
  });
  it('accepts a half-unit bin with zero overlap', () => {
    const L = plateLayout(p);
    const x = L.x.centres[L.x.centres.length - 1], y = L.y.centres[0];
    const b = buildBin({ ...defaultBin, width: 0.5, depth: 1 });
    expect(b.translate([x, y, 0.25]).intersect(buildPlate(p)).volume()).toBeLessThan(1e-6);
  });
  it('uses 21 mm boundaries when splitting and keeps pieces on the bed', () => {
    const params = { ...p, alignX: 1 };
    const L = plateLayout(params);
    const axis = (a: typeof L.x) => ({ cells: a.cells, padStart: a.padStart, padEnd: a.padEnd, origin: a.padStart });
    const plan = planSplit(axis(L.x), axis(L.y), 60, 100)!;
    expect(plan.xCuts).toContain(L.x.padStart + 21);
    const boundaries = L.x.cells.slice(0, -1).map((_, i) => L.x.padStart + L.x.cells.slice(0, i + 1).reduce((a, b) => a + b, 0));
    expect(plan.xCuts.every(cut => boundaries.includes(cut))).toBe(true);
    const r = generate({ ...DEFAULTS, kind: 'plate', plate: params, print: { ...DEFAULTS.print, split: true, connector: 'none', bedX: 60, bedY: 100 } });
    expect(r.pieces.every(piece => piece.fitsBed)).toBe(true);
  });
  it('keeps magnets and weights out of half cells while allowing central mount holes', () => {
    for (const style of ['solid', 'weighted'] as const) {
      const params = { ...p, style, magnets: true, mountHoles: 'counterbore' as const };
      expect(buildPlate(params).status()).toBe('NoError');
    }
    expect(sanitize({ plate: { halfCells: true } }).plate.halfCells).toBe(true);
    expect(plateLayout({ ...defaultPlate, halfCells: true }).x.cells).toEqual([42, 42, 42]);
    expect(plateLayout({ ...p, drawerW: 30 }).x.cells).toEqual([21]);
  });
});
