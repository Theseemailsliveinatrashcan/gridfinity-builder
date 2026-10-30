import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { binLayout, buildBin, buildLabelCard, defaultBin, labelCardSlots, vaseGrams } from '../src/geometry/bin';
import { freeAll, initKernel, k } from '../src/geometry/kernel';
import { generate, type MeshOut } from '../src/geometry/generate';
import { SECTIONS } from '../src/fields';
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


describe('vase-mode bins', () => {
  it('is one filled manifold with a single upper contour and no stacking socket', () => {
    for (const [width, depth] of [[1, 1], [2, 1], [3, 2]]) {
      const p = { ...defaultBin, width, depth, vase: true };
      const m = buildBin(p), normal = buildBin({ ...p, vase: false, solid: true });
      expect(m.status()).toBe('NoError');
      expect(m.decompose()).toHaveLength(1);
      expect(m.genus()).toBe(0);
      expect(m.volume()).toBeGreaterThanOrEqual(normal.volume());
      expect(m.volume()).toBeLessThan(normal.volume() * 1.1);
      const top = binLayout(p).top;
      expect(normal.slice(top + 1).numContour()).toBe(2);
      expect(m.slice(top + 1).numContour()).toBe(1);
      expect(m.slice(10).numContour()).toBe(1);
    }
  });

  it('ignores hidden features and does not emit hidden label cards or matching lids', () => {
    const plain = { ...defaultBin, vase: true };
    const hidden = { ...plain, solid: false, magnets: true, screws: true, cornerHolesOnly: true,
      compartmentsX: 6, compartmentsY: 5, tab: 'full' as const, scoop: 1, scoopSides: 'all' as const,
      labelSlot: 'card' as const, cardPlay: 0.5, withLid: true, wall: 3, floor: 6,
      heightMode: 'internal' as const, internalDepth: 100 };
    const a = buildBin(plain), b = buildBin(hidden);
    expect(b.boundingBox()).toEqual(a.boundingBox());
    expect(b.volume()).toBeCloseTo(a.volume(), 5);
    const r = generate({ ...DEFAULTS, bin: hidden });
    expect(r.pieces).toHaveLength(1);
    expect(r.pieces[0].volume).toBeCloseTo(a.volume(), 5);
    const state = { ...DEFAULTS, bin: hidden };
    for (const key of ['magnets', 'screws', 'cornerHolesOnly', 'compartmentsX', 'compartmentsY', 'tab', 'scoop', 'scoopSides', 'labelSlot', 'cardPlay', 'withLid', 'wall', 'floor', 'solid', 'internalDepth', 'heightMode']) {
      const field = SECTIONS.flatMap(s => s.fields).find(f => f.group === 'bin' && f.key === key)!;
      expect(field.show!(state)).toBe(false);
    }
  });

  it('reports spiral settings, explicit topology limits and the lightweight PLA estimate', () => {
    const p = { ...defaultBin, vase: true };
    const r = generate({ ...DEFAULTS, bin: p });
    expect(r.info).toContain('Print in spiral/vase mode: 1 wall, 0 top layers, ~6 bottom layers (bottom ≥ 1.2 mm)');
    expect(r.info).toContain(`≈ ${vaseGrams(p).toFixed(1)} g in vase mode (PLA, 0.45 mm line width)`);
    const L = binLayout(p), radius = 3.75;
    const perimeter = 2 * (L.outerW + L.outerD - 4 * radius) + 2 * Math.PI * radius;
    const area = L.outerW * L.outerD - (4 - Math.PI) * radius ** 2;
    expect(vaseGrams(p)).toBeCloseTo((perimeter * (L.top + 3.8) * 0.45 + area * 1.2) * 1.24 / 1000, 6);
    expect(vaseGrams(p)).toBeLessThan(r.pieces[0].volume * 1.24 / 1000);
    expect(r.warnings).toContain("Vase-mode bins can't stack on each other");
    expect(r.warnings).toContain('Multiple feet need solid bottom layers through 4.75 mm before the spiral wall begins.');
  });

  it('sanitizes and shares vase settings without changing their saved hidden values', () => {
    const s = sanitize({ bin: { vase: true, compartmentsX: 4, magnets: true } });
    expect(s.bin.vase).toBe(true);
    expect(s.bin.compartmentsX).toBe(4);
    expect(decodeState(encodeState(s))).toEqual(s);
    expect(sanitize({ bin: { vase: 'yes' } }).bin.vase).toBe(false);
  });
});
