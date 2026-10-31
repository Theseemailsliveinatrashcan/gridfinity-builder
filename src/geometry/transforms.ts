import type { GeneratedPart, MeshOut, PartTransform, GenerateResult } from './generate';
export function transformMesh(mesh:MeshOut,t?:PartTransform):MeshOut {
 if(!t)return mesh;
 const angle=(t.rotation??0)*Math.PI/180,c=Math.cos(angle),s=Math.sin(angle),p=mesh.positions,positions=new Float32Array(p.length);
 const min:[number,number,number]=[Infinity,Infinity,Infinity],max:[number,number,number]=[-Infinity,-Infinity,-Infinity];
 for(let i=0;i<p.length;i+=3){const v=[p[i]*c-p[i+1]*s+t.translation[0],p[i]*s+p[i+1]*c+t.translation[1],p[i+2]+t.translation[2]];for(let axis=0;axis<3;axis++){positions[i+axis]=v[axis];min[axis]=Math.min(min[axis],v[axis]);max[axis]=Math.max(max[axis],v[axis]);}}
 return {...mesh,positions,min,max};
}
export function displayMeshes(result:GenerateResult):MeshOut[]{return result.parts?.length?result.parts.map((part:GeneratedPart)=>transformMesh(part.mesh,part.displayTransform)):result.pieces;}
