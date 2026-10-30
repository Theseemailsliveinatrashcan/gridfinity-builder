import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildSpacer, defaultSpacer, spacerCells, SPACER_HEIGHTS } from '../src/geometry/spacer';
import { box, freeAll, initKernel } from '../src/geometry/kernel';
import { DEFAULTS, decodeState, encodeState, sanitize } from '../src/state';
import { generate } from '../src/geometry/generate';
import { onFieldChange, SECTIONS } from '../src/fields';

beforeAll(async () => { await initKernel(); });
afterEach(() => freeAll());
describe('drawer spacers', () => {
  it('builds rounded straight and corner strips with exact bounds', () => {
    for (const shape of ['straight', 'corner'] as const) {
      const p = { ...defaultSpacer, length: 120, width: 12, length2: 80, shape };
      const m = buildSpacer(p);
      expect(m.status()).toBe('NoError');
      expect(m.genus()).toBe(0);
      expect(m.boundingBox()).toEqual({ min: [0, 0, 0], max: [120, shape === 'corner' ? 80 : 12, 5] });
      expect(m.intersect(box(119.9, 120, 11.9, 12, 0, 5)).volume()).toBeLessThan(0.01);
      if (shape === 'corner') expect(m.intersect(box(15, 110, 15, 70, 0, 5)).volume()).toBeLessThan(1e-6);
    }
  });
  it('adds the 3 mm wide, 1.2 mm thick plate-facing ledge at the bottom', () => {
    const p = { ...defaultSpacer, length: 120, width: 12, length2: 80, lip: true };
    const straight = buildSpacer(p);
    expect(straight.status()).toBe('NoError');
    expect(straight.boundingBox().max).toEqual([120, 15, 5]);
    const ledge = box(10, 110, 12.01, 14.99, 0, 1.2);
    expect(straight.intersect(ledge).volume()).toBeCloseTo(ledge.volume(), 5);
    expect(straight.intersect(box(10, 110, 12.01, 14.99, 1.21, 5)).volume()).toBeLessThan(1e-6);
    const corner = buildSpacer({ ...p, shape: 'corner' });
    expect(corner.status()).toBe('NoError');
    expect(corner.boundingBox().max).toEqual([120, 80, 5]);
    const second = box(12.01, 14.99, 20, 70, 0, 1.2);
    expect(corner.intersect(second).volume()).toBeCloseTo(second.volume(), 5);
  });
  it('height presets and custom values work through the existing form hook', () => {
    const field = SECTIONS.flatMap(s => s.fields).find(f => f.group === 'spacer' && f.key === 'preset')!;
    for (const preset of ['thin', 'solid', 'weighted', 'custom'] as const) {
      const s = sanitize({ kind: 'spacer', spacer: { preset, height: 6.7 } });
      expect(onFieldChange(s, field)).toBe(preset !== 'custom');
      const height = preset === 'custom' ? 6.7 : SPACER_HEIGHTS[preset];
      expect(s.spacer.height).toBe(height);
      expect(buildSpacer(s.spacer).boundingBox().max[2]).toBe(height);
      expect(decodeState(encodeState(s))).toEqual(s);
    }
    expect(sanitize({ spacer: { preset: 'bad', length: 5000, width: -2 } }).spacer).toMatchObject({ preset: 'thin', length: 1000, width: 2 });
  });
  it('splits 600 mm into three fitting butt-joint pieces', () => {
    expect(spacerCells(600)).toEqual([...Array(14).fill(42), 12]);
    const p = { ...defaultSpacer, length: 600 };
    const r = generate({ ...DEFAULTS, kind: 'spacer', spacer: p, print: { ...DEFAULTS.print, split: true, bedX: 220, bedY: 220 } });
    expect(r.pieces).toHaveLength(3);
    expect(r.pieces.every(piece => piece.fitsBed)).toBe(true);
    expect(r.size).toEqual([600, 10, 5]);
    expect(r.pieces[0].name).toMatch(/^gridfinity-spacer-600x10-piece-/);
    expect(r.warnings).toEqual([]);
    expect(r.pieces.reduce((sum, piece) => sum + piece.volume, 0)).toBeCloseTo(buildSpacer(p).volume(), 4);
  });
  it('rejects corner arms shorter than the strip and ledge', () => {
    expect(() => buildSpacer({ ...defaultSpacer, shape: 'corner', length: 20, width: 20 })).toThrow('Corner lengths');
  });
});
