import type { GenerateResult, GeneratedPart } from '../geometry/generate';
import { itemRequest, type PlannerDocument } from '../planner/document';
import { planDrawer } from '../planner/layout';
import { plannerJobs } from '../planner/viewer';
import { jobKey, type Job } from '../planner/batch';
import { estimateFilament, type Material } from './filament';

export interface PrintRecipe {
  key: string;
  index: number;
  job: Job;
  sourceItemIds: string[];
}
export interface ManifestPart {
  key: string;
  recipeKey: string;
  partKey: string;
  name: string;
  role: GeneratedPart['role'];
  quantity: number;
  dimensions: [number, number, number];
  splitGroup: string;
  sourceItemIds: string[];
  grams: number;
  volume: number;
  fitsBed: boolean;
  fileName: string;
}
export interface PrintManifest {
  parts: ManifestPart[];
  totalQuantity: number;
  totalGrams: number;
  totalVolume: number;
  material: Material;
}

export function printRecipes(doc: PlannerDocument): PrintRecipe[] {
  const recipes = new Map<string, PrintRecipe>();
  for (const placement of plannerJobs(doc)) {
    const job: Job = { ...placement.job, purpose: 'print', req: { ...placement.job.req, print: doc.print } };
    const key = jobKey(job);
    const recipe = recipes.get(key) ?? { key, index: recipes.size + 1, job, sourceItemIds: [] };
    recipe.sourceItemIds.push(job.req.kind === 'plate' ? '@baseplate' : job.req.kind === 'spacer' ? '@' + placement.id : placement.id);
    recipes.set(key, recipe);
  }
  return [...recipes.values()];
}

export function manifestParts(recipe: PrintRecipe, result: GenerateResult, material: Material): ManifestPart[] {
  return result.parts.map(part => {
    const mesh = part.mesh;
    const quantity = part.quantity * recipe.sourceItemIds.length;
    const dimensions = mesh.max.map((max, axis) => max - mesh.min[axis]) as [number, number, number];
    const name = mesh.name.replace(/^gridfinity-/, '').replace(/[^a-zA-Z0-9._-]/g, '-');
    return {
      key: JSON.stringify([recipe.key, part.partKey]), recipeKey: recipe.key, partKey: part.partKey,
      name, role: part.role, quantity, dimensions,
      splitGroup: /-piece-\d+-\d+$/.test(mesh.name) ? `recipe-${recipe.index}:` + mesh.name.replace(/-piece-\d+-\d+$/, '') : '',
      sourceItemIds: [...recipe.sourceItemIds],
      grams: estimateFilament(mesh.volume * quantity, material).grams,
      volume: mesh.volume * quantity, fitsBed: mesh.fitsBed,
      fileName: `${name}-r${recipe.index}__x${quantity}.stl`,
    };
  });
}

export function summarizeManifest(parts: ManifestPart[], material: Material): PrintManifest {
  return {
    parts, material,
    totalQuantity: parts.reduce((sum, part) => sum + part.quantity, 0),
    totalGrams: parts.reduce((sum, part) => sum + part.grams, 0),
    totalVolume: parts.reduce((sum, part) => sum + part.volume, 0),
  };
}

export function buildManifest(doc: PlannerDocument, results: ReadonlyMap<string, GenerateResult>, material: Material = 'PLA'): PrintManifest {
  const parts = printRecipes(doc).flatMap(recipe => {
    const result = results.get(recipe.key);
    if (!result) throw new Error('Print geometry is missing; regenerate the drawer before export.');
    return manifestParts(recipe, result, material);
  });
  return summarizeManifest(parts, material);
}

/** Quote a CSV cell; text that a spreadsheet could read as a formula is prefixed with ' (OWASP CSV injection). */
const csv = (value: string | number | boolean) => {
  let text = String(value);
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replaceAll('"', '""') + '"';
};
export function manifestCsv(manifest: PrintManifest): string {
  const header = ['part', 'role', 'qty', 'width_mm', 'depth_mm', 'height_mm', 'split_group', 'source_item_ids', 'est_grams', 'material', 'fits_bed'];
  const rows = manifest.parts.map(part => [
    part.fileName, part.role, part.quantity, ...part.dimensions.map(n => Number(n.toFixed(4))),
    part.splitGroup, part.sourceItemIds.join(';'), Number(part.grams.toFixed(4)), manifest.material, part.fitsBed,
  ]);
  return [header, ...rows].map(row => row.map(csv).join(',')).join('\r\n') + '\r\n';
}

export function assemblyText(doc: PlannerDocument, manifest: PrintManifest): string {
  const lines = [
    'Gridfinity drawer assembly',
    'Coordinates are 21 mm ticks from the socket-grid origin, after padding.',
    '3MF build items are arranged in print rows; rearrange rows onto separate plates as needed.',
    `Total: ${manifest.totalQuantity} pieces, <= ${manifest.totalGrams.toFixed(1)} g ${manifest.material} (fully solid upper bound).`,
    '',
  ];
  const layout = planDrawer(doc);
  lines.push(`@baseplate: origin X=${layout.plateOrigin[0]} mm, Y=${layout.plateOrigin[1]} mm; socket-grid origin X=${layout.gridOrigin[0]} mm, Y=${layout.gridOrigin[1]} mm.`);
  layout.spacers.forEach((strip,index)=>lines.push(`@spacer-${index}: X=${strip.x} mm, Y=${strip.y} mm; ${strip.width} x ${strip.depth} x ${strip.height} mm.`));
  lines.push('');
  for (const item of doc.items) {
    const req = itemRequest(item, doc.print);
    lines.push(`${item.id}: ${item.name} (${req.kind}) at X=${item.x2}, Y=${item.y2}; ${item.w2 / 2} x ${item.d2 / 2} units; rotate ${item.rotation} degrees.`);
  }
  lines.push('', 'Print the quantities in bom.csv. Divider and card quantities count every configured installation, not just templates.');
  if (manifest.parts.some(part => !part.fitsBed)) lines.push('WARNING: Some pieces exceed the print bed. Enable splitting or adjust the bed settings.');
  return lines.join('\n') + '\n';
}
