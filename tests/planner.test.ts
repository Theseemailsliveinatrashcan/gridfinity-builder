import { presetValues } from '../src/geometry/holder';
import { describe, expect, it } from 'vitest';
import { deflateSync } from 'fflate';
import { defaultPlanner, sanitizePlanner, validatePlacement, itemFromRequest, itemRequest, type PlannerDocument, type PlannerItem } from '../src/planner/document';
import { planDrawer } from '../src/planner/layout';
import { decodePlanner, encodePlanner, MAX_ENCODED, MAX_INFLATED, parsePlannerJson } from '../src/planner/codec';
import { DEFAULTS, encodeState } from '../src/state';
import { SECTIONS, onFieldChange } from '../src/fields';
const doc=():PlannerDocument=>structuredClone(defaultPlanner);
function bin(id='a',x2=0,y2=0,w2=2,d2=2):PlannerItem{const{width:_w,depth:_d,...params}=structuredClone(DEFAULTS.bin);return{id,name:id,x2,y2,w2,d2,rotation:0,kind:'bin',params};}
const hash=(bytes:Uint8Array)=>'#p1.'+btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
describe('planner document and placement',()=>{
 for(const preset of ['aa','drill-metric-13'] as const) it(`accepts placement and import of ${preset} pocket holders`,()=>{
  const d=doc(),{width:_w,depth:_d,...params}={...DEFAULTS.holder,...presetValues(preset),preset};
  const item:PlannerItem={id:'holder',name:preset,x2:0,y2:0,w2:4,d2:4,rotation:0,kind:'holder',params};
  expect(validatePlacement(d,item)).toEqual([]);
  const imported=sanitizePlanner({...d,items:[item]});expect(imported.ok).toBe(true);
  expect(decodePlanner(encodePlanner({...d,items:[item]})).mode).toBe('planner');
 });
 it('bounds dimensions, quantizes ticks, strips unknown and duplicate footprint parameters',()=>{
  const item=bin();const parsed=sanitizePlanner({...doc(),drawer:{widthMm:1e9,depthMm:200,fitGapMm:-1},items:[{...item,x2:0.1,w2:2.1,params:{...item.params,width:99,evil:true}}]});
  expect(parsed.ok).toBe(true);if(!parsed.ok)return;expect(parsed.document.drawer.widthMm).toBe(2000);expect(parsed.document.items[0].w2).toBe(2);expect(parsed.document.items[0].params).not.toHaveProperty('width');expect(parsed.document.items[0].params).not.toHaveProperty('evil');
 });
 it('rejects versions, duplicate IDs, too many items and unknown padding',()=>{
  expect(sanitizePlanner({...doc(),version:2}).ok).toBe(false);
  expect(sanitizePlanner({...doc(),items:[bin(),bin()]}).ok).toBe(false);
  expect(sanitizePlanner({...doc(),items:Array.from({length:65},(_,i)=>bin(String(i)))}).ok).toBe(false);
  expect(sanitizePlanner({...doc(),baseplate:{...doc().baseplate,padding:'other'}}).ok).toBe(false);
 });
 it('allows touching half-open boundaries and rejects overlapping, negative or outside items',()=>{
  const d=doc();d.items=[bin()];expect(validatePlacement(d,bin('b',2)).length).toBe(0);
  expect(validatePlacement(d,bin('b',0)).some(i=>i.code==='collision')).toBe(true);
  expect(validatePlacement(d,bin('b',1)).some(i=>i.code==='socket')).toBe(true);
  expect(validatePlacement(d,bin('b',-2)).length).toBeGreaterThan(0);
  expect(validatePlacement(d,bin('b',90)).length).toBeGreaterThan(0);
 });
 it('matches actual half-cell socket sequences including reversed 90-degree cell order',()=>{
  const d=doc();d.drawer={widthMm:64,depthMm:85,fitGapMm:0.5};d.baseplate.halfCells=true;d.baseplate.alignX=1;
  expect(planDrawer(d).plateLayout.x.cells).toEqual([21,42]);
  expect(validatePlacement(d,bin('a',1,0)).length).toBe(0);
  expect(validatePlacement(d,bin('a',0,0)).some(i=>i.code==='socket')).toBe(true);
  const rotated={...bin('a',0,0,2,3),rotation:90 as const};expect(validatePlacement(d,rotated).length).toBe(0);
  expect(validatePlacement(d,{...rotated,rotation:0}).some(i=>i.code==='socket')).toBe(true);
 });
 it('keeps integral padding non-overlapping and offsets coordinates from socket origin',()=>{
  const d=doc(),L=planDrawer(d);expect(L.spacers).toEqual([]);expect(L.gridOrigin[0]).toBeCloseTo(d.drawer.fitGapMm+L.plateLayout.x.padStart);
  expect(L.plateLayout.x.length+2*d.drawer.fitGapMm).toBe(d.drawer.widthMm);
 });
 it('rejects parameter conflicts and insufficient drawer height',()=>{
  const d=doc(),a=bin();if(a.kind!=='bin')return;a.params.removableDividers='both';a.params.labelSlot='card';expect(validatePlacement(d,a).some(i=>i.code==='parameters')).toBe(true);
  d.drawer.heightMm=10;expect(validatePlacement(d,bin()).some(i=>i.code==='height')).toBe(true);
 });
 it('validates preset side effects and footprint edits atomically without mutating the source',()=>{
  const d=doc();d.items=[bin('a'),bin('b',2)];const before=JSON.stringify(d),request=itemRequest(d.items[0],d.print);
  request.bin.width=2;const candidate=itemFromRequest(d.items[0],request);expect(validatePlacement(d,candidate).some(i=>i.code==='collision')).toBe(true);expect(JSON.stringify(d)).toBe(before);
  const holder={...bin(),kind:'holder' as const,params:structuredClone(DEFAULTS.holder)};
  const resizePreset=itemRequest(holder,d.print);resizePreset.holder.width=2;resizePreset.holder.preset='aa';onFieldChange(resizePreset,SECTIONS.flatMap(s=>s.fields).find(f=>f.group==='holder'&&f.key==='preset')!);expect(validatePlacement(d,itemFromRequest(holder,resizePreset)).some(i=>i.code==='collision')).toBe(true);const req=itemRequest(holder,d.print);req.holder.preset='coins-uk';req.holder.heightMode='units';req.holder.height=2;
  onFieldChange(req,SECTIONS.flatMap(s=>s.fields).find(f=>f.group==='holder'&&f.key==='preset')!);
  expect(validatePlacement(d,itemFromRequest(holder,req)).some(i=>i.code==='parameters')).toBe(true);
 });
});
describe('planner hash codec',()=>{
 it('roundtrips planner documents and decodes legacy single-part hashes',()=>{
  const d=doc();d.items=[bin()];expect(decodePlanner(encodePlanner(d))).toEqual({mode:'planner',document:d});
  expect(decodePlanner('#'+encodeState(DEFAULTS))).toEqual({mode:'part',request:DEFAULTS});
 });
 it('rejects unknown versions and malformed compressed/base64/JSON input',()=>{
  for(const value of ['#p2.abc','#p1.!','#p1.A','#p1.YWJj','not base64'])expect(()=>decodePlanner(value)).toThrow();
  expect(()=>decodePlanner(hash(deflateSync(new TextEncoder().encode('{oops'))))).toThrow();
  expect(()=>decodePlanner(hash(deflateSync(new TextEncoder().encode('{"version":2,"items":[]}'))))).toThrow('version');
  const compressed=deflateSync(new TextEncoder().encode(JSON.stringify(doc())));expect(()=>decodePlanner(hash(compressed.slice(0,-2)))).toThrow();
 });
 it('enforces encoded and streaming inflated limits before accepting a layout',()=>{
  expect(()=>decodePlanner('#'+'a'.repeat(MAX_ENCODED))).toThrow('16 KiB');
  const bomb=deflateSync(new TextEncoder().encode(' '.repeat(MAX_INFLATED+1)));
  expect(()=>decodePlanner(hash(bomb))).toThrow('256 KiB');
  expect(()=>parsePlannerJson(' '.repeat(MAX_INFLATED+1))).toThrow('256 KiB');
 });
});
