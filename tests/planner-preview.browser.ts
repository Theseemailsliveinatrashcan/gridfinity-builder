import type { WorkerResponse } from '../src/worker';
import { defaultPlanner } from '../src/planner/document';
const workers:FakeWorker[]=[];
class FakeWorker {
 onmessage:((event:MessageEvent<WorkerResponse>)=>void)|null=null;
 onerror:((event:ErrorEvent)=>void)|null=null;onmessageerror:(()=>void)|null=null;
 jobs:{id:number}[]=[];terminated=false;
 constructor(){workers.push(this);}
 postMessage(job:{id:number}){this.jobs.push(job);}
 terminate(){this.terminated=true;}
 reply(){const job=this.jobs.at(-1)!;this.onmessage?.(new MessageEvent('message',{data:{id:job.id,ok:true,ms:1,result:{size:[1,1,1],warnings:[],info:[],pieces:[{name:'bin',min:[0,0,0],max:[1,1,1],fitsBed:true,volume:1,positions:new Float32Array([0,0,0,1,0,0,0,1,0]),indices:new Uint32Array([0,1,2])}]}}}));}
}
Object.defineProperty(window,'Worker',{value:FakeWorker,configurable:true});
await import('../src/main');
const pause=()=>new Promise(resolve=>setTimeout(resolve,220));
export async function runPreviewLifecycleChecks(){
 const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('#planner-panel button')].find(b=>b.textContent===text)!.click();
 const empty=()=>{if(document.querySelector('#downloads')!.children.length||document.querySelector('.filament'))throw new Error('Empty planner retained downloads or filament.');};
 document.querySelector<HTMLButtonElement>('#planner-mode')!.click();button('Add bin');await pause();
 const canvas=document.querySelector<HTMLCanvasElement>('#viewport canvas')!;
 const blank=document.querySelector('.fallback-note')?canvas.toDataURL():undefined;
 let worker=workers.at(-1)!;if(!worker.jobs.length)throw new Error('No preview was queued.');worker.reply();
 if(blank && canvas.toDataURL()===blank)throw new Error('Preview did not draw the test mesh.');
 if(!document.querySelector('#downloads button'))throw new Error('Successful preview did not create downloads.');
 // Queue a second result, delete while it is in flight, then deliver its stale reply.
 const scoop=document.querySelector<HTMLInputElement>('#planner-panel [data-key="bin.scoop"]')!;scoop.value='0.4';scoop.dispatchEvent(new Event('input'));await pause();worker=workers.at(-1)!;
 button('Delete');if(!worker.terminated)throw new Error('In-flight preview was not terminated.');worker.reply();empty();if(blank && canvas.toDataURL()!==blank)throw new Error('Empty planner retained the old mesh.');
 button('Add bin');await pause();worker=workers.at(-1)!;
 const file=document.querySelector<HTMLInputElement>('#planner-panel input[type=file]')!,dt=new DataTransfer();dt.items.add(new File([JSON.stringify(defaultPlanner)],'layout.json',{type:'application/json'}));file.files=dt.files;file.dispatchEvent(new Event('change'));await pause();
 if(!worker.terminated)throw new Error('Empty import did not terminate the in-flight preview.');worker.reply();empty();
 // Deleting before debounce expiry must never submit a new job.
 const before=workers.reduce((sum,w)=>sum+w.jobs.length,0);button('Add bin');button('Delete');await pause();
 if(workers.reduce((sum,w)=>sum+w.jobs.length,0)!==before)throw new Error('Deleted item escaped the debounce.');
 return {deletionClears:true,emptyImportClears:true,staleRepliesIgnored:true,debounceCancelled:true};
}
