import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { binLayout, buildBin, defaultBin } from '../src/geometry/bin';
import { buildDivider, dividerLayout, printableDivider } from '../src/geometry/dividers';
import { box, freeAll, initKernel } from '../src/geometry/kernel';
import { generate } from '../src/geometry/generate';
import { DEFAULTS, decodeState, encodeState, sanitize } from '../src/state';
import { SECTIONS } from '../src/fields';

beforeAll(async () => { await initKernel(); });
afterEach(() => freeAll());
describe('removable dividers', () => {
  it('counts centred slots at the requested pitch and fits every pair on both axes', () => {
    for (const direction of ['x', 'y'] as const) {
      const p = { ...defaultBin, width: 2, depth: 2, removableDividers: direction };
      const d = dividerLayout(p), bin = buildBin(p);
      expect(d[direction]).toHaveLength(15);
      expect(d[direction][1] - d[direction][0]).toBe(5);
      expect(bin.status()).toBe('NoError');
      expect(bin.decompose()).toHaveLength(1);
      for (const at of d[direction]) {
        const plate = buildDivider(p, direction, at);
        expect(plate.status()).toBe('NoError');
        expect(Math.abs(plate.intersect(bin).volume())).toBeLessThan(1e-6);
      }
      for (const position of d[direction]) for (const end of [-1, 1]) {
        const reach = (direction === 'x' ? d.L.cavW : d.L.cavD) / 2 - 1;
        let cx = end * reach, cy = position + p.slotWidth / 2 + 0.4;
        if (direction === 'y') [cx, cy] = [-cy, cx];
        const rib = box(cx - 0.05, cx + 0.05, cy - 0.05, cy + 0.05, d.L.floorZ + 0.2, d.L.floorZ + 0.4);
        expect(bin.intersect(rib).volume()).toBeCloseTo(rib.volume(), 6);
      }
      const at = d[direction][7];
      const gap = p.slotWidth - p.dividerThickness;
      expect(gap).toBeCloseTo(0.3, 6);
      const span = direction === 'x' ? d.spanX : d.spanY;
      const sweep = direction === 'x'
        ? box(-span / 2, span / 2, at - 1.1, at + 1.1, d.L.floorZ, bin.boundingBox().max[2] + d.height)
        : box(-at - 1.1, -at + 1.1, -span / 2, span / 2, d.L.floorZ, bin.boundingBox().max[2] + d.height);
      expect(Math.abs(sweep.intersect(bin).volume())).toBeLessThan(1e-6);
    }
  });
  it('interlocks both half-height notches without plate overlap', () => {
    const p = { ...defaultBin, width: 2, depth: 2, removableDividers: 'both' as const };
    const bin = buildBin(p), x = buildDivider(p, 'x'), y = buildDivider(p, 'y');
    expect(x.status()).toBe('NoError'); expect(y.status()).toBe('NoError');
    expect(Math.abs(x.intersect(y).volume())).toBeLessThan(1e-6);
    expect(Math.abs(x.intersect(bin).volume())).toBeLessThan(1e-6);
    expect(Math.abs(y.intersect(bin).volume())).toBeLessThan(1e-6);
    expect(binLayout(p).interiorTop - x.boundingBox().max[2]).toBeCloseTo(0.1, 6);
  });
  it('keeps fixed compartments with clearance routes for removable plates', () => {
    const p = { ...defaultBin, width: 2, depth: 2, compartmentsX: 2, compartmentsY: 2, scoop: 0.4, scoopSides: 'all' as const, removableDividers: 'both' as const };
    const bin = buildBin(p);
    expect(bin.status()).toBe('NoError');
    for (const axis of ['x', 'y'] as const) expect(Math.abs(buildDivider(p, axis).intersect(bin).volume())).toBeLessThan(1e-6);
  });
  it('prints one flat plate per requested axis with names and preview placement', () => {
    const p = { ...defaultBin, width: 2, depth: 2, removableDividers: 'both' as const };
    const r = generate({ ...DEFAULTS, bin: p });
    const plates = r.pieces.filter(p => p.name.includes('-divider-'));
    expect(plates.map(p => p.name)).toEqual(['gridfinity-bin-2x2x6-divider-x', 'gridfinity-bin-2x2x6-divider-y']);
    expect(plates.every(p => p.max[1] < r.pieces[0].min[1])).toBe(true);
    for (const axis of ['x', 'y'] as const) {
      const flat = printableDivider(p, axis), b = flat.boundingBox();
      expect(flat.status()).toBe('NoError');
      expect(b.max[2] - b.min[2]).toBeCloseTo(2.2, 6);
    }
  });
  it('vase ignores and hides divider options and sanitizer keeps valid values', () => {
    const p = { ...defaultBin, vase: true, removableDividers: 'both' as const };
    expect(buildBin(p).volume()).toBeCloseTo(buildBin({ ...p, removableDividers: 'none' }).volume(), 6);
    expect(generate({ ...DEFAULTS, bin: p }).pieces).toHaveLength(1);
    const field = SECTIONS.flatMap(s => s.fields).find(f => f.group === 'bin' && f.key === 'removableDividers')!;
    expect(field.show!({ ...DEFAULTS, bin: p })).toBe(false);
    const s = sanitize({ bin: { removableDividers: 'both', slotPitch: 8, slotWidth: 2.5, dividerThickness: 2.2 } });
    expect(s.bin.removableDividers).toBe('both'); expect(s.bin.slotPitch).toBe(8);
    expect(decodeState(encodeState(s))).toEqual(s);
    expect(sanitize({ bin: { removableDividers: 'bad', slotPitch: 100 } }).bin).toMatchObject({ removableDividers: 'none', slotPitch: 20 });
  });
});
