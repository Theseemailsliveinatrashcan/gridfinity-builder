import { DEFAULTS, sanitize } from '../state';
import { binLayout, cellPitches, validateBin, vaseBinParams, type BinParams } from '../geometry/bin';
import { holderBinParams, type HolderParams } from '../geometry/holder';
import { dividerLayout } from '../geometry/dividers';
import type { PlateParams } from '../geometry/baseplate';
import type { GenerateRequest, PrintSettings } from '../geometry/generate';
import { footprint, planDrawer, socketRun } from './layout';
export interface Issue {code:string;message:string;itemId?:string}
type ItemBase={id:string;name:string;x2:number;y2:number;w2:number;d2:number;rotation:0|90};
export type PlannerItem=ItemBase & ({kind:'bin';params:Omit<BinParams,'width'|'depth'>}|{kind:'holder';params:Omit<HolderParams,'width'|'depth'>});
export interface PlannerDocument {version:1;drawer:{widthMm:number;depthMm:number;heightMm?:number;fitGapMm:number};print:PrintSettings;baseplate:Pick<PlateParams,'style'|'magnets'|'mountHoles'|'halfCells'|'alignX'|'alignY'> & {padding:'integral'};items:PlannerItem[]}
export type ParseResult={ok:true;document:PlannerDocument;issues:Issue[]}|{ok:false;issues:Issue[]};
export const defaultPlanner:PlannerDocument={version:1,drawer:{widthMm:300,depthMm:200,fitGapMm:0.5},print:structuredClone(DEFAULTS.print),baseplate:{style:'thin',magnets:false,mountHoles:'none',halfCells:false,alignX:0,alignY:0,padding:'integral'},items:[]};
const record=(v:unknown):Record<string,unknown>=>v&&typeof v==='object'&&!Array.isArray(v)?v as Record<string,unknown>:{};
const bounded=(v:unknown,fallback:number,min:number,max:number)=>typeof v==='number'&&Number.isFinite(v)?Math.min(max,Math.max(min,v)):fallback;
export function itemRequest(item:PlannerItem,print:PrintSettings):GenerateRequest {
  return sanitize({...structuredClone(DEFAULTS),kind:item.kind,print,[item.kind]:{...item.params,width:item.w2/2,depth:item.d2/2}});
}
export function itemFromRequest(item:PlannerItem,request:GenerateRequest):PlannerItem {
  const p=request[item.kind],{width,depth,...params}=p;
  return {...item,w2:Math.round(width*2),d2:Math.round(depth*2),params} as PlannerItem;
}
export function validatePlacement(doc:PlannerDocument,candidate:PlannerItem):Issue[] {
  const issues:Issue[]=[],add=(code:string,message:string)=>issues.push({code,message,itemId:candidate.id});
  if(![candidate.x2,candidate.y2,candidate.w2,candidate.d2].every(Number.isInteger)||candidate.x2<0||candidate.y2<0||candidate.w2<1||candidate.d2<1||candidate.w2>24||candidate.d2>24||![0,90].includes(candidate.rotation)) {add('bounds','Use integer half-unit ticks and sizes from 0.5 to 12 units.');return issues;}
  const {plateLayout:L}=planDrawer(doc),f=footprint(candidate);
  if(!socketRun(L.x.cells,candidate.x2,f.w2,candidate.rotation===90?cellPitches(candidate.d2/2).reverse():cellPitches(candidate.w2/2))||!socketRun(L.y.cells,candidate.y2,f.d2))add('socket','The footprint must match a contiguous run of baseplate sockets.');
  for(const other of doc.items)if(other.id!==candidate.id){const b=footprint(other);if(candidate.x2<other.x2+b.w2&&candidate.x2+f.w2>other.x2&&candidate.y2<other.y2+b.d2&&candidate.y2+f.d2>other.y2)add('collision',`Overlaps ${other.name}.`);}
  try {
    const req=itemRequest(candidate,doc.print);
    const p=candidate.kind==='bin'?vaseBinParams(req.bin):holderBinParams(req.holder);
    // Holder depth is checked above; a pocket deck is intentionally solid.
    validateBin(candidate.kind==='holder' ? {...p,solid:true} : p).forEach(message=>add('parameters',message));dividerLayout(p);
    const layout=binLayout(p);
    if(!p.vase&&p.labelSlot==='card'&&p.withLid&&layout.floorZ+12.8>layout.top-0.5)add('parameters','Bin too short for label cards with a lid.');
    const nx=Math.max(1,Math.round(p.compartmentsX));
    const compW=(layout.cavW-(nx-1)*1.2)/nx;
    if(!p.vase&&p.labelSlot==='card'&&compW<24)add('parameters','Compartments too narrow for label cards.');
    if(!p.vase&&p.labelSlot==='cullenect'&&compW<17)add('parameters','Compartments too narrow for Cullenect labels.');
    const top=p.withLid&&p.lip==='normal'?layout.top+(p.lidStyle==='stackable'?12:7):layout.top+(p.lip==='normal'?3.8:0);
    if(doc.drawer.heightMm!==undefined&&top+L.bottom+0.25>doc.drawer.heightMm)add('height','Item exceeds the drawer height clearance.');
  }catch(error){add('parameters',error instanceof Error?error.message:String(error));}
  return issues;
}
export function sanitizePlanner(input:unknown):ParseResult {
  const src=record(input);const fail=(message:string):ParseResult=>({ok:false,issues:[{code:'document',message}]});
  if(src.version!==1)return fail('Unsupported planner document version.');
  if(!Array.isArray(src.items)||src.items.length>64)return fail('Layouts support at most 64 items.');
  if(record(src.baseplate).padding && record(src.baseplate).padding!=='integral')return fail('Only integral baseplates are supported in this version.');
  const drawer=record(src.drawer),base=record(src.baseplate),clean=sanitize({plate:base,print:src.print});
  const doc:PlannerDocument={version:1,drawer:{widthMm:bounded(drawer.widthMm,300,42,2000),depthMm:bounded(drawer.depthMm,200,42,2000),fitGapMm:bounded(drawer.fitGapMm,0.5,0,5)},print:clean.print,baseplate:{style:clean.plate.style,magnets:clean.plate.magnets,mountHoles:clean.plate.mountHoles,halfCells:clean.plate.halfCells,alignX:clean.plate.alignX,alignY:clean.plate.alignY,padding:'integral'},items:[]};
  if(drawer.heightMm!==undefined)doc.drawer.heightMm=bounded(drawer.heightMm,100,10,1000);
  const ids=new Set<string>();
  for(const value of src.items){const item=record(value);if(typeof item.id!=='string'||!/^[-\w]{1,64}$/.test(item.id)||ids.has(item.id))return fail('Invalid or duplicate item ID.');ids.add(item.id);
    if(item.kind!=='bin'&&item.kind!=='holder')return fail('Planner items must be bins or holders.');
    const req=sanitize({kind:item.kind,[item.kind]:record(item.params)}),{width:_w,depth:_d,...params}=req[item.kind];
    doc.items.push({id:item.id,name:typeof item.name==='string'?item.name.slice(0,80):item.kind,x2:Math.round(bounded(item.x2,0,0,96)),y2:Math.round(bounded(item.y2,0,0,96)),w2:Math.round(bounded(item.w2,2,1,24)),d2:Math.round(bounded(item.d2,2,1,24)),rotation:item.rotation===90?90:0,kind:item.kind,params} as PlannerItem);
  }
  const issues=[...planDrawer(doc).issues,...doc.items.flatMap(item=>validatePlacement(doc,item))];
  return issues.length?{ok:false,issues}:{ok:true,document:doc,issues};
}
