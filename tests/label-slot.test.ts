import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { binLayout, buildBin, buildLabelCard, defaultBin, labelCardChannel, labelCardSlots, labelCardSweep } from '../src/geometry/bin';
import { buildLid, defaultLid } from '../src/geometry/lid';
import { box, freeAll, initKernel } from '../src/geometry/kernel';
import { generate } from '../src/geometry/generate';
import { DEFAULTS, decodeState, encodeState, sanitize } from '../src/state';

beforeAll(async () => { await initKernel(); });
afterEach(() => freeAll());
describe('label card slots', () => {
  for (const [width, depth, compartmentsX, compartmentsY] of [[1, 1, 1, 1], [3, 1, 3, 1], [2, 2, 2, 2]]) {
    it(`${compartmentsX}×${compartmentsY} compartments have manifold, open, fitting channels`, () => {
      for (const scoop of [0, 1]) {
        const p = { ...defaultBin, width, depth, compartmentsX, compartmentsY, labelSlot: 'card' as const, scoop, scoopSides: 'all' as const };
        const m = buildBin(p);
        expect(m.status()).toBe('NoError');
        expect(m.genus()).toBe(0);
        const slots = labelCardSlots(p);
        expect(slots).toHaveLength(compartmentsX * compartmentsY);
        for (const slot of slots) {
          const card = buildLabelCard(slot.width).rotate([90, 0, 0]).translate([slot.cx, slot.backY, slot.bottomZ]);
          expect(card.status()).toBe('NoError');
          expect(Math.abs(card.intersect(m).volume())).toBeLessThan(1e-6);
          const a = card.boundingBox(), b = labelCardChannel(slot, p.cardPlay, slot.bottomZ + 12).boundingBox();
          for (const axis of [0, 1]) {
            expect(a.min[axis] - b.min[axis]).toBeGreaterThan(0.2);
            expect(a.min[axis] - b.min[axis]).toBeLessThan(0.3);
            expect(b.max[axis] - a.max[axis]).toBeGreaterThan(0.2);
            expect(b.max[axis] - a.max[axis]).toBeLessThan(0.3);
          }
          // A full channel-sized probe can drop vertically through the open top.
          const probe = labelCardSweep(slot, p.cardPlay, m);
          expect(probe.boundingBox().max[2]).toBeGreaterThan(m.boundingBox().max[2]);
          expect(Math.abs(probe.intersect(m).volume())).toBeLessThan(1e-6);
        }
      }
    });
  }

  it('card slots replace tabs and suppress back scoops', () => {
    const p = { ...defaultBin, width: 2, depth: 2, labelSlot: 'card' as const, scoop: 0.5, scoopSides: 'all' as const };
    const a = buildBin(p), b = buildBin({ ...p, tab: 'full' });
    expect(a.volume()).toBeCloseTo(b.volume(), 5);
    const r = generate({ ...DEFAULTS, bin: { ...p, tab: 'full' } });
    expect(r.warnings).toContain('Label tab replaced by the label card slot');
    const L = binLayout(p), probe = box(-0.1, 0.1, L.cavD / 2 - 0.3, L.cavD / 2 - 0.1, L.floorZ + 1, L.floorZ + 1.1);
    expect(a.intersect(probe).volume()).toBeLessThan(1e-6);
  });

  it('outputs one flat chamfered card per distinct width with stable names', () => {
    const bin = { ...defaultBin, width: 3, depth: 2, compartmentsX: 3, compartmentsY: 2, labelSlot: 'card' as const, withLid: true };
    const r = generate({ ...DEFAULTS, bin });
    const cards = r.pieces.filter(piece => piece.name.includes('-label-card-'));
    expect(cards).toHaveLength(1);
    const w = labelCardSlots(bin)[0].width;
    expect(cards[0].name).toBe(`gridfinity-bin-3x2x6-label-card-${w}mm`);
    expect(cards[0].max[0] - cards[0].min[0]).toBeCloseTo(w, 5);
    expect(cards[0].max[1] - cards[0].min[1]).toBeCloseTo(12, 5);
    expect(cards[0].max[2] - cards[0].min[2]).toBeCloseTo(1, 5);
    const card = buildLabelCard(w);
    const tip = card.intersect(box(-100, 100, 11.99, 12, -1, 2)).boundingBox();
    expect(tip.max[0] - tip.min[0]).toBeCloseTo(w - 0.78, 3);
    expect(tip.max[2] - tip.min[2]).toBeCloseTo(0.22, 3);
    const split = generate({ ...DEFAULTS, bin: { ...bin, width: 6 }, print: { ...DEFAULTS.print, split: true, bedX: 180, bedY: 180 } });
    expect(split.pieces.filter(p => p.name.includes('-label-card-'))).toHaveLength(1);
    expect(split.pieces.find(p => p.name.includes('-label-card-'))!.name).toMatch(/^gridfinity-bin-6x2x6-label-card-/);
    expect(split.pieces.filter(p => p.name.includes('-lid-')).every(p => /^gridfinity-bin-6x2x6-lid-piece-/.test(p.name))).toBe(true);
  });

  it('limits card widths and rejects compartments too small for a channel', () => {
    expect(labelCardSlots({ ...defaultBin, width: 4, labelSlot: 'card' })[0].width).toBe(80);
    expect(() => buildBin({ ...defaultBin, width: 1, compartmentsX: 2, labelSlot: 'card' })).toThrow('Compartment too small');
  });

  it('fits minimum-height bins at either play limit and flags oversized cards', () => {
    for (const cardPlay of [0.1, 0.5]) {
      const p = { ...defaultBin, height: 2, labelSlot: 'card' as const, cardPlay, scoop: 1, scoopSides: 'all' as const };
      const m = buildBin(p);
      expect(m.status()).toBe('NoError');
      for (const slot of labelCardSlots(p)) {
        const card = buildLabelCard(slot.width).rotate([90, 0, 0]).translate([slot.cx, slot.backY, slot.bottomZ]);
        expect(Math.abs(card.intersect(m).volume())).toBeLessThan(1e-6);
      }
    }
    const r = generate({ ...DEFAULTS, bin: { ...defaultBin, width: 6, labelSlot: 'card' }, print: { ...DEFAULTS.print, split: true, bedX: 60, bedY: 60 } });
    expect(r.pieces.find(p => p.name.includes('-label-card-'))!.fitsBed).toBe(false);
    expect(r.warnings).toContain('Label card is larger than the print bed.');
  });

  it('rejects the narrow outer-compartment lip collision and permits minimum-width cards that pass', () => {
    const p = { ...defaultBin, width: 3.5, depth: 1, compartmentsX: 6, labelSlot: 'card' as const };
    const bare = buildBin({ ...p, labelSlot: 'none' });
    const L = binLayout(p), w = (L.cavW - 5 * 1.2) / 6;
    const oldSlot = { width: 20, cx: -L.cavW / 2 + w / 2, backWall: L.cavD / 2,
      backY: L.cavD / 2 - (2.6 - L.wall + 1.5), bottomZ: L.floorZ + 0.8 };
    expect(labelCardSweep(oldSlot, p.cardPlay, bare).intersect(bare).volume()).toBeGreaterThan(0.1);
    expect(() => buildBin(p)).toThrow('Compartments too narrow for label cards');
    expect(() => generate({ ...DEFAULTS, bin: p })).toThrow('Compartments too narrow for label cards');
    // Thicker walls put the minimum-width cards farther inside the lip outline.
    const valid = { ...p, wall: 2 };
    const m = buildBin(valid), slots = labelCardSlots(valid);
    expect(slots).toHaveLength(6);
    expect(slots.every(slot => slot.width === 20)).toBe(true);
    for (const slot of slots) expect(Math.abs(labelCardSweep(slot, valid.cardPlay, m).intersect(m).volume())).toBeLessThan(1e-7);
  });

  it('shrinks oversized card footprints until their full play envelope clears the lip', () => {
    const p = { ...defaultBin, labelSlot: 'card' as const, cardPlay: 0.5 };
    const m = buildBin(p), slots = labelCardSlots(p);
    expect(slots[0].width).toBeLessThan(binLayout(p).cavW - 4);
    expect(slots[0].width).toBeGreaterThanOrEqual(20);
    for (const slot of slots) expect(Math.abs(labelCardSweep(slot, p.cardPlay, m).intersect(m).volume())).toBeLessThan(1e-7);
  });

  it('rejects too-short bins with lids and keeps assembled cards clear of valid lids', () => {
    const p = { ...defaultBin, height: 2, labelSlot: 'card' as const, withLid: true };
    expect(() => generate({ ...DEFAULTS, bin: p })).toThrow('Bin too short for label cards with a lid (needs 3 units)');
    expect(() => buildBin({ ...p, floor: 6, height: 3 })).toThrow('needs 4 units');
    for (const valid of [{ ...p, height: 3 }, { ...p, floor: 6, height: 4 }, { ...p, heightMode: 'internal' as const, internalDepth: 11 }]) {
      const bin = buildBin(valid), L = binLayout(valid);
      const lid = buildLid({ ...defaultLid, width: valid.width, depth: valid.depth }).translate([0, 0, L.top]);
      expect(bin.status()).toBe('NoError');
      for (const slot of labelCardSlots(valid)) {
        const card = buildLabelCard(slot.width).rotate([90, 0, 0]).translate([slot.cx, slot.backY, slot.bottomZ]);
        expect(card.boundingBox().max[2]).toBeLessThanOrEqual(L.top - 0.5);
        expect(Math.abs(card.intersect(lid).volume())).toBeLessThan(1e-6);
        expect(Math.abs(labelCardSweep(slot, valid.cardPlay, bin).intersect(bin).volume())).toBeLessThan(1e-7);
      }
    }
  });

  it('warns about cards above the lip when no lid is fitted', () => {
    const p = { ...defaultBin, height: 2, labelSlot: 'card' as const };
    const short = generate({ ...DEFAULTS, bin: p });
    expect(short.warnings).toContain('Label cards extend above the lip top');
    expect(generate({ ...DEFAULTS, bin: { ...p, height: 3 } }).warnings).not.toContain('Label cards extend above the lip top');
  });

  it('keeps card settings valid through sanitizer and shared links', () => {
    const s = sanitize({ bin: { labelSlot: 'card', cardPlay: 0.25 } });
    expect(decodeState(encodeState(s))).toEqual(s);
    expect(sanitize({ bin: { labelSlot: 'invalid', cardPlay: 100 } }).bin).toMatchObject({ labelSlot: 'none', cardPlay: 0.5 });
    expect(sanitize({ bin: { cardPlay: -1 } }).bin.cardPlay).toBe(0.1);
  });
});

describe('label card preview placement', () => {
  it('cards are previewed in front of the bin, not inside it', async () => {
    const { generate } = await import('../src/geometry/generate');
    const { DEFAULTS } = await import('../src/state');
    const { initKernel, freeAll } = await import('../src/geometry/kernel');
    await initKernel();
    const r = generate({ ...DEFAULTS, bin: { ...DEFAULTS.bin, width: 3, depth: 1, compartmentsX: 3, labelSlot: 'card', withLid: true } });
    const bin = r.pieces[0];
    const cards = r.pieces.filter((p) => p.name.includes('-label-card-'));
    expect(cards.length).toBeGreaterThan(0);
    for (const c of cards) expect(c.max[1]).toBeLessThan(bin.min[1]);
    freeAll();
  });
});
