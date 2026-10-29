import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { SECTIONS } from '../src/fields';
import { defaultBin } from '../src/geometry/bin';
import { generate } from '../src/geometry/generate';
import { freeAll, initKernel, trackedCount } from '../src/geometry/kernel';
import { DEFAULTS, decodeState, encodeState, sanitize } from '../src/state';

describe('shared-link state', () => {
  it('clamps sizes to the form limits', () => {
    const s = sanitize({ kind: 'plate', plate: { width: 400, depth: -3, drawerW: 1e9 } });
    const max = (key: string) => SECTIONS.flatMap((x) => x.fields).find((f) => f.group === 'plate' && f.key === key)!.max;
    expect(s.plate.width).toBe(max('width'));
    expect(s.plate.depth).toBe(1);
    expect(s.plate.drawerW).toBe(max('drawerW'));
  });

  it('rejects unknown kinds, wrong types and unknown keys', () => {
    const s = sanitize({ kind: 'rocket', bin: { width: 'big', lip: 'giant', magnets: 'yes', evil: 1 }, print: { bedX: NaN } });
    expect(s.kind).toBe(DEFAULTS.kind);
    expect(s.bin.width).toBe(defaultBin.width);
    expect(s.bin.lip).toBe(defaultBin.lip);
    expect(s.bin.magnets).toBe(defaultBin.magnets);
    expect('evil' in s.bin).toBe(false);
    expect(s.print.bedX).toBe(DEFAULTS.print.bedX);
  });

  it('round-trips and survives garbage', () => {
    const s = sanitize({ kind: 'tile', tile: { cols: 5 } });
    expect(decodeState(encodeState(s))).toEqual(s);
    expect(decodeState('%%%not-base64')).toEqual(sanitize({}));
  });
});

describe('kernel arena', () => {
  beforeAll(async () => {
    await initKernel();
  });
  afterEach(() => freeAll());

  it('is empty after a generation is freed', () => {
    generate({ ...DEFAULTS, bin: { ...defaultBin, magnets: true } });
    expect(trackedCount()).toBeGreaterThan(0);
    freeAll();
    expect(trackedCount()).toBe(0);
  });
});
