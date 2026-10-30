import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { binLayout, buildBin, buildLabelCard, defaultBin, labelCardSlots } from '../src/geometry/bin';
import { freeAll, initKernel, k } from '../src/geometry/kernel';
import { generate, type MeshOut } from '../src/geometry/generate';
import { DEFAULTS, decodeState, encodeState, sanitize } from '../src/state';

beforeAll(async () => { await initKernel(); });
const owned: Manifold[] = [];
afterEach(() => { owned.splice(0).forEach(m => m.delete()); freeAll(); });
function model(p: MeshOut): Manifold {
  const api = k();
  const m = new api.Manifold(new api.Mesh({ numProp: 3, vertProperties: p.positions, triVerts: p.indices }));
  owned.push(m);
  expect(m.status()).toBe('NoError');
  return m.translate([-(p.min[0] + p.max[0]) / 2, -(p.min[1] + p.max[1]) / 2, -p.min[2]]);
}
describe('stackable lidded boxes', () => {
  it('outputs a 12 mm lid that seats in the bin and accepts another bin at +7.25 mm', () => {
    const p = { ...defaultBin, withLid: true, lidStyle: 'stackable' as const };
    const r = generate({ ...DEFAULTS, bin: p });
    const out = r.pieces.find(p => p.name.endsWith('-lid'))!;
    expect(out.max[2] - out.min[2]).toBeCloseTo(12, 5);
    const L = binLayout(p), bin = buildBin(p), lid = model(out).translate([0, 0, L.top]);
    expect(Math.abs(lid.intersect(bin).volume())).toBeLessThan(1e-6);
    expect(Math.abs(lid.intersect(bin.translate([0, 0, L.top + 7.25])).volume())).toBeLessThan(1e-6);
    const grip = generate({ ...DEFAULTS, bin: { ...p, lidGrip: true } });
    expect(grip.pieces.find(p => p.name.endsWith('-lid'))!.volume).toBeLessThan(out.volume);
  });
  it('splits a box and stackable lid into fitting pieces', () => {
    const r = generate({ ...DEFAULTS, bin: { ...defaultBin, width: 6, depth: 2, withLid: true, lidStyle: 'stackable', lidGrip: true }, print: { ...DEFAULTS.print, split: true, bedX: 180, bedY: 180 } });
    expect(r.pieces).toHaveLength(4);
    expect(r.pieces.every(p => p.fitsBed)).toBe(true);
    r.pieces.forEach(model);
  });
  it('card headroom uses the same seated underside for either lid style', () => {
    for (const lidStyle of ['flat', 'stackable'] as const) {
      const p = { ...defaultBin, height: 3, labelSlot: 'card' as const, withLid: true, lidStyle };
      const r = generate({ ...DEFAULTS, bin: p });
      const lid = model(r.pieces.find(p => p.name.endsWith('-lid'))!).translate([0, 0, binLayout(p).top]);
      for (const slot of labelCardSlots(p)) {
        const card = buildLabelCard(slot.width).rotate([90, 0, 0]).translate([slot.cx, slot.backY, slot.bottomZ]);
        expect(Math.abs(card.intersect(lid).volume())).toBeLessThan(1e-6);
      }
      expect(() => generate({ ...DEFAULTS, bin: { ...p, height: 2 } })).toThrow('needs 3 units');
    }
  });
  it('sanitizes and roundtrips lid choices', () => {
    const s = sanitize({ bin: { withLid: true, lidStyle: 'stackable', lidGrip: true } });
    expect(s.bin).toMatchObject({ lidStyle: 'stackable', lidGrip: true });
    expect(decodeState(encodeState(s))).toEqual(s);
    expect(sanitize({ bin: { lidStyle: 'bad', lidGrip: 'yes' } }).bin).toMatchObject({ lidStyle: 'flat', lidGrip: false });
  });
});
