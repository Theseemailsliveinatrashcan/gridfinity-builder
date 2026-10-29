import { describe, expect, it } from 'vitest';
import { estimateFilament } from '../src/export/filament';
import { to3mf } from '../src/export/threemf';
import { crc32 } from '../src/export/zip';

/** Read a stored (uncompressed) zip produced by src/export/zip.ts. */
function unzip(data: Uint8Array): Map<string, Uint8Array> {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const files = new Map<string, Uint8Array>();
  let o = 0;
  while (view.getUint32(o, true) === 0x04034b50) {
    const crc = view.getUint32(o + 14, true);
    const size = view.getUint32(o + 18, true);
    const nameLen = view.getUint16(o + 26, true);
    const name = new TextDecoder().decode(data.subarray(o + 30, o + 30 + nameLen));
    const body = data.subarray(o + 30 + nameLen, o + 30 + nameLen + size);
    expect(crc32(body)).toBe(crc);
    files.set(name, body);
    o += 30 + nameLen + size;
  }
  return files;
}

// Unit cube, 8 vertices, 12 CCW triangles.
const cube = {
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 1, 1, 0, 0, 1, 0, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1]),
  indices: new Uint32Array([0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7]),
};

describe('3MF export', () => {
  it('writes a valid package with one object per piece', () => {
    const data = to3mf([
      { name: 'a & <b>', ...cube, offset: [0, 0, 0] },
      { name: 'second', ...cube, offset: [0.5, 0.5, 0] },
    ]);
    const files = unzip(data);
    expect([...files.keys()].sort()).toEqual(['3D/3dmodel.model', '[Content_Types].xml', '_rels/.rels']);
    const model = new TextDecoder().decode(files.get('3D/3dmodel.model'));
    expect(model).toContain('unit="millimeter"');
    expect(model.match(/<object /g)?.length).toBe(2);
    expect(model.match(/<vertex /g)?.length).toBe(16);
    expect(model.match(/<triangle /g)?.length).toBe(24);
    expect(model).toContain('name="a &amp; &lt;b&gt;"');
    expect(model).toContain('<vertex x="-0.5" y="-0.5" z="0"/>');
    // second object placed after the first with a 10 mm gap
    expect(model).toContain('transform="1 0 0 0 1 0 0 0 1 11.5 0 0"');
  });
});

describe('filament estimate', () => {
  it('converts volume to grams and metres', () => {
    const e = estimateFilament(10_000, 'PLA'); // 10 cm³
    expect(e.grams).toBeCloseTo(12.4, 5);
    expect(e.metres).toBeCloseTo(10_000 / (Math.PI * 0.875 ** 2) / 1000, 5);
  });
});
