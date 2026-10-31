import { defaultPlate, plateLayout, type PlateLayout } from '../geometry/baseplate';
import type { PlannerDocument, PlannerItem, Issue } from './document';
import { cellPitches } from '../geometry/bin';
export interface SpacerStrip {x:number;y:number;width:number;depth:number;height:number}
export function planDrawer(doc:PlannerDocument) {
 const original=plateLayout({...defaultPlate,...doc.baseplate,drawerW:doc.drawer.widthMm-2*doc.drawer.fitGapMm,drawerD:doc.drawer.depthMm-2*doc.drawer.fitGapMm});
 const issues:Issue[]=[],gap=doc.drawer.fitGapMm;
 if(original.x.length>doc.drawer.widthMm-2*gap+1e-6||original.y.length>doc.drawer.depthMm-2*gap+1e-6)issues.push({code:'drawer',message:'Drawer is too small for the selected socket grid.'});
 const origin=[gap+original.x.padStart,gap+original.y.padStart] as const;
 const spacers:SpacerStrip[]=[];let plate=original;
 if(doc.baseplate.padding==='spacers'){
  const axis=(a:PlateLayout['x'])=>{let start=0;return {...a,padStart:0,padEnd:0,length:a.cells.reduce((sum,n)=>sum+n,0),centres:a.cells.map(n=>{const at=start+n/2;start+=n;return at;})};};
  plate={...original,x:axis(original.x),y:axis(original.y)};
  const add=(x:number,y:number,width:number,depth:number,thickness:number)=>{if(width<=1e-6||depth<=1e-6)return;if(thickness<2){issues.push({code:'clearance',message:`${thickness.toFixed(2)} mm gap is assembly clearance (no spacer).`});return;}spacers.push({x,y,width,depth,height:plate.height});};
  add(gap,gap,original.x.padStart,original.y.length,original.x.padStart);
  add(origin[0]+plate.x.length,gap,original.x.padEnd,original.y.length,original.x.padEnd);
  add(origin[0],gap,plate.x.length,original.y.padStart,original.y.padStart);
  add(origin[0],origin[1]+plate.y.length,plate.x.length,original.y.padEnd,original.y.padEnd);
 }
 return {plateLayout:plate,gridOrigin:origin,plateOrigin:doc.baseplate.padding==='spacers'?origin:[gap,gap] as const,spacers,issues};
}
export function footprint(item:PlannerItem) {return item.rotation===90?{w2:item.d2,d2:item.w2}:{w2:item.w2,d2:item.d2};}
export function socketRun(cells:number[],start2:number,size2:number,required=cellPitches(size2/2)):boolean {let start=0;for(let i=0;i<cells.length;i++){if(Math.abs(start-start2*21)<1e-6)return required.every((pitch,j)=>cells[i+j]===pitch);start+=cells[i];}return false;}
/** Multiple feet need clearance above the socket ridges, including half-cell feet. */
export function seatingOffset(bottom: number, width: number, depth: number): number {
  const feet = cellPitches(width).length * cellPitches(depth).length;
  return bottom + (feet > 1 ? 0.25 : 0);
}
