import * as THREE from 'three';
import type { MeshOut, PartTransform, GenerateRequest } from '../geometry/generate';
import { transformMesh } from '../geometry/transforms';
import { DEFAULTS } from '../state';
import { itemRequest, type PlannerDocument } from './document';
import { footprint, planDrawer, seatingOffset } from './layout';
import { jobKey, type Job, type ResultCache } from './batch';
export interface PlannedJob {id:string;job:Job;transform:PartTransform}
export interface AssemblyInstance {key:string;mesh:MeshOut;transform:PartTransform;proxy?:boolean}
export function plannerJobs(doc:PlannerDocument):PlannedJob[]{
 const L=planDrawer(doc);const preview=(req:GenerateRequest):GenerateRequest=>({...req,print:{...req.print,split:false}});
 const jobs:PlannedJob[]=[{id:'plate',job:{req:preview({...structuredClone(DEFAULTS),kind:'plate',plate:{...DEFAULTS.plate,...doc.baseplate,drawerW:doc.drawer.widthMm-2*doc.drawer.fitGapMm,drawerD:doc.drawer.depthMm-2*doc.drawer.fitGapMm},print:doc.print}),options:{plateLayout:L.plateLayout},purpose:'preview'},transform:{translation:[...L.plateOrigin,0]}}];
 for(const item of doc.items){const f=footprint(item);jobs.push({id:item.id,job:{req:preview(itemRequest(item,doc.print)),purpose:'preview'},transform:{translation:[L.gridOrigin[0]+(item.x2+f.w2/2)*21,L.gridOrigin[1]+(item.y2+f.d2/2)*21,seatingOffset(L.plateLayout.bottom)],rotation:item.rotation}});}
 L.spacers.forEach((strip,i)=>jobs.push({id:`spacer-${i}`,job:{req:preview({...structuredClone(DEFAULTS),kind:'spacer',print:doc.print}),options:{spacerBounds:[strip.width,strip.depth,strip.height]},purpose:'preview'},transform:{translation:[strip.x,strip.y,0]}}));
 return jobs;
}
export function proxyMesh(width:number,depth:number,height:number):MeshOut {
 const positions=new Float32Array([0,0,0,width,0,0,width,depth,0,0,depth,0,0,0,height,width,0,height,width,depth,height,0,depth,height]);
 const indices=new Uint32Array([0,2,1,0,3,2,4,5,6,4,6,7,0,1,5,0,5,4,1,2,6,1,6,5,2,3,7,2,7,6,3,0,4,3,4,7]);
 return {name:'Pending footprint',positions,indices,min:[0,0,0],max:[width,depth,height],volume:width*depth*height,fitsBed:true};
}
export function assemblyInstances(doc:PlannerDocument,jobs:PlannedJob[],cache:ResultCache,selected?:string,accessories=false):AssemblyInstance[]{
 const instances:AssemblyInstance[]=[];let triangles=0;
 for(const planned of [...jobs].sort((a,b)=>Number(b.id===selected)-Number(a.id===selected))){
  const key=jobKey(planned.job),result=cache.get(key);const parts=result?.parts.filter(p=>accessories||['body','plate','spacer','lid'].includes(p.role));
  const count=parts?.reduce((n,p)=>n+p.mesh.indices.length/3,0)??Infinity;
  const heavy=count>10000&&planned.id!==selected&&planned.id!=='plate';
  if(parts?.length&&!heavy&&(triangles+count<=60000||planned.id===selected||planned.id==='plate')){for(const part of parts){
   // Lids are closed on their own bin; loose card/divider transforms remain parking-only.
   const local=part.assemblyTransform?.translation??(['label-card','divider'].includes(part.role)?part.displayTransform?.translation:undefined)??[0,0,0];const angle=(planned.transform.rotation??0)*Math.PI/180;
   const translation=planned.transform.translation.map((n,i)=>n+(i===0?local[0]*Math.cos(angle)-local[1]*Math.sin(angle):i===1?local[0]*Math.sin(angle)+local[1]*Math.cos(angle):local[2])) as [number,number,number];
   instances.push({key:key+':'+part.partKey,mesh:part.mesh,transform:{translation,rotation:planned.transform.rotation}});
  }triangles+=count;continue;}
  const item=doc.items.find(i=>i.id===planned.id),bounds=planned.job.options?.spacerBounds;
  if(item){const f=footprint(item);instances.push({key:'proxy:'+item.id,mesh:proxyMesh(f.w2*21-0.5,f.d2*21-0.5,7),transform:{translation:[planned.transform.translation[0]-f.w2*10.5+0.25,planned.transform.translation[1]-f.d2*10.5+0.25,planned.transform.translation[2]]},proxy:true});}
  else {const l=planned.job.options?.plateLayout;const size=bounds??[l?.x.length??1,l?.y.length??1,l?.height??5];instances.push({key:'proxy:'+planned.id,mesh:proxyMesh(...size as [number,number,number]),transform:planned.transform,proxy:true});}
 }
 return instances;
}
export function fallbackAssembly(instances:AssemblyInstance[]):MeshOut[]{return instances.map(instance=>transformMesh(instance.mesh,instance.transform));}
/** Shared indexed geometry plus one InstancedMesh for each identical printable body. */
export function instanceGroup(instances:AssemblyInstance[],centre:[number,number,number]=[0,0,0]):THREE.Group {
 const group=new THREE.Group(),groups=new Map<string,AssemblyInstance[]>();
 for(const instance of instances){const list=groups.get(instance.key)??[];list.push(instance);groups.set(instance.key,list);}
 for(const list of groups.values()){const first=list[0],geometry=new THREE.BufferGeometry();geometry.setAttribute('position',new THREE.BufferAttribute(first.mesh.positions,3));geometry.setIndex(new THREE.BufferAttribute(first.mesh.indices,1));geometry.computeVertexNormals();
 const mesh=new THREE.InstancedMesh(geometry,new THREE.MeshStandardMaterial({color:first.proxy?0xaab4c8:0x4f7cff,transparent:!!first.proxy,opacity:first.proxy?0.4:1}),list.length);
 list.forEach((instance,index)=>{const matrix=new THREE.Matrix4().makeRotationZ((instance.transform.rotation??0)*Math.PI/180);matrix.setPosition(...instance.transform.translation.map((n,i)=>n-centre[i]) as [number,number,number]);mesh.setMatrixAt(index,matrix);});mesh.instanceMatrix.needsUpdate=true;group.add(mesh);}
 return group;
}
