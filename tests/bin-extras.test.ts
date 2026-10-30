import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { binLayout, buildBin, defaultBin } from '../src/geometry/bin';
import { freeAll, initKernel, k } from '../src/geometry/kernel';
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
