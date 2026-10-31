import type { MeshOut, PartTransform, GenerateResult } from './generate';

export function transformMesh(mesh: MeshOut, transform?: PartTransform): MeshOut {
  if (!transform) return mesh;

  const angle = (transform.rotation ?? 0) * Math.PI / 180;
  const cosine = Math.cos(angle);
  const sine = Math.sin(angle);
  const source = mesh.positions;
  const positions = new Float32Array(source.length);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];

  for (let i = 0; i < source.length; i += 3) {
    const vertex = [
      source[i] * cosine - source[i + 1] * sine + transform.translation[0],
      source[i] * sine + source[i + 1] * cosine + transform.translation[1],
      source[i + 2] + transform.translation[2],
    ];
    for (let axis = 0; axis < 3; axis++) {
      positions[i + axis] = vertex[axis];
      min[axis] = Math.min(min[axis], vertex[axis]);
      max[axis] = Math.max(max[axis], vertex[axis]);
    }
  }
  return { ...mesh, positions, min, max };
}

export function displayMeshes(result: GenerateResult): MeshOut[] {
  if (!result.parts?.length) return result.pieces;
  return result.parts.map(part => transformMesh(part.mesh, part.displayTransform));
}
