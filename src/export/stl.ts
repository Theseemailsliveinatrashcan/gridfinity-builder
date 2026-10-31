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

/** Bounded STL chunks for drawer archives; no full STL buffer is retained. */
export function* binaryStlChunks(positions: Float32Array, indices: Uint32Array, offset: [number, number, number]): Generator<Uint8Array> {
  const header = new Uint8Array(84);
  header.set(new TextEncoder().encode('Gridfinity Builder'));
  new DataView(header.buffer).setUint32(80, indices.length / 3, true);
  yield header;
  for (let start = 0; start < indices.length; start += 3072) {
    const end = Math.min(indices.length, start + 3072);
    const chunk = new Uint8Array((end - start) / 3 * 50);
    const view = new DataView(chunk.buffer);
    let cursor = 0;
    const coordinate = (index: number, axis: number) => positions[index * 3 + axis] - offset[axis];
    for (let i = start; i < end; i += 3) {
      const [a, b, c] = [indices[i], indices[i + 1], indices[i + 2]];
      const u = [0, 1, 2].map(axis => coordinate(b, axis) - coordinate(a, axis));
      const v = [0, 1, 2].map(axis => coordinate(c, axis) - coordinate(a, axis));
      const normal = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
      const length = Math.hypot(...normal) || 1;
      for (const n of normal) { view.setFloat32(cursor, n / length, true); cursor += 4; }
      for (const index of [a, b, c]) for (let axis = 0; axis < 3; axis++) {
        view.setFloat32(cursor, coordinate(index, axis), true);
        cursor += 4;
      }
      cursor += 2;
    }
    yield chunk;
  }
}
