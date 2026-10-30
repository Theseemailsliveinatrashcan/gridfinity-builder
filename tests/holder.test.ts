import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildHolder, defaultHolder, holderBinParams, holderLayout, holderOutline, holderPocket, presetValues, type HolderParams, type HolderPreset } from '../src/geometry/holder';
import { binLayout } from '../src/geometry/bin';
import { BASE_PROFILE_HEIGHT } from '../src/geometry/constants';
import { box, freeAll, initKernel, roundedRect } from '../src/geometry/kernel';
import { DEFAULTS, decodeState, encodeState, sanitize } from '../src/state';
import { onFieldChange, SECTIONS } from '../src/fields';
import { generate } from '../src/geometry/generate';

beforeAll(async () => { await initKernel(); });
afterEach(() => freeAll());
const presets: HolderPreset[] = ['aa', 'aaa', '18650', '21700', 'cr2032', 'hex14', 'hex4', 'sd', 'microsd', 'pen', 'marker', 'socket14', 'socket38', 'custom'];
const params = (preset: HolderPreset = 'aa', over: Partial<HolderParams> = {}): HolderParams => ({ ...defaultHolder, preset, ...presetValues(preset), ...over });

describe('holders', () => {
  for (const preset of presets) it(`${preset} preset builds a manifold in 2×2`, () => {
    const p = params(preset);
    const layout = holderLayout(p);
    const m = buildHolder(p);
    expect(m.status()).toBe('NoError');
    expect(m.volume()).toBeGreaterThan(0);
    expect(layout.count).toBeGreaterThan(0);
    expect(m.boundingBox().max[0] - m.boundingBox().min[0]).toBeCloseTo(83.5, 5);
  });

  it('AA grid and staggered counts agree with the pitch calculation', () => {
    // Inner width 81.6 minus 6 margin = 75.6; pitch 15.1 + 2 = 17.1.
    // Grid: floor((75.6 + 2) / 17.1) = 4 each way -> 16.
    expect(holderLayout(params()).count).toBe(16);
    // Stagger: 5 rows at 17.1*sqrt(3)/2; alternate 4 and 3 items -> 18.
    expect(holderLayout(params('aa', { layout: 'staggered' })).count).toBe(18);
  });

  it('auto height leaves 1.2 mm beneath pockets and uses the fewest units', () => {
    for (const preset of presets.filter(s => !s.startsWith('socket'))) {
      for (const lip of ['normal', 'none'] as const) {
        const p = params(preset, { lip });
        const b = holderBinParams(p), L = binLayout(b);
        const bottom = L.floorZ - p.pocketDepth;
        expect(bottom - BASE_PROFILE_HEIGHT).toBeGreaterThanOrEqual(1.2 - 1e-6);
        expect(bottom - 7 - BASE_PROFILE_HEIGHT).toBeLessThan(1.2);
        const m = buildHolder(p);
        const [x, y] = holderLayout(p).centres[0];
        const under = box(x - 0.1, x + 0.1, y - 0.1, y + 0.1, bottom - 0.1, bottom - 0.01);
        expect(m.intersect(under).volume()).toBeCloseTo(under.volume(), 5);
      }
    }
  });

  it('hex pocket geometry has the specified across-flats dimension', () => {
    for (const hexPointForward of [true, false]) {
      const p = params('hex14', { hexPointForward, clearance: 0.25 });
      const bounds = holderPocket(p, 20).slice(15).bounds();
      const axis = hexPointForward ? 0 : 1;
      expect(bounds.max[axis] - bounds.min[axis]).toBeCloseTo(6.75 + 0.5, 5);
    }
  });

  it('slot geometry leans toward +y at the prescribed angle', () => {
    const p = params('sd');
    const cut = holderPocket(p, 20);
    const bottom = cut.slice(12.01).bounds(), top = cut.slice(19.99).bounds();
    const centre = (b: typeof bottom) => (b.min[1] + b.max[1]) / 2;
    expect(centre(top) - centre(bottom)).toBeCloseTo(7.98 * Math.tan(10 * Math.PI / 180), 5);
    expect(centre(top)).toBeGreaterThan(centre(bottom));
  });

  it('posts sit below the lip and have 0.8 mm top chamfers at preset pitches', () => {
    for (const preset of ['socket14', 'socket38'] as const) {
      const p = params(preset);
      const layout = holderLayout(p), L = binLayout(layout.bin);
      expect(layout.centres[1][0] - layout.centres[0][0]).toBeCloseTo(preset === 'socket14' ? 22 : 30, 5);
      const top = layout.surface + p.pocketDepth;
      expect(L.interiorTop - top).toBeGreaterThanOrEqual(3);
      const m = buildHolder(p);
      const [x, y] = layout.centres[0];
      const one = m.intersect(box(x - p.size, x + p.size, y - p.size, y + p.size, layout.surface + 0.1, top + 0.1));
      const shoulder = one.slice(top - 0.8).bounds(), tip = one.slice(top - 0.01).bounds();
      expect(shoulder.max[0] - shoulder.min[0]).toBeCloseTo(p.size, 4);
      expect(tip.max[0] - tip.min[0]).toBeCloseTo(p.size - 1.58, 4);
    }
  });

  it('checks the swept pocket envelope against rounded inner walls', () => {
    for (const shape of ['round', 'hex', 'slot'] as const) {
      const p = params('custom', { width: 1.5, depth: 1.5, shape, size: 10, margin: 0, clearance: 0.25, slotLean: 15 });
      const layout = holderLayout(p), L = binLayout(layout.bin);
      const safe = roundedRect(L.cavW, L.cavD, 3.75 - L.wall).offset(-1).extrude(100);
      for (const [x, y] of layout.centres) expect(holderPocket(p, layout.surface, x, y).subtract(safe).volume()).toBeLessThan(1e-6);
    }
  });

  it('finger notches remove material across each pocket front', () => {
    const p = params('cr2032');
    const outline = holderOutline(p).bounds();
    expect(outline.min[1]).toBeCloseTo(-20.6 / 2 - 2, 5);
    expect(buildHolder(p).volume()).toBeLessThan(buildHolder({ ...p, fingerNotch: false }).volume());
  });

  it('custom clearance enlarges pockets and shrinks posts without moving their pitch', () => {
    const p = params('custom', { shape: 'round', size: 10, clearance: 0.25 });
    const bounds = holderOutline(p).bounds();
    expect(bounds.max[0] - bounds.min[0]).toBeCloseTo(10.5, 6);
    const post = params('socket14', { clearance: 0.25 });
    const layout = holderLayout(post);
    expect(layout.centres[1][0] - layout.centres[0][0]).toBeCloseTo(22, 6);
    const postBounds = holderOutline(post).bounds();
    expect(postBounds.max[0] - postBounds.min[0]).toBeCloseTo(5.7, 6);
  });

  it('staggered finger notches preserve spacing and hardware works on half-unit bases', () => {
    const p = params('cr2032', { layout: 'staggered' });
    const layout = holderLayout(p);
    const outlines = layout.centres.map(([x, y]) => holderOutline(p).translate([x, y]).offset(p.spacing / 2));
    for (let i = 0; i < outlines.length; i++) for (let j = i + 1; j < outlines.length; j++) expect(outlines[i].intersect(outlines[j]).area()).toBeLessThan(1e-6);
    expect(buildHolder(p).status()).toBe('NoError');
    const hardware = params('hex14', { width: 1.5, depth: 1.5, magnets: true, screws: true });
    expect(buildHolder(hardware).status()).toBe('NoError');
    const L = holderLayout(hardware);
    expect(L.surface - hardware.pocketDepth).toBeGreaterThanOrEqual(6.6 - 1e-6);
  });

  it('manual heights reject insufficient depth and custom retains values', () => {
    expect(() => buildHolder(params('pen', { heightMode: 'units', height: 2 }))).toThrow('height is too low');
    expect(() => buildHolder(params('socket38', { heightMode: 'units', height: 2 }))).toThrow('height is too low');
    expect(presetValues('custom')).toEqual({});
    expect(defaultHolder.clearance).toBe(0.25);
  });

  it('preset selection fills detailed fields and state roundtrips stay valid', () => {
    const field = SECTIONS.flatMap(s => s.fields).find(f => f.group === 'holder' && f.key === 'preset')!;
    for (const preset of presets) {
      const s = sanitize({ kind: 'holder', holder: { preset, size: 17, clearance: 0.25 } });
      onFieldChange(s, field);
      expect(s.holder.preset).toBe(preset);
      expect(decodeState(encodeState(s)).holder).toEqual(s.holder);
      if (preset === 'custom') expect(s.holder.size).toBe(17);
      else expect(s.holder.clearance).toBe(0);
    }
    expect(sanitize({ holder: { preset: 'invalid', shape: 'triangle' } }).holder.preset).toBe(defaultHolder.preset);
    expect(sanitize({ holder: { preset: 'invalid', shape: 'triangle' } }).holder.shape).toBe('round');
  });

  it('generates named holder pieces, item count info and flat splitting', () => {
    const r = generate({ ...DEFAULTS, kind: 'holder', holder: params('aa') });
    expect(r.pieces[0].name).toBe('gridfinity-holder-aa-2x2');
    expect(r.warnings).toContain('Holds 16 items');
    const split = generate({ ...DEFAULTS, kind: 'holder', holder: params('aa', { width: 6 }), print: { ...DEFAULTS.print, split: true, bedX: 126, bedY: 100 } });
    expect(split.pieces).toHaveLength(2);
    expect(split.pieces.every(p => p.fitsBed)).toBe(true);
    expect(split.warnings).toContain('Split holders join with flat faces: glue the pieces together.');
  });
});
