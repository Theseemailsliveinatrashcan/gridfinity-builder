import { defaultPlate, plateLayout } from '../geometry/baseplate';
import type { PlannerDocument, PlannerItem, Issue } from './document';
import { cellPitches } from '../geometry/bin';
export function planDrawer(doc:PlannerDocument) {
  const plate=plateLayout({...defaultPlate,...doc.baseplate,drawerW:doc.drawer.widthMm-2*doc.drawer.fitGapMm,drawerD:doc.drawer.depthMm-2*doc.drawer.fitGapMm});
  const issues:Issue[]=[];
  if(plate.x.length>doc.drawer.widthMm-2*doc.drawer.fitGapMm+1e-6 || plate.y.length>doc.drawer.depthMm-2*doc.drawer.fitGapMm+1e-6)issues.push({code:'drawer',message:'Drawer is too small for the selected socket grid.'});
  return {plateLayout:plate,gridOrigin:[doc.drawer.fitGapMm+plate.x.padStart,doc.drawer.fitGapMm+plate.y.padStart] as const,spacers:[],issues};
}
export function footprint(item:PlannerItem) {return item.rotation===90?{w2:item.d2,d2:item.w2}:{w2:item.w2,d2:item.d2};}
export function socketRun(cells:number[],start2:number,size2:number,required=cellPitches(size2/2)):boolean { let start=0;
  for(let i=0;i<cells.length;i++) {
    if(Math.abs(start-start2*21)<1e-6)return required.every((pitch,j)=>cells[i+j]===pitch);
    start+=cells[i];
  }
  return false;
}
