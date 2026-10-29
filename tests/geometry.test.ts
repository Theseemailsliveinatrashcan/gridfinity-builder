import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildBin, defaultBin, type BinParams } from '../src/geometry/bin';
import { buildPlate, defaultPlate, type PlateParams } from '../src/geometry/baseplate';
import { generate, type GenerateRequest } from '../src/geometry/generate';
import { freeAll, initKernel } from '../src/geometry/kernel';
import { buildTile, defaultTile } from '../src/geometry/multiboard';
import { planAxis } from '../src/geometry/split';

beforeAll(async () => {
  await initKernel();
});
afterEach(() => freeAll());

const bin = (over: Partial<BinParams> = {}) => buildBin({ ...defaultBin, ...over });
const plate = (over: Partial<PlateParams> = {}) => buildPlate({ ...defaultPlate, ...over });
const size = (m: ReturnType<typeof bin>) => {
  const b = m.boundingBox();
  return b.max.map((v, i) => +(v - b.min[i]).toFixed(3));
};

describe('bins', () => {
  it('1x1x3 plain bin has Gridfinity outer dimensions', () => {
    const m = bin({ width: 1, depth: 1, height: 3 });
    expect(m.status()).toBe('NoError');
    expect(m.genus()).toBe(0);
    // 41.5 footprint; 21 mm body + 3.8 mm printed lip
    expect(size(m)).toEqual([41.5, 41.5, 24.8]);
  });

  it('no-lip bin is exactly height * 7', () => {
    expect(size(bin({ width: 2, depth: 1, height: 6, lip: 'none' }))).toEqual([83.5, 41.5, 42]);
  });

  it('half-unit bins work', () => {
    const m = bin({ width: 1.5, depth: 0.5, height: 4 });
    expect(m.status()).toBe('NoError');
    expect(size(m).slice(0, 2)).toEqual([62.5, 20.5]);
  });

  it('all features together stay manifold', () => {
    const m = bin({
      width: 3, depth: 2, height: 6, compartmentsX: 3, compartmentsY: 2,
      tab: 'left', scoop: 1, magnets: true, screws: true,
    });
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(0);
  });

  it('magnet holes remove material', () => {
    const a = bin({ width: 1, depth: 1, height: 3 }).volume();
    const b = bin({ width: 1, depth: 1, height: 3, magnets: true }).volume();
    const pocket = Math.PI * 3.25 ** 2 * 2.4;
    expect(a - b).toBeGreaterThan(4 * pocket * 0.95);
    expect(a - b).toBeLessThan(4 * pocket * 1.05);
  });

  it('solid bins are heavier than hollow ones', () => {
    expect(bin({ solid: true }).volume()).toBeGreaterThan(bin().volume() * 2);
  });
});

describe('baseplates', () => {
  it('thin plate is 5 mm tall, 42 mm per unit, open frame', () => {
    const m = plate({ width: 2, depth: 3 });
    expect(m.status()).toBe('NoError');
    expect(size(m)).toEqual([84, 126, 5]);
    expect(m.genus()).toBe(6); // one through-opening per cell
  });

  it('weighted and magnet plates', () => {
    expect(size(plate({ width: 1, depth: 1, style: 'weighted', magnets: true }))[2]).toBe(11.4);
    expect(size(plate({ width: 1, depth: 1, magnets: true }))[2]).toBe(8.2);
  });

  it('fit to drawer pads the leftover space', () => {
    expect(size(plate({ drawerW: 200, drawerD: 100, alignX: -1 })).slice(0, 2)).toEqual([200, 100]);
  });
});

describe('splitting', () => {
  it('balances pieces (7 cells on a 5-cell bed gives 4 + 3)', () => {
    const starts = planAxis(Array(7).fill(42), 0, 0, 5 * 42);
    expect(starts?.length).toBe(2);
    const [, cut] = starts!;
    expect([cut, 7 - cut].sort()).toEqual([3, 4]);
  });

  it('counts connector tabs and padding', () => {
    // 4 cells + 10 mm pad each side, 5 mm tabs: 10+84+5 = 99 fits 100 but not 98
    expect(planAxis(Array(4).fill(42), 10, 10, 100, 5)?.length).toBe(2);
    expect(planAxis(Array(4).fill(42), 10, 10, 98, 5)?.length).toBe(3);
  });

  it('returns undefined when one cell is wider than the bed', () => {
    expect(planAxis([42], 0, 0, 40)).toBeUndefined();
  });

  const req = (over: Partial<GenerateRequest>): GenerateRequest => ({
    kind: 'plate',
    bin: defaultBin,
    plate: defaultPlate,
    tile: defaultTile,
    print: { split: true, bedX: 180, bedY: 180, connector: 'dovetail', clearance: 0.2 },
    ...over,
  });

  it('splits a 6x6 dovetail plate into 4 pieces that fit the bed', () => {
    const r = generate(req({ plate: { ...defaultPlate, width: 6, depth: 6, style: 'solid' } }));
    expect(r.pieces.length).toBe(4);
    expect(r.pieces.every((p) => p.fitsBed)).toBe(true);
  });

  it('first dovetail piece carries tabs past the cut', () => {
    const p = { ...defaultPlate, width: 4, depth: 2, style: 'solid' as const };
    const r = generate(req({ plate: p, print: { split: true, bedX: 100, bedY: 100, connector: 'dovetail', clearance: 0.2 } }));
    expect(r.pieces.length).toBe(2);
    expect(r.warnings).toEqual([]);
    expect(r.pieces[0].max[0]).toBeCloseTo(84 + 5, 3);
    expect(r.pieces[1].min[0]).toBeCloseTo(84, 3);
  });

  it('splits a large bin', () => {
    const r = generate(req({ kind: 'bin', bin: { ...defaultBin, width: 6, depth: 2, height: 3 } }));
    expect(r.pieces.length).toBe(2);
    expect(r.pieces.every((p) => p.fitsBed)).toBe(true);
  });
});

describe('multiboard-compatible tile', () => {
  it('builds a 4x4 tile', () => {
    const m = buildTile(defaultTile);
    expect(m.status()).toBe('NoError');
    expect(size(m)).toEqual([100, 100, 6.4]);
    expect(m.genus()).toBe(16 + 9);
  });
});

describe('dovetail fit', () => {
  it('pieces interlock with a gap and never overlap', async () => {
    const { splitPart } = await import('../src/geometry/split');
    const part = buildPlate({ ...defaultPlate, width: 2, depth: 1, style: 'solid' });
    const pieces = splitPart(part, { xCuts: [42], yCuts: [], rotated: false }, {
      height: 3.2, clearance: 0.2, xTabAt: [21], yTabAt: [],
    });
    expect(pieces.length).toBe(2);
    const [a, b] = pieces.map((p) => p.part);
    expect(a.intersect(b).volume()).toBeLessThan(1e-6);
    const lost = part.volume() - a.volume() - b.volume();
    expect(lost).toBeGreaterThan(0); // clearance gap
    // 0.2 mm side gap (~14 mm³) plus 0.2 mm headroom under the frame (~5 mm³)
    expect(lost).toBeLessThan(25);
  });
});

describe('asymmetric bed', () => {
  it('uses the bed turned 90 degrees when that needs fewer pieces', async () => {
    const { planSplit } = await import('../src/geometry/split');
    // 2 x 6 units (84 x 252 mm) on a 260 x 100 bed: needs the long side along the bed's long side.
    const axis = (n: number) => ({ cells: Array(n).fill(42), padStart: 0, padEnd: 0, origin: 0 });
    const plan = planSplit(axis(2), axis(6), 260, 100);
    expect(plan?.rotated).toBe(true);
    expect((plan!.xCuts.length + 1) * (plan!.yCuts.length + 1)).toBe(1);
  });
});

describe('internal depth', () => {
  it('gives exactly the requested usable depth', async () => {
    const { binLayout } = await import('../src/geometry/bin');
    for (const lip of ['normal', 'none'] as const) {
      const L = binLayout({ ...defaultBin, lip, heightMode: 'internal', internalDepth: 33 });
      expect(L.interiorTop - L.floorZ).toBeCloseTo(33, 6);
    }
    const m = bin({ width: 1, depth: 1, lip: 'none', heightMode: 'internal', internalDepth: 30 });
    expect(m.status()).toBe('NoError');
    expect(size(m)[2]).toBeCloseTo(4.75 + 2.25 + 30, 3);
  });

  it('units mode is unchanged by the new option', () => {
    expect(size(bin({ width: 1, depth: 1, height: 3, internalDepth: 99 }))).toEqual([41.5, 41.5, 24.8]);
  });
});
