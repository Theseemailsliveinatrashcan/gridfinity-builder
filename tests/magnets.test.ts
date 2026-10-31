import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildBin, defaultBin } from '../src/geometry/bin';
import { buildLid, defaultLid } from '../src/geometry/lid';
import { buildHolder, defaultHolder } from '../src/geometry/holder';
import { buildPlate, defaultPlate } from '../src/geometry/baseplate';
import { magnetCutter, type MagnetStyle } from '../src/geometry/magnets';
import { box, freeAll, initKernel } from '../src/geometry/kernel';
import { generate } from '../src/geometry/generate';
import { DEFAULTS, sanitize } from '../src/state';
beforeAll(async () => { await initKernel(); });
afterEach(freeAll);
for (const magnetStyle of ['plain', 'crush', 'refined'] as MagnetStyle[]) {
  for (const width of [1, 2, 0.5]) it(`${magnetStyle} magnets: ${width}×1 bin, lid and holder`, () => {
    const options = { width, depth: 1, magnets: true, magnetStyle, magnetChamfer: true };
    expect(buildBin({ ...defaultBin, ...options }).status()).toBe('NoError');
    expect(buildLid({ ...defaultLid, ...options }).status()).toBe('NoError');
    expect(buildHolder({ ...defaultHolder, ...options }).status()).toBe('NoError');
  });
}
it('crush cross-section has eight radial minima at 2.95 mm and maxima at 3.25 mm', () => {
  const polygon = magnetCutter('crush').slice(1).toPolygons()[0];
  const radii = polygon.map(([x,y]) => Math.hypot(x,y));
  expect(Math.min(...radii)).toBeCloseTo(2.95, 5);
  expect(Math.max(...radii)).toBeCloseTo(3.25, 5);
  expect(radii.filter((r,i) => r < radii[(i+1)%radii.length] && r < radii[(i+radii.length-1)%radii.length]).length).toBe(8);
});
it('chamfer widens the entry by 0.8 mm and ends at 0.8 mm', () => {
  expect(magnetCutter('plain',true).slice(0).bounds().max[0]).toBeCloseTo(4.05, 4);
  expect(magnetCutter('plain',true).slice(1).area()).toBeCloseTo(magnetCutter('plain').slice(1).area(), 5);
});
it('refined pocket has a 0.4 mm bottom except for the removal slit, and an outward entry', () => {
  const cut = magnetCutter('refined');
  expect(cut.intersect(box(-2,2,-2,2,0,0.39)).volume()).toBe(0);
  expect(cut.intersect(box(4,9,-2,2,0,0.39)).volume()).toBe(0);
  expect(cut.intersect(box(4,9,-2,2,0.4,2.3)).volume()).toBeCloseTo(38, 5);
  expect(cut.intersect(box(-7,-5,-1,1,0,0.3)).volume()).toBeGreaterThan(0);
  expect(cut.boundingBox().max[2]).toBeCloseTo(2.3);
  const bin = buildBin({ ...defaultBin, width:1, depth:1, magnets:true, magnetStyle:'refined' });
  expect(bin.intersect(box(12,14,12,14,0.1,0.3)).volume()).toBeCloseTo(0.8);
});
it('plates support crush/chamfer and state retains all magnet controls', () => {
  expect(buildPlate({...defaultPlate,magnets:true,magnetStyle:'crush',magnetChamfer:true}).status()).toBe('NoError');
  const state = sanitize({bin:{magnetStyle:'refined',magnetChamfer:true},plate:{magnetStyle:'crush',magnetChamfer:true}});
  expect(state.bin.magnetStyle).toBe('refined'); expect(state.plate.magnetStyle).toBe('crush');
});
it('all magnet styles keep split-bin dovetails in the floor above the cutters', () => {
  for(const magnetStyle of ['plain','crush','refined'] as MagnetStyle[]) {
    expect(magnetCutter(magnetStyle,true).boundingBox().max[2]).toBeLessThan(4.75);
    const result=generate({...structuredClone(DEFAULTS),bin:{...defaultBin,width:6,depth:2,height:3,magnets:true,magnetStyle},print:{...DEFAULTS.print,split:true,bedX:180,bedY:180,connector:'dovetail'}});
    expect(result.pieces.length).toBe(2); expect(result.pieces.every(p=>p.fitsBed)).toBe(true);
  }
});
