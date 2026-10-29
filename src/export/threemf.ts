import { strToU8, zipSync } from 'fflate';

export interface ThreeMfObject {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  /** Subtracted from every vertex, so the object rests at its own origin. */
  offset: [number, number, number];
}

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>
</Types>
`;

const RELS = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>
</Relationships>
`;

const esc = (s: string) => s.replace(/[<>&"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' })[c]!);
const num = (v: number) => (Math.round(v * 1e4) / 1e4).toString();

/**
 * 3MF package with one object per piece. Unlike STL, vertices are shared, so
 * slicers get the watertight mesh exactly as generated. Pieces are laid out in
 * a row with a gap; slicers can re-arrange them.
 */
export function to3mf(objects: ThreeMfObject[], gap = 10): Uint8Array {
  const parts: string[] = [];
  const items: string[] = [];
  let x = 0;
  objects.forEach((o, i) => {
    const id = i + 1;
    const p = o.positions;
    const [ox, oy, oz] = o.offset;
    let minX = Infinity;
    let maxX = -Infinity;
    const verts: string[] = [];
    for (let v = 0; v < p.length; v += 3) {
      const vx = p[v] - ox;
      minX = Math.min(minX, vx);
      maxX = Math.max(maxX, vx);
      verts.push(`<vertex x="${num(vx)}" y="${num(p[v + 1] - oy)}" z="${num(p[v + 2] - oz)}"/>`);
    }
    const tris: string[] = [];
    const t = o.indices;
    for (let k = 0; k < t.length; k += 3) tris.push(`<triangle v1="${t[k]}" v2="${t[k + 1]}" v3="${t[k + 2]}"/>`);
    parts.push(
      `<object id="${id}" name="${esc(o.name)}" type="model"><mesh><vertices>${verts.join('')}</vertices><triangles>${tris.join('')}</triangles></mesh></object>`,
    );
    const tx = x - minX;
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} 0 0"/>`);
    x += maxX - minX + gap;
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Gridfinity Builder</metadata>
<resources>${parts.join('')}</resources>
<build>${items.join('')}</build>
</model>
`;
  return zipSync({
    '[Content_Types].xml': strToU8(CONTENT_TYPES),
    '_rels/.rels': strToU8(RELS),
    '3D/3dmodel.model': strToU8(model),
  });
}
