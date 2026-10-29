/** Binary STL. Positions are xyz triples, indices are CCW triangles. */
export function toBinaryStl(positions: Float32Array, indices: Uint32Array, offset: [number, number, number] = [0, 0, 0]): Uint8Array {
  const triCount = indices.length / 3;
  const buffer = new ArrayBuffer(84 + triCount * 50);
  const view = new DataView(buffer);
  const header = 'Gridfinity Builder';
  for (let i = 0; i < header.length; i++) view.setUint8(i, header.charCodeAt(i));
  view.setUint32(80, triCount, true);
  let o = 84;
  const p = (idx: number, axis: number) => positions[idx * 3 + axis] - offset[axis];
  for (let t = 0; t < triCount; t++) {
    const a = indices[t * 3];
    const b = indices[t * 3 + 1];
    const c = indices[t * 3 + 2];
    const ux = p(b, 0) - p(a, 0), uy = p(b, 1) - p(a, 1), uz = p(b, 2) - p(a, 2);
    const vx = p(c, 0) - p(a, 0), vy = p(c, 1) - p(a, 1), vz = p(c, 2) - p(a, 2);
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    view.setFloat32(o, nx, true); view.setFloat32(o + 4, ny, true); view.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      view.setFloat32(o, p(v, 0), true);
      view.setFloat32(o + 4, p(v, 1), true);
      view.setFloat32(o + 8, p(v, 2), true);
      o += 12;
    }
    view.setUint16(o, 0, true);
    o += 2;
  }
  return new Uint8Array(buffer);
}
