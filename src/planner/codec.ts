import { deflateSync, Inflate } from 'fflate';
import { sanitize, type DEFAULTS } from '../state';
import { sanitizePlanner, type PlannerDocument } from './document';
export const MAX_ENCODED=16*1024,MAX_INFLATED=256*1024;
const encoder=new TextEncoder(),decoder=new TextDecoder('utf-8',{fatal:true});
export function parsePlannerJson(text:string):PlannerDocument {
  if(encoder.encode(text).length>MAX_INFLATED)throw new Error('Layout exceeds the 256 KiB JSON limit.');
  const result=sanitizePlanner(JSON.parse(text));if(!result.ok)throw new Error(result.issues.map(i=>i.message).join(' '));return result.document;
}
export function encodePlanner(doc:PlannerDocument):string {
  const text=JSON.stringify(doc);parsePlannerJson(text);
  const bytes=deflateSync(encoder.encode(text));
  const hash='#p1.'+btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
  if(hash.length>MAX_ENCODED)throw new Error('Layout exceeds the 16 KiB share-link limit; export layout.json instead.');return hash;
}
export function decodePlanner(hash:string):{mode:'planner';document:PlannerDocument}|{mode:'part';request:typeof DEFAULTS} {
  if(hash.length>MAX_ENCODED)throw new Error('Share link exceeds the 16 KiB limit.');
  const value=hash.replace(/^#/,'');
  if(!value.startsWith('p1.')){
    if(/^p\d+\./.test(value))throw new Error('Unsupported planner link version.');
    return {mode:'part',request:sanitize(value?JSON.parse(decodeURIComponent(atob(value))):{})};
  }
  const payload=value.slice(3);if(!/^[\w-]+$/.test(payload)||payload.length%4===1)throw new Error('Malformed planner link.');
  const bytes=Uint8Array.from(atob(payload.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));
  const chunks:Uint8Array[]=[];let total=0,finished=false;
  const stream=new Inflate((chunk,final)=>{total+=chunk.length;if(total>MAX_INFLATED)throw new Error('Layout exceeds the 256 KiB inflated limit.');chunks.push(chunk);finished=final;});
  for(let offset=0;offset<bytes.length;offset+=32)stream.push(bytes.subarray(offset,offset+32),offset+32>=bytes.length);
  if(!finished)throw new Error('Truncated planner link.');
  const output=new Uint8Array(total);let at=0;for(const chunk of chunks){output.set(chunk,at);at+=chunk.length;}
  return {mode:'planner',document:parsePlannerJson(decoder.decode(output))};
}
