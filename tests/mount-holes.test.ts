import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildPlate, defaultPlate, plateBottom, type PlateParams } from '../src/geometry/baseplate';
import { box, freeAll, initKernel } from '../src/geometry/kernel';
import { generate } from '../src/geometry/generate';
import { DEFAULTS, decodeState, encodeState, sanitize } from '../src/state';

beforeAll(async () => { await initKernel(); });
afterEach(() => freeAll());
const params = (over: Partial<PlateParams> = {}): PlateParams => ({ ...defaultPlate, width: 1, depth: 1, ...over });
const polygonArea = (r: number) => 32 / 2 * r * r * Math.sin(2 * Math.PI / 32);

describe('baseplate screw-down holes', () => {
  for (const mountHoles of ['countersink', 'counterbore'] as const) {
    it(`${mountHoles} makes a manifold with the expected material removed`, () => {
      const p = params({ mountHoles });
      const m = buildPlate(p);
      expect(m.status()).toBe('NoError');
      expect(plateBottom(p)).toBeCloseTo(3.6);
      // The socket layers are identical; account for the uncut bottom analytically.
      const plain = buildPlate(params({ style: 'solid' }));
      const uncutVolume = plain.volume() + (plateBottom(p) - plateBottom(params({ style: 'solid' }))) * plain.slice(0.1).area();
      const bore = polygonArea(1.5) * 3.6;
      const recess = mountHoles === 'counterbore'
        ? (polygonArea(2.75) - polygonArea(1.5)) * 3
        : 2.5 / 3 * (polygonArea(1.5) + polygonArea(4) + Math.sqrt(polygonArea(1.5) * polygonArea(4))) - polygonArea(1.5) * 2.5;
      expect(uncutVolume - m.volume()).toBeCloseTo(bore + recess, 4);
    });
  }

  it('counterbore shoulder has 0.6 mm underneath and opens at the socket floor', () => {
    const m = buildPlate(params({ mountHoles: 'counterbore' }));
    const shoulder = box(23, 23.2, 20.9, 21.1, 0, 0.59);
    expect(m.intersect(shoulder).volume()).toBeCloseTo(shoulder.volume(), 6);
    expect(m.intersect(box(23, 23.2, 20.9, 21.1, 0.61, 3.59)).volume()).toBeLessThan(1e-6);
    // Above the 3.6 mm bottom is already empty socket space, not a suspended head recess.
    expect(m.intersect(box(18.3, 23.7, 18.3, 23.7, 3.6, 3.7)).volume()).toBeLessThan(1e-6);
    expect(m.intersect(box(20.9, 21.1, 20.9, 21.1, 0, 3.6)).volume()).toBeLessThan(1e-6);
  });

  it('weighted plates skip holes and retain their existing bottom and pockets', () => {
    const p = params({ style: 'weighted' });
    const original = buildPlate(p);
    for (const mountHoles of ['countersink', 'counterbore'] as const) {
      const mounted = buildPlate({ ...p, mountHoles });
      expect(plateBottom({ ...p, mountHoles })).toBe(6.4);
      expect(mounted.status()).toBe('NoError');
      expect(mounted.volume()).toBeCloseTo(original.volume(), 6);
    }
  });

  it('mount holes coexist with magnets and split dovetails', () => {
    for (const mountHoles of ['countersink', 'counterbore'] as const) {
      const p = params({ width: 4, depth: 2, magnets: true, mountHoles });
      expect(buildPlate(p).status()).toBe('NoError');
      const r = generate({ ...DEFAULTS, kind: 'plate', plate: p, print: { ...DEFAULTS.print, split: true, bedX: 100, bedY: 100 } });
      expect(r.pieces).toHaveLength(2);
      expect(r.pieces.every(piece => piece.fitsBed)).toBe(true);
      expect(r.warnings).toEqual([]);
    }
  });

  it('sanitizer accepts known mounting styles and rejects invalid values', () => {
    for (const mountHoles of ['none', 'countersink', 'counterbore'] as const) {
      const s = sanitize({ kind: 'plate', plate: { mountHoles } });
      expect(s.plate.mountHoles).toBe(mountHoles);
      expect(decodeState(encodeState(s)).plate.mountHoles).toBe(mountHoles);
    }
    expect(sanitize({ plate: { mountHoles: 'drill-everything' } }).plate.mountHoles).toBe('none');
    expect(sanitize({}).plate.mountHoles).toBe('none');
  });
});
