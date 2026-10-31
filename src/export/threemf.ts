import { StreamingArchive, exportCheckpoint, checkCancelled } from './archive';
import type { ZipDeflate } from 'fflate';
import { strToU8, zipSync } from 'fflate';

export interface ThreeMfObject {
  name: string;
  quantity?: number;
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
export function to3mf(objects: ThreeMfObject[], gap = 10, attachments: Record<string, string> = {}): Uint8Array {
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
    for (let copy = 0; copy < (o.quantity ?? 1); copy++) {
    const tx = x - minX;
    items.push(`<item objectid="${id}" transform="1 0 0 0 1 0 0 0 1 ${num(tx)} 0 0"/>`);
    x += maxX - minX + gap;
    }
  });
  const model = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Gridfinity Builder</metadata>
<resources>${parts.join('')}</resources>
<build>${items.join('')}</build>
</model>
`;
  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes(attachments)),
    '_rels/.rels': strToU8(packageRelationships(attachments)),
    '3D/3dmodel.model': strToU8(model),
  };
  for (const [path, text] of Object.entries(attachments)) files[path] = strToU8(text);
  if (Object.keys(attachments).length) files['3D/_rels/3dmodel.model.rels'] = strToU8(attachmentRelationships(attachments));
  return zipSync(files);
}

function validateAttachments(attachments: Record<string, string>): void {
  for (const path of Object.keys(attachments)) {
    if (!/^Metadata\/[a-zA-Z0-9._-]+\.(csv|json|txt)$/.test(path)) throw new Error('Invalid 3MF attachment path.');
  }
}

function contentTypes(attachments: Record<string, string>): string {
  validateAttachments(attachments);
  if (!Object.keys(attachments).length) return CONTENT_TYPES;
  return CONTENT_TYPES.replace('</Types>', '<Default Extension="csv" ContentType="text/csv"/><Default Extension="json" ContentType="application/json"/><Default Extension="txt" ContentType="text/plain"/></Types>');
}

function attachmentRelationships(attachments: Record<string, string>): string {
  validateAttachments(attachments);
  const relations = Object.keys(attachments).map((path, index) => `<Relationship Target="/${esc(path)}" Id="attachment${index}" Type="urn:gridfinity-builder:attachment"/>`);
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${relations.join('')}</Relationships>`;
}

function packageRelationships(attachments: Record<string, string>): string {
  const relationships = attachmentRelationships(attachments).match(/<Relationship [^>]+\/>/g) ?? [];
  return RELS.replace('</Relationships>', relationships.join('') + '</Relationships>');
}

const MODEL_HEADER = `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
<metadata name="Application">Gridfinity Builder</metadata>
<metadata name="Description">Drawer print layout. Quantities and sources: /Metadata/bom.csv</metadata>
<resources>`;
const MAX_BUILD_ITEMS = 20000;

/** Writes each resource once, then references it for every requested copy. */
export class ThreeMfStream {
  private model: ZipDeflate;
  private objectId = 0;
  private items: string[] = [];
  private x = 0;
  private y = 0;
  private rowDepth = 0;

  constructor(private archive: StreamingArchive, private bed: { bedX: number; bedY: number }, private signal?: AbortSignal) {
    this.model = archive.entry('3D/3dmodel.model');
    this.write(MODEL_HEADER);
  }

  private write(text: string, final = false): void {
    checkCancelled(this.signal);
    this.model.push(strToU8(text), final);
  }

  async addObject(object: ThreeMfObject, dimensions: [number, number, number]): Promise<void> {
    const id = ++this.objectId;
    this.write(`<object id="${id}" name="${esc(object.name)}" type="model"><mesh><vertices>`);
    for (let start = 0; start < object.positions.length; start += 3072) {
      const vertices: string[] = [];
      for (let i = start; i < Math.min(start + 3072, object.positions.length); i += 3) {
        vertices.push(`<vertex x="${num(object.positions[i] - object.offset[0])}" y="${num(object.positions[i + 1] - object.offset[1])}" z="${num(object.positions[i + 2] - object.offset[2])}"/>`);
      }
      this.write(vertices.join(''));
      await exportCheckpoint(this.signal);
    }
    this.write('</vertices><triangles>');
    for (let start = 0; start < object.indices.length; start += 3072) {
      const triangles: string[] = [];
      for (let i = start; i < Math.min(start + 3072, object.indices.length); i += 3) {
        triangles.push(`<triangle v1="${object.indices[i]}" v2="${object.indices[i + 1]}" v3="${object.indices[i + 2]}"/>`);
      }
      this.write(triangles.join(''));
      await exportCheckpoint(this.signal);
    }
    this.write('</triangles></mesh></object>');
    const rotated = dimensions[0] > this.bed.bedX && dimensions[1] <= this.bed.bedX && dimensions[0] <= this.bed.bedY;
    const width = rotated ? dimensions[1] : dimensions[0];
    const depth = rotated ? dimensions[0] : dimensions[1];
    for (let copy = 0; copy < (object.quantity ?? 1); copy++) {
      if (this.items.length >= MAX_BUILD_ITEMS) throw new Error('Drawer exceeds the 20,000 print-instance limit.');
      if (this.x > 0 && this.x + width > this.bed.bedX) {
        this.x = 0;
        this.y += this.rowDepth + 10;
        this.rowDepth = 0;
      }
      const rotation = rotated ? '0 1 0 -1 0 0 0 0 1' : '1 0 0 0 1 0 0 0 1';
      this.items.push(`<item objectid="${id}" transform="${rotation} ${num(this.x + width / 2)} ${num(this.y + depth / 2)} 0"/>`);
      this.x += width + 10;
      this.rowDepth = Math.max(this.rowDepth, depth);
    }
  }

  async finish(attachments: Record<string, string>): Promise<void> {
    this.write('</resources><build>');
    for (let start = 0; start < this.items.length; start += 512) {
      this.write(this.items.slice(start, start + 512).join(''));
      await exportCheckpoint(this.signal);
    }
    this.write('</build></model>', true);
    this.items = [];
    this.archive.text('[Content_Types].xml', contentTypes(attachments));
    this.archive.text('_rels/.rels', packageRelationships(attachments));
    this.archive.text('3D/_rels/3dmodel.model.rels', attachmentRelationships(attachments));
    for (const [path, text] of Object.entries(attachments)) this.archive.text(path, text);
  }
}
