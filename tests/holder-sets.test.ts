import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildHolder, defaultHolder, holderLayout, holderBinParams, holderOutline, holderPocket, presetValues, type HolderParams, type HolderPreset } from '../src/geometry/holder';
import { HOLDER_PRESET_GROUPS, SINGLE_PRESETS, SET_PRESETS, presetItems } from '../src/geometry/holder-presets';
import { binLayout } from '../src/geometry/bin';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS } from '../src/geometry/constants';
import { box, freeAll, initKernel, roundedRect } from '../src/geometry/kernel';
import { DEFAULTS, sanitize, encodeState, decodeState } from '../src/state';
import { SECTIONS } from '../src/fields';
import { generate } from '../src/geometry/generate';
beforeAll(async()=>{await initKernel();});afterEach(freeAll);
const params=(preset:HolderPreset, extra:Partial<HolderParams>={}):HolderParams=>({...defaultHolder,preset,...presetValues(preset),...extra});
for(const preset of [...Object.keys(SINGLE_PRESETS),...Object.keys(SET_PRESETS)] as HolderPreset[])it(`${preset} builds manifold and survives shared-link sanitization`,()=>{
 const p=params(preset);expect(buildHolder(p).status()).toBe('NoError');
 const state=sanitize({kind:'holder',holder:p});expect(state.holder.preset).toBe(preset);
 expect(decodeState(encodeState(state)).holder).toEqual(state.holder);
 expect(holderLayout(p).count).toBeGreaterThan(0);
});
for(const preset of Object.keys(SET_PRESETS) as HolderPreset[])it(`${preset} packs in size order, with wall clearance and non-overlapping spacing`,()=>{
 const p=params(preset,{width:5,depth:5});const layout=holderLayout(p),L=binLayout(layout.bin);
 expect(layout.count).toBe(layout.total);
 const safe=roundedRect(L.cavW,L.cavD,Math.max(BASE_TOP_RADIUS-L.wall,0.25)).offset(-Math.max(1,p.margin));
 const items=layout.items!;
 expect(items.map(i=>i.size)).toEqual(items.map(i=>i.size).sort((a,b)=>a-b));
 const outlines=items.map(item=>holderOutline({...p,...item,fingerNotch:!!item.fingerNotch,clearance:0}).translate([item.x,item.y]));
 outlines.forEach(outline=>expect(outline.subtract(safe).area()).toBeLessThan(1e-6));
 for(let i=0;i<items.length;i++)for(let j=i+1;j<items.length;j++){
  expect(outlines[i].offset(p.spacing/2-0.0001).intersect(outlines[j].offset(p.spacing/2-0.0001)).area()).toBeLessThan(1e-6);
  if(items[i].row===items[j].row)expect(items[i].x).toBeLessThan(items[j].x);
 }
});
it('1–13 mm drill index fits 4×3 and reports partial fit on a 1×1',()=>{
 const full=params('drill-metric-13',{width:4,depth:3});expect(holderLayout(full).count).toBe(25);
 const small=params('drill-metric-13',{width:1,depth:1}),L=holderLayout(small);
 expect(L.count).toBeGreaterThan(0);expect(L.count).toBeLessThan(25);
 const result=generate({...structuredClone(DEFAULTS),kind:'holder',holder:small});
 expect(result.info).toContain(`${L.count} of 25 fit — enlarge the holder`);
 expect(result.info.find(line=>line.startsWith('Row 1:'))).toMatch(/^Row 1: 1, 1.5/);
});
it('fractional index has 29 sizes and endpoints 1/16 and 1/2 inch',()=>{
 const items=presetItems('drill-fractional')!;expect(items.length).toBe(29);
 expect(items[0].size).toBeCloseTo(25.4/16+0.3);expect(items[28].size).toBeCloseTo(12.7+0.3);
});
it('hex key and nut cuts measure the specified across-flats dimensions',()=>{
 for(const preset of ['hex-metric','hex-sae','nuts-metric'] as const)for(const item of presetItems(preset)!){
  const p={...params(preset),...item,clearance:0};
  const bounds=holderPocket(p,30).slice(30-item.pocketDepth/2).bounds();
  expect(bounds.max[1]-bounds.min[1]).toBeCloseTo(item.size,5);
 }
 expect(presetItems('hex-metric')!.map(i=>i.size)).toEqual([2,2.5,3,3.5,4.4,5.4,6.4,8.4,10.4]);
});
it('coin auto height uses deepest tube even on partial fit and leaves a 1.2 mm floor',()=>{
 for(const preset of ['coins-us','coins-euro','coins-uk'] as const){
  const p=params(preset,{width:4,depth:4});const layout=holderLayout(p),part=buildHolder(p);
  const deepest=Math.max(...presetItems(preset)!.map(i=>i.pocketDepth));
  expect(layout.surface-deepest-BASE_PROFILE_HEIGHT).toBeGreaterThanOrEqual(1.2-1e-6);
  expect(layout.surface-deepest-BASE_PROFILE_HEIGHT).toBeLessThan(8.2);
  for(const item of layout.items!){
   expect(part.intersect(box(item.x-0.1,item.x+0.1,item.y-0.1,item.y+0.1,layout.surface-item.pocketDepth+0.01,layout.surface-0.01)).volume()).toBeLessThan(1e-6);
   const floor=box(item.x-0.1,item.x+0.1,item.y-0.1,item.y+0.1,layout.surface-item.pocketDepth-0.1,layout.surface-item.pocketDepth-0.01);
   expect(part.intersect(floor).volume()).toBeCloseTo(floor.volume(),6);
  }
  expect(()=>holderBinParams({...p,heightMode:'units',height:2})).toThrow('height is too low');
 }
 expect(Math.max(...presetItems('coins-uk')!.map(i=>i.pocketDepth))).toBe(59);
});
it('9V rectangular pocket is 27 × 18 × 15 mm',()=>{
 const p=params('9v'),cut=holderPocket(p,30),b=cut.slice(20).bounds();
 expect(b.max[0]-b.min[0]).toBe(27);expect(b.max[1]-b.min[1]).toBe(18);expect(cut.boundingBox().min[2]).toBe(15);
});
it('preset groups cover every option exactly once, with custom last',()=>{
 expect(HOLDER_PRESET_GROUPS.map(g=>g.label)).toEqual(['Batteries','Button cells','Bits & keys','Drill index','Coins','Fasteners','Cards & pens','Sockets','Custom']);
 const field=SECTIONS.flatMap(s=>s.fields).find(f=>f.group==='holder'&&f.key==='preset')!;
 expect(new Set(field.options!.map(([v])=>v)).size).toBe(field.options!.length);
 for(const [value]of field.options!)expect(field.optionGroups![value]).toBeTruthy();
 expect(field.options!.at(-1)![0]).toBe('custom');
});
