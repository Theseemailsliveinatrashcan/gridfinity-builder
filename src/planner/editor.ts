import { SECTIONS } from '../fields';
import { DEFAULTS } from '../state';
import type { GenerateRequest } from '../geometry/generate';
import { mountPartForm } from '../ui/part-form';
import { defaultPlanner, itemFromRequest, itemRequest, sanitizePlanner, validatePlacement, type PlannerDocument, type PlannerItem } from './document';
import { footprint, planDrawer } from './layout';
import { encodePlanner, MAX_INFLATED, parsePlannerJson } from './codec';
const NS='http://www.w3.org/2000/svg';
const element=<K extends keyof HTMLElementTagNameMap>(tag:K,text?:string)=>{const el=document.createElement(tag);if(text)el.textContent=text;return el;};
export interface EditorOptions {document?:PlannerDocument;onPreview:(request:GenerateRequest)=>void;onEmptySelection:()=>void;onDocument?:(document:PlannerDocument)=>void}
export function mountPlanner(panel:HTMLElement,canvas:HTMLElement,options:EditorOptions):()=>void {
 let doc=structuredClone(options.document??defaultPlanner),selected=doc.items[0]?.id,disposeForm:(()=>void)|undefined,alive=true;
 const errors=element('p');errors.setAttribute('role','status');errors.className='planner-errors';
 const toolbar=element('div'),settings=element('div'),list=element('select'),coords=element('div'),details=element('div');list.setAttribute('aria-label','Planner items');
 const svg=document.createElementNS(NS,'svg');svg.classList.add('planner-grid');svg.setAttribute('role','application');svg.setAttribute('aria-label','Drawer layout: select a part, arrow keys move, Shift arrows resize');svg.tabIndex=0;
 const heading=element('h2','Drawer layout');canvas.replaceChildren(heading,svg);
 panel.replaceChildren(toolbar,settings,list,coords,errors,details);
 const message=(text:string)=>{errors.textContent=text;};
 function commit(next:PlannerDocument,keepForm=false):boolean {
  const parsed=sanitizePlanner(next);
  if(!parsed.ok){message([...new Set(parsed.issues.map(i=>i.message))].join(' '));return false;}
  doc=parsed.document;message('');options.onDocument?.(structuredClone(doc));if(keepForm){draw();const item=current();if(item)options.onPreview(itemRequest(item,doc.print));}else render();return true;
 }
 function update(item:PlannerItem,keepForm=false):boolean {const issues=validatePlacement(doc,item);if(issues.length){message(issues.map(i=>i.message).join(' '));return false;}return commit({...doc,items:doc.items.map(old=>old.id===item.id?item:old)},keepForm);}
 const current=()=>doc.items.find(item=>item.id===selected);
 function button(label:string,action:()=>void){const b=element('button',label);b.type='button';b.onclick=action;toolbar.append(b);return b;}
 function add(kind:'bin'|'holder',source?:PlannerItem){
  if(doc.items.length>=64){message('Layouts support at most 64 items.');return;}
  const {width:_w,depth:_d,...params}=DEFAULTS[kind];
  const item=(source?{...structuredClone(source)}:{kind,params,w2:2,d2:2,rotation:0}) as PlannerItem;
  item.id=crypto.randomUUID();item.name=source?`${source.name} copy`:kind==='bin'?'Bin':'Holder';
  const L=planDrawer(doc).plateLayout;
  for(let y2=0;y2<L.y.length/21;y2++)for(let x2=0;x2<L.x.length/21;x2++){
   const candidate={...item,x2,y2};if(!validatePlacement(doc,candidate).length){selected=item.id;commit({...doc,items:[...doc.items,candidate]});return;}
  }
  message('No compatible free sockets for this item.');
 }
 button('Add bin',()=>add('bin'));button('Add holder',()=>add('holder'));button('Duplicate',()=>{const item=current();if(item)add(item.kind,item);});
 button('Rotate 90°',()=>{const item=current();if(item)update({...item,rotation:item.rotation===0?90:0});});
 button('Delete',()=>{if(current()){const next={...doc,items:doc.items.filter(i=>i.id!==selected)};selected=next.items[0]?.id;commit(next);}});
 function download(name:string,text:string){const url=URL.createObjectURL(new Blob([text],{type:'application/json'}));const a=element('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
 button('Export layout.json',()=>download('layout.json',JSON.stringify(doc,null,2)));
 const file=element('input');file.type='file';file.accept='.json,application/json';file.hidden=true;
 file.onchange=async()=>{const picked=file.files?.[0];if(!picked)return;try{if(picked.size>MAX_INFLATED)throw new Error('Layout exceeds the 256 KiB JSON limit.');const next=parsePlannerJson(await picked.text());selected=next.items[0]?.id;commit(next);}catch(error){message(String(error));}finally{file.value='';}};
 toolbar.append(file);button('Import layout.json',()=>file.click());
 button('Share link',()=>{try{const hash=encodePlanner(doc);history.replaceState(null,'',hash);message('Layout saved in the address bar. Copy the URL to share.');}catch(error){message(String(error));}});
 list.onchange=()=>{selected=list.value;render();};
 function number(parent:HTMLElement,label:string,value:number,change:(value:number)=>boolean|void,step=1){const wrap=element('label',label),input=element('input');input.type='number';input.value=String(value);input.step=String(step);input.setAttribute('aria-label',label);input.onchange=()=>{const n=Number(input.value);if(!Number.isFinite(n)||change(n)===false)input.value=String(value);};wrap.append(input);parent.append(wrap);}
 function render(){
  disposeForm?.();settings.replaceChildren();coords.replaceChildren();details.replaceChildren();list.replaceChildren();
  number(settings,'Drawer width (mm)',doc.drawer.widthMm,n=>commit({...doc,drawer:{...doc.drawer,widthMm:n}}));
  number(settings,'Drawer depth (mm)',doc.drawer.depthMm,n=>commit({...doc,drawer:{...doc.drawer,depthMm:n}}));
  number(settings,'Drawer height (mm, 0 = off)',doc.drawer.heightMm??0,n=>commit({...doc,drawer:{...doc.drawer,heightMm:n>0?n:undefined}}));
  number(settings,'Fit gap per side (mm)',doc.drawer.fitGapMm,n=>commit({...doc,drawer:{...doc.drawer,fitGapMm:n}}),0.1);
  const plateForm=element('div');settings.append(plateForm);
  const plateSection=SECTIONS.filter(s=>s.title==='Baseplate').map(s=>({...s,fields:s.fields.filter(f=>['style','magnets','mountHoles','halfCells','alignX','alignY'].includes(f.key))}));
  // Keep the baseplate controls on the same form path as single-part mode.
  mountPartForm(plateForm,{sections:plateSection,getRequest:()=>({...structuredClone(DEFAULTS),kind:'plate',plate:{...DEFAULTS.plate,...doc.baseplate,drawerW:doc.drawer.widthMm,drawerD:doc.drawer.depthMm}}),commit:req=>commit({...doc,baseplate:{style:req.plate.style,magnets:req.plate.magnets,mountHoles:req.plate.mountHoles,halfCells:req.plate.halfCells,alignX:req.plate.alignX,alignY:req.plate.alignY,padding:'integral'}})});
  const printForm=element('div');settings.append(printForm);
  mountPartForm(printForm,{sections:SECTIONS.filter(s=>s.title==='Print bed'),getRequest:()=>({...structuredClone(DEFAULTS),print:doc.print}),commit:req=>commit({...doc,print:req.print})});
  for(const item of doc.items)list.add(new Option(item.name,item.id,false,item.id===selected));
  list.hidden=!doc.items.length;const item=current();
  if(item){
   const id=item.id;
   const edit=(patch:Partial<PlannerItem>)=>{const latest=doc.items.find(item=>item.id===id);return latest?update({...latest,...patch} as PlannerItem):false;};
   const name=element('input');name.value=item.name;name.setAttribute('aria-label','Item name');name.onchange=()=>edit({name:name.value});coords.append(name);
   number(coords,'X (21 mm ticks)',item.x2,n=>edit({x2:Math.round(n)}));number(coords,'Y (21 mm ticks)',item.y2,n=>edit({y2:Math.round(n)}));
   number(coords,'Width (half units)',item.w2,n=>edit({w2:Math.round(n)}));number(coords,'Depth (half units)',item.d2,n=>edit({d2:Math.round(n)}));
   disposeForm=mountPartForm(details,{getRequest:()=>itemRequest(current()!,doc.print),sections:SECTIONS.filter(s=>s.title!=='Print bed'),commit:req=>{
    const next=itemFromRequest(current()!,req);const issues=validatePlacement(doc,next);if(issues.length){message(issues.map(i=>i.message).join(' '));return false;}return update(next,next.w2===current()!.w2 && next.d2===current()!.d2);
   }});
   options.onPreview(itemRequest(item,doc.print));
  }else {options.onEmptySelection();message('Add a bin or holder. Select a part to preview it.');}
  draw();
 }
 function draw(){
  svg.replaceChildren();svg.setAttribute('viewBox',`-5 -5 ${doc.drawer.widthMm+10} ${doc.drawer.depthMm+10}`);
  const rect=(x:number,y:number,w:number,h:number,cls:string)=>{const r=document.createElementNS(NS,'rect');for(const [key,value]of Object.entries({x,y,width:w,height:h,class:cls}))r.setAttribute(key,String(value));svg.append(r);return r;};
  rect(0,0,doc.drawer.widthMm,doc.drawer.depthMm,'drawer-outline');const L=planDrawer(doc),gap=doc.drawer.fitGapMm;
  rect(gap,gap,L.plateLayout.x.length,L.plateLayout.y.length,'plate-outline');
  let x=L.gridOrigin[0];for(const w of L.plateLayout.x.cells){let y=L.gridOrigin[1];for(const d of L.plateLayout.y.cells){rect(x,y,w,d,'socket-outline');y+=d;}x+=w;}
  for(const item of doc.items){const f=footprint(item),x=L.gridOrigin[0]+item.x2*21,y=L.gridOrigin[1]+item.y2*21;
   const r=rect(x,y,f.w2*21,f.d2*21,item.id===selected?'planner-item selected':'planner-item');r.setAttribute('aria-label',item.name);r.dataset.id=item.id;
   const title=document.createElementNS(NS,'title');title.textContent=item.name;r.append(title);r.onpointerdown=e=>startDrag(e,item,false);
   if(item.id===selected){const matrix=svg.getScreenCTM(),mmPerPixel=1/Math.max(0.001,matrix?.a??1);
    const size=Math.max(42*0.3,12*mmPerPixel),target=Math.max(size,44*mmPerPixel);
    rect(x+f.w2*21-size/2,y+f.d2*21-size/2,size,size,'resize-handle');
    const hit=rect(x+f.w2*21-target/2,y+f.d2*21-target/2,target,target,'resize-hit');hit.onpointerdown=e=>startDrag(e,item,true);}
  }
 }
 function point(event:PointerEvent){const m=svg.getScreenCTM();if(!m)throw new Error('Grid unavailable');return new DOMPoint(event.clientX,event.clientY).matrixTransform(m.inverse());}
 function startDrag(event:PointerEvent,item:PlannerItem,resize:boolean){
  if(event.button!==0)return;event.preventDefault();const start=point(event),initial=structuredClone(item);selected=item.id;
  svg.focus();svg.setPointerCapture(event.pointerId);let ghost:SVGRectElement|undefined,candidate=item;
  const move=(e:PointerEvent)=>{const p=point(e),dx=Math.round((p.x-start.x)/21),dy=Math.round((p.y-start.y)/21);
   candidate=resize?{...initial,w2:initial.w2+(initial.rotation===90?dy:dx),d2:initial.d2+(initial.rotation===90?dx:dy)}:{...initial,x2:initial.x2+dx,y2:initial.y2+dy};
   ghost?.remove();ghost=document.createElementNS(NS,'rect');const f=footprint(candidate),L=planDrawer(doc);for(const [key,value]of Object.entries({x:L.gridOrigin[0]+candidate.x2*21,y:L.gridOrigin[1]+candidate.y2*21,width:f.w2*21,height:f.d2*21,class:validatePlacement(doc,candidate).length?'planner-ghost invalid':'planner-ghost'}))ghost.setAttribute(key,String(value));svg.append(ghost);
  };
  const end=(e:PointerEvent)=>{svg.removeEventListener('pointermove',move);svg.removeEventListener('pointerup',end);svg.removeEventListener('pointercancel',cancel);ghost?.remove();if(svg.hasPointerCapture(e.pointerId))svg.releasePointerCapture(e.pointerId);if(!update(candidate))render();};
  const cancel=()=>{svg.removeEventListener('pointermove',move);svg.removeEventListener('pointerup',end);svg.removeEventListener('pointercancel',cancel);ghost?.remove();render();};
  svg.addEventListener('pointermove',move);svg.addEventListener('pointerup',end);svg.addEventListener('pointercancel',cancel);
 }
 svg.onkeydown=e=>{const item=current();if(!item||!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Delete'].includes(e.key))return;e.preventDefault();if(e.key==='Delete'){const items=doc.items.filter(i=>i.id!==item.id);selected=items[0]?.id;commit({...doc,items});return;}const dx=e.key==='ArrowLeft'?-1:e.key==='ArrowRight'?1:0,dy=e.key==='ArrowUp'?-1:e.key==='ArrowDown'?1:0;
  let candidate=item;
  for(let step=1;step<=2;step++){
    candidate=e.shiftKey?{...item,w2:item.w2+(item.rotation===90?dy:dx)*step,d2:item.d2+(item.rotation===90?dx:dy)*step}:{...item,x2:item.x2+dx*step,y2:item.y2+dy*step};
    if(!validatePlacement(doc,candidate).length)break;
  }
  update(candidate);
 };
 const observer=new ResizeObserver(()=>draw());observer.observe(svg);
 render();return ()=>{if(!alive)return;alive=false;observer.disconnect();disposeForm?.();panel.replaceChildren();canvas.replaceChildren();};
}
