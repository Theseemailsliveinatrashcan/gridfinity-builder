import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildBin } from '../src/geometry/bin';
import { DEFAULTS } from '../src/state';
import { generate, type GenerateRequest, type MeshOut } from '../src/geometry/generate';
import { box, cylinderAt, freeAll, initKernel, k } from '../src/geometry/kernel';
import { tabSolid } from '../src/geometry/split';
import { SECTIONS } from '../src/fields';

beforeAll(async () => { await initKernel(); });
const owned: Manifold[] = [];
afterEach(() => { owned.splice(0).forEach(m => m.delete()); freeAll(); });
const request = (over: Partial<GenerateRequest> = {}): GenerateRequest => ({
  ...structuredClone(DEFAULTS),
  bin: { ...DEFAULTS.bin, width: 6, depth: 2, height: 3 },
  print: { ...DEFAULTS.print, split: true, connector: 'dovetail', bedX: 180, bedY: 180 },
  ...over,
});
function solid(mesh: MeshOut): Manifold {
  const api = k();
  const m = new api.Manifold(new api.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  owned.push(m);
  expect(m.status()).toBe('NoError');
  return m;
}
const glue = 'Dovetails align the floor; glue the wall seams for strength.';
const noRoom = 'No room for a dovetail on one or more cuts: glue those seams';
function pieces(req: GenerateRequest) {
  const r = generate(req);
  expect(r.pieces.every(p => p.fitsBed)).toBe(true);
  const ms = r.pieces.map(solid);
  for (let i = 0; i < ms.length; i++) for (let j = i + 1; j < ms.length; j++) {
    expect(Math.abs(ms[i].intersect(ms[j]).volume())).toBeLessThan(1e-6);
  }
  return { r, ms };
}

describe('bin and lid dovetails', () => {
  it('splits 6×2×3 into two pieces with 5 mm tabs only in the floor bridge', () => {
    const { r, ms: [a, b] } = pieces(request());
    expect(r.pieces).toHaveLength(2);
    expect(r.warnings).toEqual([glue]);
    expect(a.boundingBox().max[0]).toBeCloseTo(5, 5);
    expect(b.boundingBox().min[0]).toBeCloseTo(0, 5);
    const tabs = a.intersect(box(0.001, 6, -50, 50, -1, 30));
    expect(tabs.volume()).toBeGreaterThan(0);
    expect(tabs.boundingBox().min[2]).toBeCloseTo(4.75, 5);
    expect(tabs.boundingBox().max[2]).toBeCloseTo(7, 5);
    // The receiving slot is open above the floor, permitting vertical assembly.
    expect(b.intersect(tabSolid(true, 0, -21, 7.05, 30, 0.2)).volume()).toBeLessThan(1e-6);
  });

  it('moves a tab away from a compartmentsX divider on a Y cut', () => {
    const req = request({ bin: { ...DEFAULTS.bin, width: 2, depth: 6, height: 3, compartmentsX: 4 } });
    const { r, ms: [a] } = pieces(req);
    expect(r.warnings).toEqual([glue]);
    const tabs = a.intersect(box(-50, 50, 0.001, 6, 4.75, 7));
    expect(tabs.volume()).toBeGreaterThan(0);
    // Centre candidate at x = -21 is obstructed; first offset is -31.5.
    expect(tabs.intersect(box(-32, -31, 4, 4.5, 5, 6)).volume()).toBeGreaterThan(0);
    expect(tabs.intersect(box(-22, -20, 4, 4.5, 5, 6)).volume()).toBeLessThan(1e-6);
  });

  it('solid bins fall back when their insertion columns are blocked', () => {
    const { r, ms: [a] } = pieces(request({ bin: { ...DEFAULTS.bin, width: 6, depth: 2, height: 3, solid: true } }));
    expect(r.warnings).toContain(noRoom);
    expect(r.warnings).not.toContain(glue);
    expect(a.boundingBox().max[0]).toBeCloseTo(0, 5);
  });

  it('thin floors and explicitly flat joints keep flat seams', () => {
    const thin = request({ bin: { ...DEFAULTS.bin, width: 6, depth: 2, height: 3, floor: 0.8 } });
    const { r, ms: [a] } = pieces(thin);
    expect(r.warnings).toContain('Floor too thin for dovetails (needs 1.5 mm); pieces join flat');
    expect(a.boundingBox().max[0]).toBeCloseTo(0, 5);
    const flat = request(); flat.print.connector = 'none';
    expect(pieces(flat).r.warnings).toEqual(['Split bins and lids join with flat faces: glue the pieces together.']);
  });

  it('flat lids get tabs; socket rims obstruct stackable lid insertion', () => {
    const req = request({ kind: 'lid', lid: { ...DEFAULTS.lid, width: 6, depth: 2 } });
    const { r, ms: [a] } = pieces(req);
    expect(r.warnings).toEqual([glue]);
    expect(a.boundingBox().max[0]).toBeCloseTo(5, 5);
    const stack = pieces({ ...req, lid: { ...req.lid, style: 'stackable' } });
    expect(stack.r.warnings).toContain(noRoom);
  });

  it('tabs and clearance slots stay clear of magnet and screw bores', () => {
    const req = request({ bin: { ...DEFAULTS.bin, width: 6, depth: 2, height: 3, magnets: true, screws: true } });
    const { r } = pieces(req);
    expect(r.warnings).toEqual([glue]);
    for (const at of [-21, 21]) {
      // Test complete prospective tab/slot solids, not just material left after drilling.
      for (const clearance of [0, 0.6]) {
        const tab = tabSolid(true, 0, at, 4.55, 7.2, clearance);
        for (const x of [-8, 8]) for (const y of [at - 13, at + 13]) {
          expect(tab.intersect(cylinderAt(x, y, -1, 2.4, 3.25)).volume()).toBeLessThan(1e-6);
          expect(tab.intersect(cylinderAt(x, y, -1, 6, 1.5)).volume()).toBeLessThan(1e-6);
        }
      }
    }
  });

  it('handles both cut axes, half cells, and maximum clearance', () => {
    const req = request({ bin: { ...DEFAULTS.bin, width: 4.5, depth: 4.5, height: 3 } });
    req.print = { ...req.print, bedX: 100, bedY: 100, clearance: 0.6 };
    const { r } = pieces(req);
    expect(r.pieces.length).toBeGreaterThan(2);
    expect(r.warnings).toEqual([glue]);
  });

  it('checks every clearance-expanded insertion column on X and Y offset tabs', () => {
    const clearance = SECTIONS.flatMap(s => s.fields).find(f => f.key === 'clearance')!.max!;
    for (const axis of ['x', 'y'] as const) {
      const isX = axis === 'x';
      const req = request({ bin: { ...DEFAULTS.bin, width: isX ? 6 : 2, depth: isX ? 2 : 6, height: 6,
        compartmentsX: isX ? 1 : 4, compartmentsY: isX ? 4 : 1 } });
      req.print.clearance = clearance;
      const { r, ms: [a] } = pieces(req);
      expect(r.warnings).toContain(glue);
      const tabs = a.intersect(isX ? box(0.001, 6, -50, 50, 4.75, 7) : box(-50, 50, 0.001, 6, 4.75, 7)).decompose();
      expect(tabs.length).toBeGreaterThan(0);
      const original = buildBin(req.bin);
      const centres = tabs.map(tab => {
        const bb = tab.boundingBox();
        const v = isX ? 1 : 0;
        return (bb.min[v] + bb.max[v]) / 2;
      });
      expect(centres.some(at => Math.abs(Math.abs(at) - 21) > 1)).toBe(true);
      for (const at of centres) {
        const column = tabSolid(isX, 0, at, 7.05, original.boundingBox().max[2] + 1, clearance);
        expect(column.intersect(original).volume()).toBeLessThan(0.01);
      }
    }
  });

  for (const [width, depth, bedX, bedY] of [[6, 2, 126, 100], [2, 1, 42, 42]]) {
    it(`replans blocked ${width}×${depth} bins flat on a ${bedX}×${bedY} bed`, () => {
      const req = request({ bin: { ...DEFAULTS.bin, width, depth, height: 3, solid: true } });
      req.print = { ...req.print, bedX, bedY };
      const { r } = pieces(req);
      const flat = generate({ ...req, print: { ...req.print, connector: 'none' } });
      expect(r.pieces).toHaveLength(2);
      expect(r.pieces.map(p => [p.min, p.max])).toEqual(flat.pieces.map(p => [p.min, p.max]));
      expect(r.warnings).toContain(width === 6 ? noRoom : 'Dovetails need 5 mm of extra room per piece; this bed only fits flat joints');
      expect(r.warnings).not.toContain(glue);
      expect(r.warnings.some(w => w.includes('single grid cell'))).toBe(false);
    });
  }

  it('keeps the tab-reserving plan when some cuts have tabs', () => {
    const req = request({ bin: { ...DEFAULTS.bin, width: 6, depth: 2, height: 6, scoop: 1 } });
    req.print = { ...req.print, bedX: 126, bedY: 100 };
    const { r } = pieces(req);
    expect(r.pieces).toHaveLength(3);
    expect(r.warnings).toContain(glue);
    expect(generate({ ...req, print: { ...req.print, connector: 'none' } }).pieces).toHaveLength(2);
  });

  it('replans blocked stackable lids with the flat piece count', () => {
    const req = request({ kind: 'lid', lid: { ...DEFAULTS.lid, width: 6, depth: 2, style: 'stackable' } });
    req.print = { ...req.print, bedX: 126, bedY: 100 };
    const { r } = pieces(req);
    expect(r.pieces).toHaveLength(2);
    expect(r.warnings).toContain(noRoom);
  });

  it('exposes joint settings for bins/lids/plates and hides them for tiles', () => {
    const fields = SECTIONS.find(s => s.title === 'Print bed')!.fields;
    for (const kind of ['bin', 'lid', 'plate', 'tile'] as const) {
      const req = request({ kind });
      for (const key of ['connector', 'clearance']) expect(fields.find(f => f.key === key)!.show!(req)).toBe(kind !== 'tile');
    }
  });
});
