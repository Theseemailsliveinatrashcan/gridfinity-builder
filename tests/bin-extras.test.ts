import { displayMeshes } from '../src/geometry/transforms';
import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { binLayout, buildBin, defaultBin } from '../src/geometry/bin';
import { box, freeAll, initKernel, k } from '../src/geometry/kernel';
import { generate, type MeshOut } from '../src/geometry/generate';
import { DEFAULTS, sanitize } from '../src/state';

beforeAll(async () => { await initKernel(); });
const owned: Manifold[] = [];
afterEach(() => { owned.splice(0).forEach(m => m.delete()); freeAll(); });
function solid(mesh: MeshOut): Manifold {
  const api = k();
  const m = new api.Manifold(new api.Mesh({ numProp: 3, vertProperties: mesh.positions, triVerts: mesh.indices }));
  owned.push(m); expect(m.status()).toBe('NoError'); return m;
}
describe('matching bin lids', () => {
  it('adds a uniquely named matching lid which seats without overlap', () => {
    const bin = { ...defaultBin, width: 1.5, depth: 2, withLid: true, magnets: true };
    const r = generate({ ...DEFAULTS, bin });
    expect(r.pieces).toHaveLength(2);
    const [body, lid] = r.pieces;
    expect(lid.name).toBe(`${body.name}-lid`);
    expect(lid.max[0] - lid.min[0]).toBeCloseTo(62.5, 5);
    expect(lid.max[1] - lid.min[1]).toBeCloseTo(83.5, 5);
    expect(solid(lid).translate([0, 0, binLayout(bin).top]).intersect(buildBin(bin)).volume()).toBeLessThan(1e-6);
    const noMagnets = generate({ ...DEFAULTS, bin: { ...bin, magnets: false } });
    expect(lid.volume).toBeLessThan(noMagnets.pieces[1].volume);
  });
  it('splits bin and lid independently with unique fitting pieces', () => {
    const req = { ...DEFAULTS, bin: { ...defaultBin, width: 6, depth: 2, height: 3, withLid: true }, print: { ...DEFAULTS.print, split: true, bedX: 180, bedY: 180 } };
    const r = generate(req);
    expect(r.pieces).toHaveLength(4);
    expect(r.pieces.filter(p => p.name.includes('-lid-'))).toHaveLength(2);
    expect(new Set(r.pieces.map(p => p.name)).size).toBe(4);
    expect(r.pieces.every(p => p.fitsBed)).toBe(true);
    r.pieces.forEach(solid);
    const solidBin = generate({ ...req, bin: { ...req.bin, solid: true }, print: { ...req.print, bedX: 126, bedY: 100 } });
    expect(solidBin.pieces.filter(p => !p.name.includes('-lid-'))).toHaveLength(2);
    expect(solidBin.pieces.filter(p => p.name.includes('-lid-'))).toHaveLength(3);
    expect(solidBin.pieces.every(p => p.fitsBed)).toBe(true);
  });
  it('skips the lid without a stacking lip and sanitizes the toggle', () => {
    const r = generate({ ...DEFAULTS, bin: { ...defaultBin, lip: 'none', withLid: true } });
    expect(r.pieces).toHaveLength(1);
    expect(r.warnings).toContain('Lids need the stacking lip');
    expect(sanitize({ bin: { withLid: true } }).bin.withLid).toBe(true);
    expect(sanitize({ bin: { withLid: 'yes' } }).bin.withLid).toBe(false);
  });
});


describe('all-side bin scoops', () => {
  for (const [width, depth, compartmentsX, compartmentsY] of [[1, 1, 1, 1], [3, 2, 3, 2]]) {
    for (const tab of ['none', 'full'] as const) it(`${width}×${depth} with ${compartmentsX}×${compartmentsY} compartments and ${tab} tab stays manifold`, () => {
      const p = { ...defaultBin, width, depth, compartmentsX, compartmentsY, scoop: 1, tab, scoopSides: 'all' as const };
      const m = buildBin(p);
      expect(m.status()).toBe('NoError');
      expect(m.genus()).toBe(0);
      expect(m.volume()).toBeGreaterThan(buildBin({ ...p, scoopSides: 'front' }).volume());
    });
  }

  it('fills the floor junction just inside every inner wall and corner', () => {
    const p = { ...defaultBin, width: 2, depth: 2, scoop: 1, scoopSides: 'all' as const };
    const L = binLayout(p), m = buildBin(p);
    const x = L.cavW / 2 - 0.2, y = L.cavD / 2 - 0.2;
    for (const [cx, cy] of [[-x, 0], [x, 0], [0, -y], [0, y]]) {
      const sample = box(cx - 0.05, cx + 0.05, cy - 0.05, cy + 0.05, L.floorZ + 0.25, L.floorZ + 0.35);
      expect(m.intersect(sample).volume()).toBeCloseTo(sample.volume(), 6);
    }
    // Stay inside the rounded cavity outline when probing corners.
    for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
      const sample = box(sx * (x - 1) - 0.05, sx * (x - 1) + 0.05, sy * (y - 1) - 0.05, sy * (y - 1) + 0.05, L.floorZ + 0.25, L.floorZ + 0.35);
      expect(m.intersect(sample).volume()).toBeCloseTo(sample.volume(), 6);
    }
  });

  it('skips the back fillet when label tabs are on', () => {
    const p = { ...defaultBin, width: 2, depth: 2, scoop: 0.5, scoopSides: 'all' as const };
    const L = binLayout(p), y = L.cavD / 2 - 0.2;
    const sample = box(-0.05, 0.05, y - 0.05, y + 0.05, L.floorZ + 0.25, L.floorZ + 0.35);
    expect(buildBin(p).intersect(sample).volume()).toBeCloseTo(sample.volume(), 6);
    expect(buildBin({ ...p, tab: 'full' }).intersect(sample).volume()).toBeLessThan(1e-6);
  });

  it('applies the fillet within every compartment and sanitizes the selector', () => {
    const p = { ...defaultBin, width: 3, depth: 2, compartmentsX: 3, compartmentsY: 2, scoop: 1, scoopSides: 'all' as const };
    const L = binLayout(p), m = buildBin(p), t = 1.2;
    const w = (L.cavW - 2 * t) / 3, d = (L.cavD - t) / 2;
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) {
      const x = -L.cavW / 2 + i * (w + t), y = -L.cavD / 2 + j * (d + t);
      for (const [cx, cy] of [[x + 0.2, y + d / 2], [x + w - 0.2, y + d / 2], [x + w / 2, y + 0.2], [x + w / 2, y + d - 0.2]]) {
        const sample = box(cx - 0.05, cx + 0.05, cy - 0.05, cy + 0.05, L.floorZ + 0.25, L.floorZ + 0.35);
        expect(m.intersect(sample).volume()).toBeCloseTo(sample.volume(), 6);
      }
    }
    expect(sanitize({ bin: { scoopSides: 'all' } }).bin.scoopSides).toBe('all');
    expect(sanitize({ bin: { scoopSides: 'invalid' } }).bin.scoopSides).toBe('front');
  });
});

describe('review regressions', () => {
  it('6x6 all-side scoops with full tabs is one solid with no slivers', async () => {
    const { buildBin, defaultBin } = await import('../src/geometry/bin');
    const { initKernel, freeAll } = await import('../src/geometry/kernel');
    const k = await initKernel();
    const m = buildBin({ ...defaultBin, width: 6, depth: 6, compartmentsX: 6, compartmentsY: 6, scoop: 1, scoopSides: 'all', tab: 'full' });
    expect(m.status()).toBe('NoError');
    expect(m.genus()).toBe(0);
    expect(m.decompose().length).toBe(1);
    const rebuilt = new k.Manifold(m.getMesh());
    expect(rebuilt.status()).toBe('NoError');
    rebuilt.delete();
    freeAll();
  });

  it('matching lid is previewed beside the bin, not inside it', async () => {
    const { generate } = await import('../src/geometry/generate');
    const { DEFAULTS } = await import('../src/state');
    const { initKernel, freeAll } = await import('../src/geometry/kernel');
    await initKernel();
    const r = generate({ ...DEFAULTS, bin: { ...DEFAULTS.bin, withLid: true } });
    const [bin, lid] = r.pieces;
    expect(lid.name.endsWith('-lid')).toBe(true);
    const displayed=displayMeshes(r);
    expect(displayed.find(p=>p.name===lid.name)!.min[0]).toBeGreaterThan(bin.max[0]);
    freeAll();
  });
});
