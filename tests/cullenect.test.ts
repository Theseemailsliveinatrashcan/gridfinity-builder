import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { buildBin, defaultBin } from '../src/geometry/bin';
import { cullenectCavity, cullenectLayout, cullenectReferenceCard, cullenectSocket, LEGACY_GROOVE_CENTRES, placeCullenect } from '../src/geometry/cullenect';
import { box, freeAll, initKernel } from '../src/geometry/kernel';
import { generate } from '../src/geometry/generate';
import { DEFAULTS, decodeState, encodeState, sanitize } from '../src/state';

beforeAll(async () => { await initKernel(); });
afterEach(() => freeAll());
describe('canonical Cullenect V2 sockets', () => {
  it('fits the 1U V2 card with 0.18 mm XY play and a retained perimeter', () => {
    const card = cullenectReferenceCard(36), socket = cullenectSocket(36, 0.18);
    expect(card.status()).toBe('NoError'); expect(socket.status()).toBe('NoError');
    expect(card.boundingBox()).toEqual({ min: [-18, -5.5, -1.2], max: [18, 5.5, 0] });
    expect(Math.abs(card.intersect(socket).volume())).toBeLessThan(1e-6);
    const gap = cullenectCavity(36, 0.18).boundingBox(), b = card.boundingBox();
    for (const axis of [0, 1]) {
      expect(b.min[axis] - gap.min[axis]).toBeCloseTo(0.18, 5);
      expect(gap.max[axis] - b.max[axis]).toBeCloseTo(0.18, 5);
    }
    // The socket lip is 0.4 mm deep and engages the label's recessed perimeter.
    const lip = box(17.985, 18.1, -1, 1, -0.89, -0.51);
    expect(socket.intersect(lip).volume()).toBeCloseTo(lip.volume(), 6);
    expect(card.intersect(lip).volume()).toBeLessThan(1e-6);
  });
  it('fits wider V2 labels and the allowed clearance range', () => {
    for (const width of [36, 57, 78]) for (const play of [0.1, 0.18, 0.4]) {
      const card = cullenectReferenceCard(width), socket = cullenectSocket(width, play);
      expect(socket.status()).toBe('NoError');
      expect(Math.abs(card.intersect(socket).volume())).toBeLessThan(1e-6);
    }
  });
  it('models the optional 1U legacy grooves at the three published centres', () => {
    expect(LEGACY_GROOVE_CENTRES).toEqual([-12.133, 0, 12.133]);
    const card = cullenectReferenceCard(36);
    for (const x of LEGACY_GROOVE_CENTRES) {
      expect(card.intersect(box(x - 0.4, x + 0.4, -4, 4, -1.1, -0.5)).volume()).toBeLessThan(1e-6);
    }
  });
  for (const tab of ['none', 'full', 'left', 'center', 'right'] as const) {
    it(`is manifold with a fitted V2 card on ${tab === 'none' ? 'the back wall' : tab + ' label tabs'}`, () => {
      const p = { ...defaultBin, width: 2, depth: 2, compartmentsX: 2, labelSlot: 'cullenect' as const, tab };
      const bin = buildBin(p);
      expect(bin.status()).toBe('NoError');
      expect(bin.decompose()).toHaveLength(1);
      for (const at of cullenectLayout(p)) {
        const card = placeCullenect(cullenectReferenceCard(at.width), at);
        expect(Math.abs(card.intersect(bin).volume())).toBeLessThan(1e-6);
      }
    });
  }
  it('follows the width rule for wider labels and emits no blank cards', () => {
    const p = { ...defaultBin, width: 2, depth: 2, labelSlot: 'cullenect' as const };
    expect(cullenectLayout(p)[0].width).toBe(78);
    const r = generate({ ...DEFAULTS, bin: p });
    expect(r.pieces).toHaveLength(1);
    expect(r.info.some(s => s.includes('https://github.com/ndevenish/gflabel'))).toBe(true);
  });
  it('rejects narrow compartments and preserves sanitizer/link settings', () => {
    expect(() => buildBin({ ...defaultBin, width: 1, compartmentsX: 2, labelSlot: 'cullenect' })).toThrow('too narrow');
    const s = sanitize({ bin: { labelSlot: 'cullenect', socketClearance: 0.18 } });
    expect(s.bin.labelSlot).toBe('cullenect');
    expect(decodeState(encodeState(s))).toEqual(s);
    expect(sanitize({ bin: { socketClearance: 2 } }).bin.socketClearance).toBe(0.4);
  });
});
