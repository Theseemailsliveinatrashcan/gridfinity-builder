import type { GenerateRequest, GenerateResult, GeometryOptions } from '../geometry/generate';
import { sanitize } from '../state';
export const GEOMETRY_VERSION='planner-b-1',CACHE_LIMIT=64*1024*1024;
export interface Job {req:GenerateRequest;options?:GeometryOptions;purpose:'preview'|'print'}
export interface BatchRequest extends Job {type:'generate';batchId:number;jobId:number;key:string}
export type BatchReply={type:'result';batchId:number;jobId:number;key:string;result:GenerateResult;ms:number}|{type:'error';batchId:number;jobId:number;key:string;error:string};
function canonical(value:unknown):string {if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical((value as Record<string,unknown>)[key])).join(',')+'}';return JSON.stringify(value);}
export function jobKey(job:Job):string {const req=sanitize(job.req);return canonical({version:GEOMETRY_VERSION,purpose:job.purpose,kind:req.kind,params:req[req.kind],print:req.print,options:job.options??{}});}
export function resultBytes(result:GenerateResult):number {const buffers=new Set<ArrayBufferLike>();for(const p of result.pieces){buffers.add(p.positions.buffer);buffers.add(p.indices.buffer);}return [...buffers].reduce((n,b)=>n+b.byteLength,0);}
export class ResultCache {
 private pinned?:string;
 pin(key?:string){this.pinned=key;}
 private entries=new Map<string,{result:GenerateResult;bytes:number}>();bytes=0;
 constructor(readonly limit=CACHE_LIMIT){}
 get(key:string):GenerateResult|undefined {const item=this.entries.get(key);if(!item)return;this.entries.delete(key);this.entries.set(key,item);return item.result;}
 set(key:string,result:GenerateResult):boolean {const old=this.entries.get(key);if(old){this.bytes-=old.bytes;this.entries.delete(key);}const bytes=resultBytes(result);if(bytes>this.limit)return false;while(this.bytes+bytes>this.limit){const first=[...this.entries.keys()].find(key=>key!==this.pinned);if(first===undefined)return false;this.bytes-=this.entries.get(first)!.bytes;this.entries.delete(first);}this.entries.set(key,{result,bytes});this.bytes+=bytes;return true;}
 has(key:string){return this.entries.has(key);}
}
export interface WorkerLike {postMessage(data:BatchRequest):void;terminate():void;onmessage:((event:MessageEvent<BatchReply>)=>void)|null;onerror:((event:ErrorEvent)=>void)|null;onmessageerror?:(()=>void)|null}
export interface BatchCallbacks {progress:(completed:number,total:number)=>void;updated:()=>void;error:(key:string,message:string)=>void}
export class BatchQueue {
 readonly cache:ResultCache;private worker?:WorkerLike;private batchId=0;private nextId=0;private queue:{key:string;job:Job}[]=[];private active?:{key:string;id:number};private completed=0;private total=0;private callbacks?:BatchCallbacks;private timeout?:ReturnType<typeof setTimeout>;
 constructor(private factory:()=>WorkerLike=()=>new Worker(new URL('../worker.ts',import.meta.url),{type:'module'}) as unknown as WorkerLike,cache=new ResultCache()){this.cache=cache;}
 private create(){const worker=this.factory();worker.onmessage=e=>{if(worker!==this.worker)return;const msg=e.data;if(msg.batchId!==this.batchId||msg.jobId!==this.active?.id||msg.key!==this.active.key)return;clearTimeout(this.timeout);if(msg.type==='result'){if(!this.cache.set(msg.key,msg.result))this.callbacks?.error(msg.key,'Preview does not fit in the cache budget; showing a footprint proxy.');}else this.callbacks?.error(msg.key,msg.error);this.active=undefined;this.completed++;this.callbacks?.progress(this.completed,this.total);this.callbacks?.updated();this.pump();};worker.onerror=e=>{if(worker!==this.worker)return;e.preventDefault?.();this.fail('Geometry worker failed.');};worker.onmessageerror=()=>{if(worker===this.worker)this.fail('Could not read geometry worker reply.');};return worker;}
 private fail(message:string){clearTimeout(this.timeout);const key=this.active?.key;if(key)this.callbacks?.error(key,message);this.worker?.terminate();this.worker=undefined;if(this.active){this.completed++;this.active=undefined;this.callbacks?.progress(this.completed,this.total);this.callbacks?.updated();}this.pump();}
 start(jobs:Job[],callbacks:BatchCallbacks):number {this.cancel();this.callbacks=callbacks;const unique=new Map(jobs.map(input=>{const job={...structuredClone(input),req:sanitize(input.req)};return [jobKey(job),job] as const;}));this.total=unique.size;this.completed=0;for(const [key,job]of unique){if(this.cache.has(key))this.completed++;else this.queue.push({key,job});}callbacks.progress(this.completed,this.total);callbacks.updated();this.pump();return this.batchId;}
 private pump(){if(this.active||!this.queue.length)return;const {key,job}=this.queue.shift()!;const id=++this.nextId;this.active={key,id};(this.worker??=this.create()).postMessage({...job,type:'generate',batchId:this.batchId,jobId:id,key});this.timeout=setTimeout(()=>this.fail('Geometry job timed out.'),30_000);}
 cancel(){this.batchId++;clearTimeout(this.timeout);this.queue=[];this.active=undefined;this.callbacks=undefined;this.worker?.terminate();this.worker=undefined;}
 dispose(){this.batchId++;clearTimeout(this.timeout);this.queue=[];this.callbacks=undefined;this.worker?.terminate();this.worker=undefined;}
}
