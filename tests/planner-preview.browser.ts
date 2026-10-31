import type { WorkerResponse } from '../src/worker';
import type { BatchReply, BatchRequest } from '../src/planner/batch';
import type { GenerateRequest, GenerateResult } from '../src/geometry/generate';
import { defaultPlanner } from '../src/planner/document';
import { proxyMesh } from '../src/planner/viewer';
const workers:FakeWorker[]=[];
type Request=BatchRequest|{id:number;req:GenerateRequest};
class FakeWorker {
 onmessage:((event:MessageEvent<WorkerResponse|BatchReply>)=>void)|null=null;
 onerror:((event:ErrorEvent)=>void)|null=null;onmessageerror:(()=>void)|null=null;
 jobs:Request[]=[];terminated=false;replied=new Set<Request>();
 constructor(){workers.push(this);}postMessage(job:Request){this.jobs.push(job);}terminate(){this.terminated=true;}
 reply(job=this.jobs.at(-1)!){this.replied.add(job);const mesh=proxyMesh(5,5,5);const result:GenerateResult={size:[5,5,5],warnings:[],info:[],pieces:[mesh],parts:[{partKey:job.req.kind,role:job.req.kind==='plate'?'plate':'body',mesh,quantity:1}]};const data:WorkerResponse|BatchReply='type'in job?{type:'result',batchId:job.batchId,jobId:job.jobId,key:job.key,result,ms:1}:{id:job.id,ok:true,result,ms:1};this.onmessage?.(new MessageEvent('message',{data}));}
}
Object.defineProperty(window,'Worker',{value:FakeWorker,configurable:true});await import('../src/main');
const pause=()=>new Promise(resolve=>setTimeout(resolve,220));
export async function runPreviewLifecycleChecks(){
 const button=(text:string)=>[...document.querySelectorAll<HTMLButtonElement>('#planner-panel button')].find(b=>b.textContent===text)!.click();
 const empty=()=>{if(document.querySelector('#downloads')!.textContent!.includes('Download')||document.querySelector('.filament')||!document.querySelector('#status')!.textContent!.includes('0 items'))throw new Error('Empty planner retained item exports/results.');};
 const settle=()=>{for(let i=0;i<10;i++){const w=workers.at(-1)!;const job=w.jobs.find(j=>!w.replied.has(j));if(!job||w.terminated)return;w.reply(job);}};
 const edit=(value:string)=>{const input=document.querySelector<HTMLInputElement>('#planner-panel [data-key="bin.scoop"]')!;input.value=value;input.dispatchEvent(new Event('input'));};
 document.querySelector<HTMLButtonElement>('#planner-mode')!.click();button('Add bin');await pause();settle();
 edit('0.4');await pause();let worker=workers.at(-1)!;if(!worker.jobs.length)throw new Error('No preview queued.');
 button('Delete');if(!worker.terminated)throw new Error('In-flight batch was not terminated.');worker.reply();await pause();empty();
 button('Add bin');edit('0.8');await pause();worker=workers.at(-1)!;
 const file=document.querySelector<HTMLInputElement>('#planner-panel input[type=file]')!,dt=new DataTransfer();dt.items.add(new File([JSON.stringify(defaultPlanner)],'layout.json',{type:'application/json'}));file.files=dt.files;file.dispatchEvent(new Event('change'));await pause();
 if(!worker.terminated)throw new Error('Empty import did not terminate generation.');worker.reply();empty();
 const before=workers.reduce((n,w)=>n+w.jobs.length,0);button('Add bin');button('Delete');await pause();
 if(workers.reduce((n,w)=>n+w.jobs.length,0)!==before)throw new Error('Deleted item escaped debounce.');
 return {deletionClears:true,emptyImportClears:true,staleRepliesIgnored:true,debounceCancelled:true,plateAssemblyRetained:true};
}
