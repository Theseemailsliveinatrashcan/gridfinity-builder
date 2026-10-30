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
  for (const [dividerCountX, dividerCountY] of [[2, 3], [3, 2], [3, 3]]) {
    it(`interlocks all marked off-centre plates for counts ${dividerCountX}/${dividerCountY}`, () => {
      const p = { ...defaultBin, width: 2, depth: 2, removableDividers: 'both' as const, dividerCountX, dividerCountY };
      const d = dividerLayout(p), bin = buildBin(p);
      expect(d.installX).toHaveLength(dividerCountX); expect(d.installY).toHaveLength(dividerCountY);
      for (const atX of d.installX) for (const atY of d.installY) {
        const x = buildDivider(p, 'x', atX), y = buildDivider(p, 'y', atY);
        expect(Math.abs(x.intersect(y).volume())).toBeLessThan(1e-6);
        expect(Math.abs(x.intersect(bin).volume())).toBeLessThan(1e-6);
        expect(Math.abs(y.intersect(bin).volume())).toBeLessThan(1e-6);
      }
      const r = generate({ ...DEFAULTS, bin: p });
      expect(r.info).toContain(`With dividers both ways, install plates at the marked positions: X at ${d.installX.join(', ')}, Y at ${d.installY.join(', ')} mm`);
      expect(r.info).toContain(`Print ${dividerCountX} removable X divider plates`);
      expect(r.pieces.filter(p => p.name.includes('-divider-'))).toHaveLength(2);
      const probe = (at: number) => box(d.L.cavW / 2 - d.ribDepth + 0.2, d.L.cavW / 2 - d.ribDepth + 0.3,
        at + p.slotWidth / 2 + 0.35, at + p.slotWidth / 2 + 0.45, d.L.interiorTop - 0.3, d.L.interiorTop - 0.2);
      expect(bin.intersect(probe(d.installX[0])).volume()).toBeLessThan(1e-6);
      const unmarked = d.x.find(at => !d.installX.includes(at))!;
      const solid = probe(unmarked);
      expect(bin.intersect(solid).volume()).toBeCloseTo(solid.volume(), 6);
    });
  }

  it('rejects label cards and sockets with removable dividers', () => {
    for (const labelSlot of ['card', 'cullenect'] as const) {
      const p = { ...defaultBin, width: 2, depth: 2, removableDividers: 'both' as const, labelSlot };
      expect(() => buildBin(p)).toThrow("Removable dividers can't be combined with label cards or sockets yet.");
      expect(() => generate({ ...DEFAULTS, bin: p })).toThrow("Removable dividers can't be combined with label cards or sockets yet.");
    }
  });

  it('captures each plate end by at least 1.5 mm throughout ±0.3 mm axial play', () => {
    for (const wall of [0.8, 0.95, 3]) for (const direction of ['x', 'y'] as const) {
      const p = { ...defaultBin, width: 2, depth: 2, removableDividers: direction, wall };
      const d = dividerLayout(p), bin = buildBin(p), coordinate = direction === 'x' ? 0 : 1;
      const half = (direction === 'x' ? d.L.cavW : d.L.cavD) / 2;
      for (const travel of [-0.3, 0.3]) {
        const plate = buildDivider(p, direction).translate(direction === 'x' ? [travel, 0, 0] : [0, travel, 0]);
        const b = plate.boundingBox();
        expect((-half + d.ribDepth) - b.min[coordinate]).toBeGreaterThanOrEqual(1.5 - 1e-6);
        expect(b.max[coordinate] - (half - d.ribDepth)).toBeGreaterThanOrEqual(1.5 - 1e-6);
        expect(Math.abs(plate.intersect(bin).volume())).toBeLessThan(1e-6);
      }
    }
  });

  it('uses distinct symmetric guide slots even for dense counts in small bins', () => {
    const p = { ...defaultBin, width: 1, depth: 1, removableDividers: 'both' as const, dividerCountX: 4, dividerCountY: 4 };
    const d = dividerLayout(p);
    expect(new Set(d.installX).size).toBe(4);
    expect(d.installX).toEqual(d.installX.slice().reverse().map(at => -at));
    expect(d.installX.every(at => d.x.includes(at))).toBe(true);
  });

  it('sanitizes divider counts and generates 6×6 both-ways geometry under 5 seconds', () => {
    expect(sanitize({ bin: { dividerCountX: 99, dividerCountY: -2 } }).bin).toMatchObject({ dividerCountX: 10, dividerCountY: 1 });
    const started = performance.now();
    const r = generate({ ...DEFAULTS, bin: { ...defaultBin, width: 6, depth: 6, removableDividers: 'both', dividerCountX: 3, dividerCountY: 3 } });
    const elapsed = performance.now() - started;
    expect(r.pieces).toHaveLength(3);
    expect(elapsed).toBeLessThan(5000);
    console.info(`6×6 both-way divider generation: ${Math.round(elapsed)} ms`);
  }, 10000);

});

describe('review regression: end slots with deep perpendicular ribs', () => {
  it('end-slot plates clear the bin on both axes with no interior features', async () => {
    const { initKernel, freeAll } = await import('../src/geometry/kernel');
    const { buildBin, defaultBin } = await import('../src/geometry/bin');
    const { buildDivider, dividerLayout } = await import('../src/geometry/dividers');
    await initKernel();
    const p = { ...defaultBin, width: 1.5, depth: 1.5, lip: 'none' as const, wall: 3, dividerThickness: 3, slotWidth: 3.1, slotPitch: 5, removableDividers: 'both' as const, dividerCountX: 10, dividerCountY: 10 };
    const bin = buildBin(p);
    const d = dividerLayout(p);
    const z = d.L.floorZ;
    for (const [axis, list] of [['x', d.installX], ['y', d.installY]] as const) {
      for (const at of [list[0], list[list.length - 1]]) {
        const plate = buildDivider(p, axis, at).translate([0, 0, z]);
        expect(plate.intersect(bin).volume()).toBeLessThan(1e-6);
      }
    }
    freeAll();
  });
});
