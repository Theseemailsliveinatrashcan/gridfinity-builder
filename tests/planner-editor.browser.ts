import { mountPlanner } from '../src/planner/editor';
import { defaultPlanner, type PlannerDocument } from '../src/planner/document';
export function runPlannerEditorChecks() {
 const panel=document.createElement('div'),canvas=document.createElement('div');document.body.append(panel,canvas);
 let latest:PlannerDocument=structuredClone(defaultPlanner),empty=0;
 const dispose=mountPlanner(panel,canvas,{onPreview:()=>{},onEmptySelection:()=>empty++,onDocument:doc=>{latest=doc;}});
 const button=(name:string)=>[...panel.querySelectorAll('button')].find(b=>b.textContent===name)!.click();
 const field=(key:string)=>panel.querySelector<HTMLInputElement>(`[data-key="${key}"]`)!;
 const edit=(label:string,value:string)=>{const input=panel.querySelector<HTMLInputElement>(`[aria-label="${label}"]`)!;input.value=value;input.dispatchEvent(new Event('change'));};
 const changeParameter=()=>{const input=field('bin.scoop');input.value='0.4';input.dispatchEvent(new Event('input'));};
 const check=()=>{const item=latest.items[0];if(item?.kind!=='bin'||item.params.scoop!==0.4)throw new Error('Coordinate/name edit restored stale parameters.');};
 button('Add holder');if(latest.items[0]?.kind!=='holder')throw new Error('Add holder failed.');button('Delete');
 button('Add bin');changeParameter();edit('X (21 mm ticks)','2');check();
 // Each form render gets a fresh closure, so re-edit before every stale-handler check.
 field('bin.scoop').value='0';field('bin.scoop').dispatchEvent(new Event('input'));changeParameter();edit('Item name','Renamed');check();
 field('bin.scoop').value='0';field('bin.scoop').dispatchEvent(new Event('input'));changeParameter();edit('Width (half units)','4');check();
 const parametersPreserved=latest.items[0].name==='Renamed'&&latest.items[0].x2===2&&latest.items[0].w2===4;
 const previousEmpty=empty;button('Delete');if(empty!==previousEmpty+1)throw new Error('Deletion did not clear selection.');
 dispose();panel.remove();canvas.remove();return {holderAdded:true,parametersPreserved,emptyCallback:true};
}
