import type { GenerateResult } from '../geometry/generate';
import type { PlannerDocument } from '../planner/document';
import { resultBytes, CACHE_LIMIT, type Job } from '../planner/batch';
import type { Material } from './filament';
import { StreamingArchive, exportCheckpoint, checkCancelled } from './archive';
import { binaryStlChunks } from './stl';
import { ThreeMfStream } from './threemf';
import { assemblyText, manifestCsv, manifestParts, printRecipes, summarizeManifest, type ManifestPart, type PrintManifest } from './planner';

export interface DrawerExportOptions {
  format: 'zip' | '3mf';
  material: Material;
  signal?: AbortSignal;
  load: (job: Job, signal?: AbortSignal) => Promise<GenerateResult>;
  progress: (completed: number, total: number) => void;
}

export async function exportDrawer(document: PlannerDocument, options: DrawerExportOptions): Promise<{ blob: Blob; manifest: PrintManifest }> {
  const doc = structuredClone(document);
  const recipes = printRecipes(doc);
  const archive = new StreamingArchive(options.signal);
  const model = options.format === '3mf' ? new ThreeMfStream(archive, doc.print, options.signal) : undefined;
  const parts: ManifestPart[] = [];
  options.progress(0, recipes.length);
  try {
    for (const recipe of recipes) {
      checkCancelled(options.signal);
      const result = await options.load(recipe.job, options.signal);
      checkCancelled(options.signal);
      if (resultBytes(result) > CACHE_LIMIT) throw new Error('A print recipe exceeds the 64 MiB working-mesh limit. Reduce its complexity.');
      const entries = manifestParts(recipe, result, options.material);
      parts.push(...entries);
      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i], mesh = result.parts[i].mesh;
        const offset: [number, number, number] = [(mesh.min[0] + mesh.max[0]) / 2, (mesh.min[1] + mesh.max[1]) / 2, mesh.min[2]];
        if (model) {
          await model.addObject({ name: entry.fileName, positions: mesh.positions, indices: mesh.indices, offset, quantity: entry.quantity }, entry.dimensions);
        } else {
          const file = archive.entry(entry.fileName);
          for (const chunk of binaryStlChunks(mesh.positions, mesh.indices, offset)) {
            file.push(chunk, false);
            await exportCheckpoint(options.signal);
          }
          file.push(new Uint8Array(), true);
        }
      }
      options.progress(recipe.index, recipes.length);
      await exportCheckpoint(options.signal);
    }
    const manifest = summarizeManifest(parts, options.material);
    const attachments = {
      'Metadata/bom.csv': manifestCsv(manifest),
      'Metadata/assembly.txt': assemblyText(doc, manifest),
      'Metadata/layout.json': JSON.stringify(doc, null, 2),
    };
    if (model) await model.finish(attachments);
    else for (const [path, text] of Object.entries(attachments)) archive.text(path.replace('Metadata/', ''), text);
    checkCancelled(options.signal);
    return { blob: archive.finish(model ? 'model/3mf' : 'application/zip'), manifest };
  } catch (error) {
    archive.cancel();
    throw error;
  }
}
