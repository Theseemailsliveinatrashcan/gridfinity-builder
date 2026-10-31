import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildManifest, manifestCsv, printRecipes } from '../src/export/planner';
import { exportDrawer } from '../src/export/planner-download';
import { binaryStlChunks, toBinaryStl } from '../src/export/stl';
import { to3mf } from '../src/export/threemf';
import { StreamingArchive } from '../src/export/archive';
import { estimateFilament } from '../src/export/filament';
import { defaultPlanner, type PlannerDocument, type PlannerItem } from '../src/planner/document';
import { defaultBin } from '../src/geometry/bin';
import { generate, type GenerateResult } from '../src/geometry/generate';
import { freeAll, initKernel } from '../src/geometry/kernel';
import { proxyMesh } from '../src/planner/viewer';
import { jobKey } from '../src/planner/batch';

beforeAll(async () => { await initKernel(); });
afterEach(freeAll);
function item(id: string, x2: number, y2: number, extra = {}): PlannerItem {
  const { width: _w, depth: _d, ...params } = defaultBin;
  return { id, name: id, x2, y2, w2: 4, d2: 4, rotation: 0, kind: 'bin', params: { ...params, ...extra } };
}
function layout(): PlannerDocument {
  const doc = structuredClone(defaultPlanner);
  doc.drawer = { widthMm: 600, depthMm: 300, fitGapMm: 0 };
  doc.baseplate.padding = 'spacers';
  doc.print = { ...doc.print, split: true, bedX: 180, bedY: 180 };
  doc.items = [
    { ...item('cards-a', 0, 0, { withLid: true, labelSlot: 'card', compartmentsX: 2 }), w2: 12 },
    { ...item('cards-b', 12, 0, { withLid: true, labelSlot: 'card', compartmentsX: 2 }), w2: 12 },
    item('dividers', 0, 4, { removableDividers: 'both', dividerCountX: 2, dividerCountY: 3 }),
  ];
  return doc;
}
function results(doc: PlannerDocument): Map<string, GenerateResult> {
  return new Map(printRecipes(doc).map(recipe => {
    const result = generate(recipe.job.req, recipe.job.options);
    freeAll();
    return [recipe.key, result];
  }));
}
function fakeResult(): GenerateResult {
  const mesh = proxyMesh(10, 12, 5);
  return { pieces: [mesh], parts: [{ mesh, partKey: 'same-part', role: 'body', quantity: 1 }], size: [10, 12, 5], warnings: [], info: [] };
}
const archiveFiles = async (blob: Blob) => unzipSync(new Uint8Array(await blob.arrayBuffer()));

describe('drawer manifests', () => {
  it('sums actual accessory quantities, deduplicates recipes, and retains fitting split groups', () => {
    const doc = layout(), generated = results(doc), manifest = buildManifest(doc, generated);
    const qty = (role: string) => manifest.parts.filter(part => part.role === role).reduce((sum, part) => sum + part.quantity, 0);
    expect(qty('body')).toBe(5);
    expect(qty('lid')).toBe(4);
    expect(qty('label-card')).toBe(4);
    expect(qty('divider')).toBe(5);
    expect(qty('plate')).toBe(8);
    expect(qty('spacer')).toBe(12);
    expect(manifest.totalQuantity).toBe(38);
    expect(manifest.parts.every(part => part.fitsBed)).toBe(true);
    expect(manifest.parts.filter(part => part.role === 'body' && part.splitGroup).every(part => part.sourceItemIds.join(';') === 'cards-a;cards-b')).toBe(true);
    expect(manifest.parts.filter(part => part.role === 'lid').every(part => part.quantity === 2)).toBe(true);
    expect(new Set(manifest.parts.map(part => part.fileName)).size).toBe(manifest.parts.length);
    expect(manifest.totalGrams).toBeCloseTo(estimateFilament(manifest.totalVolume, 'PLA').grams, 8);
    const csv = manifestCsv(manifest);
    expect(csv.split('\r\n').filter(Boolean).length).toBe(manifest.parts.length + 1);
    for (const part of manifest.parts) expect(csv).toContain(`"${part.quantity}"`);
  }, 15_000);

  it('namespaces part keys and filenames across recipes with the same mesh name', () => {
    const doc = structuredClone(defaultPlanner);
    doc.items = [item('plain', 0, 0), item('magnets', 4, 0, { magnets: true })];
    const generated = new Map(printRecipes(doc).map(recipe => [recipe.key, fakeResult()]));
    const manifest = buildManifest(doc, generated);
    expect(new Set(manifest.parts.map(part => part.key)).size).toBe(manifest.parts.length);
    expect(new Set(manifest.parts.map(part => part.fileName)).size).toBe(manifest.parts.length);
    expect(() => buildManifest(doc, new Map())).toThrow('missing');
  });
});

describe('streaming drawer archives', () => {
  it('writes one STL per unique printable piece plus a matching BOM, assembly and layout', async () => {
    const doc = layout(), generated = results(doc);
    let loads = 0;
    const { blob, manifest } = await exportDrawer(doc, {
      format: 'zip', material: 'PLA', progress: () => {},
      load: async job => { loads++; return generated.get(jobKey(job))!; },
    });
    const files = await archiveFiles(blob);
    expect(loads).toBe(printRecipes(doc).length);
    expect(Object.keys(files).filter(path => path.endsWith('.stl')).length).toBe(manifest.parts.length);
    for (const part of manifest.parts) {
      expect(part.fileName).toContain(`__x${part.quantity}.stl`);
      const stl = files[part.fileName];
      expect(stl.byteLength).toBe(84 + new DataView(stl.buffer, stl.byteOffset).getUint32(80, true) * 50);
    }
    expect(strFromU8(files['bom.csv'])).toBe(manifestCsv(manifest));
    expect(JSON.parse(strFromU8(files['layout.json']))).toEqual(doc);
    for (const item of doc.items) expect(strFromU8(files['assembly.txt'])).toContain(`${item.id}: ${item.name}`);
  }, 15_000);

  it('writes unique 3MF resources and quantity-aware print build items with valid attachment relationships', async () => {
    const doc = layout();
    const generated = results(doc);
    const { blob, manifest } = await exportDrawer(doc, { format: '3mf', material: 'PETG', progress: () => {}, load: async job => generated.get(jobKey(job))! });
    const files = await archiveFiles(blob), model = strFromU8(files['3D/3dmodel.model']);
    expect(model.match(/<object /g)?.length).toBe(manifest.parts.length);
    expect(model.match(/<item /g)?.length).toBe(manifest.totalQuantity);
    expect(model).toContain('Metadata/bom.csv');
    const ids = new Set([...model.matchAll(/<object id="(\d+)"/g)].map(match => match[1]));
    const rectangles: {x:number;y:number;width:number;depth:number}[] = [];
    for (const item of model.matchAll(/<item objectid="(\d+)" transform="([^"]+)"/g)) {
      expect(ids.has(item[1])).toBe(true);
      const values = item[2].split(' ').map(Number);
      expect(values.length).toBe(12);
      expect(values.every(Number.isFinite)).toBe(true);
      expect(values[11]).toBe(0);
      const dimensions = manifest.parts[Number(item[1])-1].dimensions;
      const rotated = values[0] === 0;
      const width = rotated ? dimensions[1] : dimensions[0];
      const depth = rotated ? dimensions[0] : dimensions[1];
      expect(values[9] + width/2).toBeLessThanOrEqual(doc.print.bedX + 1e-3);
      rectangles.push({x:values[9]-width/2,y:values[10]-depth/2,width,depth});
    }
    for(let i=0;i<rectangles.length;i++) for(let j=i+1;j<rectangles.length;j++){
      const a=rectangles[i],b=rectangles[j];
      const overlapX=Math.max(0,Math.min(a.x+a.width,b.x+b.width)-Math.max(a.x,b.x));
      const overlapY=Math.max(0,Math.min(a.y+a.depth,b.y+b.depth)-Math.max(a.y,b.y));
      expect(overlapX*overlapY).toBeLessThan(1e-6);
    }
    for (const path of ['_rels/.rels', '3D/_rels/3dmodel.model.rels']) {
      for (const relation of strFromU8(files[path]).matchAll(/Target="\/([^"]+)"/g)) expect(files[relation[1]]).toBeDefined();
    }
    const types = strFromU8(files['[Content_Types].xml']);
    for (const extension of ['model', 'rels', 'csv', 'json', 'txt']) expect(types).toContain(`Extension="${extension}"`);
    expect(strFromU8(files['Metadata/bom.csv'])).toBe(manifestCsv(manifest));
    expect(JSON.parse(strFromU8(files['Metadata/layout.json']))).toEqual(doc);
  }, 15_000);

  it('matches legacy STL bytes while chunking and supports quantity-aware legacy 3MF calls', () => {
    const mesh = proxyMesh(10, 12, 5), chunks = [...binaryStlChunks(mesh.positions, mesh.indices, [5, 6, 0])];
    const output = new Uint8Array(chunks.reduce((sum, chunk) => sum + chunk.length, 0));
    let offset = 0;
    for (const chunk of chunks) { output.set(chunk, offset); offset += chunk.length; }
    expect(output).toEqual(toBinaryStl(mesh.positions, mesh.indices, [5, 6, 0]));
    const files = unzipSync(to3mf([{ name: 'cube', positions: mesh.positions, indices: mesh.indices, offset: [5, 6, 0], quantity: 3 }], 10, { 'Metadata/bom.csv': 'part,qty\ncube,3' }));
    expect(strFromU8(files['3D/3dmodel.model']).match(/<item /g)?.length).toBe(3);
    expect(files['3D/_rels/3dmodel.model.rels']).toBeDefined();
  });

  it('does not return a partial archive after cancellation during loading or writing', async () => {
    const doc = structuredClone(defaultPlanner), controller = new AbortController();
    let delivered = false;
    await expect(exportDrawer(doc, { format: 'zip', material: 'PLA', signal: controller.signal, progress: () => {}, load: async () => { controller.abort(); return fakeResult(); } }).then(() => { delivered = true; })).rejects.toMatchObject({ name: 'AbortError' });
    expect(delivered).toBe(false);
    const during = new AbortController(), result = fakeResult();
    result.pieces[0].indices = new Uint32Array(30000);
    const pending = exportDrawer(doc, { format: '3mf', material: 'PLA', signal: during.signal, progress: () => {}, load: async () => result });
    setTimeout(() => during.abort(), 0);
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('enforces an explicit output budget without producing a download', () => {
    const archive = new StreamingArchive(undefined, 10);
    expect(() => archive.text('large.txt', 'a'.repeat(1000))).toThrow('output limit');
    archive.cancel();
    const input = new StreamingArchive(undefined, 10000, 10);
    expect(() => input.text('large.txt', 'a'.repeat(100))).toThrow('input limit');
    input.cancel();
  });
});

it('regenerates uncached print jobs serially and aborts the in-flight worker without caching stale output', async () => {
  const { BatchQueue, ResultCache } = await import('../src/planner/batch');
  type Request = import('../src/planner/batch').BatchRequest;
  type Reply = import('../src/planner/batch').BatchReply;
  const workers: TestWorker[] = [];
  class TestWorker {
    onmessage: ((event: MessageEvent<Reply>) => void) | null = null;
    onerror: ((event: ErrorEvent) => void) | null = null;
    jobs: Request[] = [];
    terminated = false;
    constructor() { workers.push(this); }
    postMessage(job: Request) { this.jobs.push(job); }
    terminate() { this.terminated = true; }
    reply() {
      const job = this.jobs.at(-1)!;
      this.onmessage?.(new MessageEvent('message', { data: { type: 'result', batchId: job.batchId, jobId: job.jobId, key: job.key, result: fakeResult(), ms: 1 } }));
    }
  }
  const queue = new BatchQueue(() => new TestWorker(), new ResultCache(1));
  const job = printRecipes(structuredClone(defaultPlanner))[0].job;
  const first = queue.run(job);
  workers.at(-1)!.reply();
  expect((await first).pieces[0].positions.byteLength).toBeGreaterThan(0);
  expect(queue.cache.has(jobKey(job))).toBe(false);
  const second = queue.run(job);
  expect(workers.filter(worker => !worker.terminated).length).toBe(1);
  workers.at(-1)!.reply();
  await second;
  const controller = new AbortController(), cancelled = queue.run(job, controller.signal);
  const stale = workers.at(-1)!;
  controller.abort();
  await expect(cancelled).rejects.toMatchObject({ name: 'AbortError' });
  stale.reply();
  expect(queue.cache.has(jobKey(job))).toBe(false);
  expect(workers.filter(worker => !worker.terminated).length).toBe(0);
  queue.dispose();
});

describe('review regressions', () => {
  it('turns a piece that is too deep (not too wide) for the bed when that makes it fit', async () => {
    const doc = structuredClone(defaultPlanner);
    doc.drawer = { widthMm: 300, depthMm: 300, fitGapMm: 0 };
    doc.print = { ...doc.print, split: true, bedX: 220, bedY: 180 };
    doc.items = [{ ...item('tall', 0, 0), w2: 4, d2: 10 }];
    const generated = results(doc);
    const { blob, manifest } = await exportDrawer(doc, { format: '3mf', material: 'PLA', progress: () => {}, load: async job => generated.get(jobKey(job))! });
    const model = strFromU8((await archiveFiles(blob))['3D/3dmodel.model']);
    const tall = manifest.parts.findIndex(part => part.dimensions[1] > 180 && part.dimensions[0] <= 180);
    expect(tall).toBeGreaterThanOrEqual(0);
    const placed = [...model.matchAll(/<item objectid="(\d+)" transform="([^"]+)"/g)].filter(m => Number(m[1]) - 1 === tall);
    expect(placed.length).toBeGreaterThan(0);
    for (const m of placed) {
      const values = m[2].split(' ').map(Number);
      expect(values[0]).toBe(0); // rotated 90°
      // Rows may continue past one plate by design; the turned footprint itself must fit the bed.
      const [w, d] = manifest.parts[tall].dimensions;
      expect(d).toBeLessThanOrEqual(220);
      expect(w).toBeLessThanOrEqual(180);
      expect(values[9] + d / 2).toBeLessThanOrEqual(220 + 1e-3);
    }
  }, 20_000);

  it('literalizes formula-leading text cells in the BOM', () => {
    const manifest = buildManifest(layout(), results(layout()));
    const tweaked = { ...manifest, parts: manifest.parts.map((p, i) => i === 0 ? { ...p, sourceItemIds: ['-1-2'], splitGroup: '=HYPERLINK("x")' } : p) };
    const csv = manifestCsv(tweaked);
    expect(csv).toContain('"\'-1-2"');
    expect(csv).toContain('"\'=HYPERLINK(""x"")"');
    expect(csv).not.toMatch(/(^|,)"[=+\-@]/m);
  }, 20_000);
});
