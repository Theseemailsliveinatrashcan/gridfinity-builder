import type { Manifold } from 'manifold-3d';
import { afterEach, beforeAll, expect, it } from 'vitest';
import { buildPlate, defaultPlate, plateConnectionCutters, plateHardwareCutters, plateLayout } from '../src/geometry/baseplate';
import { box, cylinderAt, freeAll, initKernel, k, unionAll } from '../src/geometry/kernel';
import { generate, type MeshOut } from '../src/geometry/generate';
import { DEFAULTS, sanitize } from '../src/state';
beforeAll(async()=>{ await initKernel(); });
const owned:Manifold[]=[];
afterEach(()=>{owned.splice(0).forEach(m=>m.delete());freeAll();});
function solid(p:MeshOut) {const api=k();const m=new api.Manifold(new api.Mesh({numProp:3,vertProperties:p.positions,triVerts:p.indices}));owned.push(m);return m;}
it('skeleton cut-outs follow rounded corner exclusions and reduce weight',()=>{
 const p={...defaultPlate,width:1,depth:1,style:'skeletonized' as const};
 const plate=buildPlate(p), L=plateLayout(p);
 expect(plate.status()).toBe('NoError'); expect(plate.decompose().length).toBe(1);
 expect(plate.intersect(box(19,23,19,23,0,L.bottom)).volume()).toBe(0);
 expect(plate.intersect(box(7,9,7,9,0,L.bottom)).volume()).toBeGreaterThan(0);
 // Compare an identical-height solid blank, not the shorter existing solid style.
 const solidBlank=buildPlate({...p,style:'thin'}).add(box(0,42,0,42,0,L.bottom));
 expect(plate.volume()).toBeLessThan(solidBlank.volume());
});
for(const connectScrews of [false,true]) for(const mountHoles of ['none','counterbore','countersink'] as const) it(`drawer half cells, magnets and ${mountHoles}, screw joints ${connectScrews}`,()=>{
 const p={...defaultPlate,style:'skeletonized' as const,drawerW:200,drawerD:100,halfCells:true,magnets:true,magnetStyle:'crush' as const,magnetChamfer:true,mountHoles,connectScrews};
 const plate=buildPlate(p);
 expect(plate.status()).toBe('NoError'); expect(plate.decompose().length).toBe(1);
 const hardware=unionAll(plateHardwareCutters(p))!;
 expect(plate.intersect(hardware).volume()).toBeLessThan(1e-6);
 for(const h of plateConnectionCutters(p,[74],[42]))expect(h.intersect(hardware).volume()).toBeLessThan(1e-6);
});
it('screw bore axis and circular openings match across split seams on both axes',()=>{
 const req={...structuredClone(DEFAULTS),kind:'plate' as const,plate:{...defaultPlate,width:4,depth:4,style:'skeletonized' as const,connectScrews:true,magnets:true},print:{...DEFAULTS.print,split:true,bedX:100,bedY:100,connector:'dovetail' as const}};
 const result=generate(req); expect(result.pieces.length).toBe(4);expect(result.pieces.every(p=>p.fitsBed)).toBe(true);
 expect(result.warnings).toContain('Screw-together plates use flat screw joints instead of dovetails.');
 const parts=result.pieces.map(solid),z=6.75/2,r=3.35/2;
 for(const axis of ['x','y'])for(const at of [21,63,105,147]){
  const bore=cylinderAt(0,0,-10.5,10.5,r-0.001,48).rotate(axis==='x'?[0,90,0]:[90,0,0]).translate(axis==='x'?[84,at,z]:[at,84,z]);
  expect(parts.reduce((v,p)=>v+p.intersect(bore).volume(),0)).toBeLessThan(1e-6);
  // Immediately outside the bore on either side is connected material, not an absent seam.
  for(const side of [-1,1]){
   const probe=axis==='x'?box(84+side*1-0.1,84+side*1+0.1,at+r+0.15,at+r+0.35,z-0.1,z+0.1):box(at+r+0.15,at+r+0.35,84+side*1-0.1,84+side*1+0.1,z-0.1,z+0.1);
   expect(parts.reduce((v,p)=>v+p.intersect(probe).volume(),0)).toBeGreaterThan(0.007);
  }
 }
});
it('screw channels open into the skeleton tool-access void',()=>{
 const p={...defaultPlate,width:1,depth:1,style:'skeletonized' as const,connectScrews:true};const plate=buildPlate(p);
 expect(plate.intersect(box(10,12,19,23,1,5)).volume()).toBe(0);
});
it('thin drawer axes and leading half cells split with screw seams',()=>{
 for(const [drawerW,drawerD,bedX,bedY] of [[200,100,100,100],[84,30,60,40],[600,10,220,220]]){
 const result=generate({...structuredClone(DEFAULTS),kind:'plate',plate:{...defaultPlate,style:'skeletonized',connectScrews:true,halfCells:true,drawerW,drawerD,alignX:1,alignY:1},print:{...DEFAULTS.print,split:true,bedX,bedY}});
 expect(result.pieces.length).toBeGreaterThan(1);expect(result.pieces.every(p=>p.fitsBed)).toBe(true);result.pieces.forEach(p=>expect(solid(p).status()).toBe('NoError'));
 }
});
it('new plate options survive URL sanitization',()=>{const s=sanitize({plate:{style:'skeletonized',connectScrews:true}});expect(s.plate.style).toBe('skeletonized');expect(s.plate.connectScrews).toBe(true);});

it('drawer padding bores reach the skeleton access void, and skeleton flat fallback fits',()=>{
 const p={...defaultPlate,drawerW:120,drawerD:84,alignX:1,style:'skeletonized' as const,connectScrews:true};
 const holes=plateConnectionCutters(p);
 expect(holes.some(h=>h.boundingBox().max[0]>46 && h.boundingBox().min[0]<0)).toBe(true);
 const yHoles=plateConnectionCutters({...p,drawerW:84,drawerD:120,alignY:1});
 expect(yHoles.some(h=>h.boundingBox().max[1]>46 && h.boundingBox().min[1]<0)).toBe(true);
 const result=generate({...structuredClone(DEFAULTS),kind:'plate',plate:{...p,width:4,drawerW:0,connectScrews:false},print:{...DEFAULTS.print,split:true,bedX:100,bedY:100,connector:'dovetail'}});
 expect(result.pieces.every(p=>p.fitsBed)).toBe(true);
 expect(result.warnings).toContain('Skeletonized plates use flat seams; enable screw-together edges to join them.');
});
