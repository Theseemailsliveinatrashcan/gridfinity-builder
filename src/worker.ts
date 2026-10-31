/// <reference lib="webworker" />
import wasmUrl from 'manifold-3d/manifold.wasm?url';
import { generate, type GenerateRequest } from './geometry/generate';
import { freeAll, initKernel } from './geometry/kernel';
import type { BatchRequest, BatchReply } from './planner/batch';
const ready=initKernel(()=>wasmUrl);
export type WorkerResponse=|{id:number;ok:true;result:ReturnType<typeof generate>;ms:number}|{id:number;ok:false;error:string};
self.onmessage=async(e:MessageEvent<{id:number;req:GenerateRequest}|BatchRequest>)=>{
 const data=e.data;const batch='type'in data&&data.type==='generate';
 try{await ready;const start=performance.now(),result=generate(data.req,batch?data.options:undefined),ms=performance.now()-start;
 const transfer=[...new Set(result.pieces.flatMap(p=>[p.positions.buffer,p.indices.buffer]))];
 const reply:WorkerResponse|BatchReply=batch?{type:'result',batchId:data.batchId,jobId:data.jobId,key:data.key,result,ms}:{id:("id" in data?data.id:0),ok:true,result,ms};
 (self as unknown as Worker).postMessage(reply,transfer);
 }catch(error){const message=error instanceof Error?error.message:String(error);(self as unknown as Worker).postMessage(batch?{type:'error',batchId:data.batchId,jobId:data.jobId,key:data.key,error:message}:{id:("id" in data?data.id:0),ok:false,error:message});}finally{freeAll();}
};
