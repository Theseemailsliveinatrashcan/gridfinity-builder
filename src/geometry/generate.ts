import type { Manifold, Vec3 } from 'manifold-3d';
import { binLayout, buildBin, cellPitches, validateBin, type BinParams } from './bin';
import { buildPlate, plateLayout, type PlateParams } from './baseplate';
import { GRID } from './constants';
import { buildTile, MB_PITCH, type TileParams } from './multiboard';
import { DOVETAIL_DEPTH, planSplit, splitPart, type AxisSpec, type Connector, type Piece } from './split';

export type PartKind = 'bin' | 'plate' | 'tile';
export type ConnectorKind = 'dovetail' | 'none';

export interface PrintSettings {
  split: boolean;
  bedX: number;
  bedY: number;
  connector: ConnectorKind;
  clearance: number;
}

export interface GenerateRequest {
  kind: PartKind;
  bin: BinParams;
  plate: PlateParams;
  tile: TileParams;
  print: PrintSettings;
}

export interface MeshOut {
  name: string;
  positions: Float32Array;
  indices: Uint32Array;
  min: Vec3;
  max: Vec3;
  fitsBed: boolean;
  /** Solid volume in mm³. */
  volume: number;
}

export interface GenerateResult {
  pieces: MeshOut[];
  warnings: string[];
  size: Vec3;
}

function toMesh(name: string, m: Manifold, bed: PrintSettings): MeshOut {
  const status = m.status();
  if (status !== 'NoError') throw new Error(`Geometry error (${status})`);
  const mesh = m.getMesh();
  const n = mesh.numProp;
  const count = mesh.vertProperties.length / n;
  const positions = new Float32Array(count * 3);
  for (let v = 0; v < count; v++) {
    positions[v * 3] = mesh.vertProperties[v * n];
    positions[v * 3 + 1] = mesh.vertProperties[v * n + 1];
    positions[v * 3 + 2] = mesh.vertProperties[v * n + 2];
  }
  const bb = m.boundingBox();
  const sx = bb.max[0] - bb.min[0];
  const sy = bb.max[1] - bb.min[1];
  const fitsBed = (sx <= bed.bedX + 1e-6 && sy <= bed.bedY + 1e-6) || (sx <= bed.bedY + 1e-6 && sy <= bed.bedX + 1e-6);
  return { name, positions, indices: new Uint32Array(mesh.triVerts), min: bb.min, max: bb.max, fitsBed, volume: m.volume() };
}

function build(req: GenerateRequest): { part: Manifold; x: AxisSpec; y: AxisSpec; connector?: Connector; base: string; warnings: string[] } {
  const warnings: string[] = [];
  if (req.kind === 'bin') {
    const p = req.bin;
    const errors = validateBin(p);
    if (errors.length) throw new Error(errors.join(' '));
    const xs = cellPitches(p.width);
    const ys = cellPitches(p.depth);
    const L = binLayout(p);
    const gap = -(p.width * GRID - L.outerW) / 2;
    return {
      part: buildBin(p),
      x: { cells: xs, padStart: gap, padEnd: gap, origin: -(p.width * GRID) / 2 },
      y: { cells: ys, padStart: gap, padEnd: gap, origin: -(p.depth * GRID) / 2 },
      base: `gridfinity-bin-${p.width}x${p.depth}x${p.heightMode === 'internal' ? `${p.internalDepth}mm` : p.height}`,
      warnings,
    };
  }
  if (req.kind === 'plate') {
    const p = req.plate;
    const L = plateLayout(p);
    let connector: Connector | undefined;
    if (req.print.split && req.print.connector === 'dovetail') {
      if (L.bottom > 0) {
        connector = {
          height: L.bottom,
          clearance: req.print.clearance,
          xTabAt: Array.from({ length: L.y.units }, (_, j) => L.y.padStart + (j + 0.5) * GRID),
          yTabAt: Array.from({ length: L.x.units }, (_, i) => L.x.padStart + (i + 0.5) * GRID),
        };
      } else {
        warnings.push('Thin plates have no bottom layer for dovetails, so pieces butt together flat. Choose a solid or weighted plate for dovetail joints.');
      }
    }
    return {
      part: buildPlate(p),
      x: { cells: Array(L.x.units).fill(GRID), padStart: L.x.padStart, padEnd: L.x.padEnd, origin: L.x.padStart },
      y: { cells: Array(L.y.units).fill(GRID), padStart: L.y.padStart, padEnd: L.y.padEnd, origin: L.y.padStart },
      connector,
      base: `gridfinity-baseplate-${L.x.units}x${L.y.units}`,
      warnings,
    };
  }
  const p = req.tile;
  warnings.push('Experimental: MultiBoard-compatible tile from public measurements. Print a small test tile and check the fit before printing a wall.');
  return {
    part: buildTile(p),
    x: { cells: Array(Math.round(p.cols)).fill(MB_PITCH), padStart: 0, padEnd: 0, origin: 0 },
    y: { cells: Array(Math.round(p.rows)).fill(MB_PITCH), padStart: 0, padEnd: 0, origin: 0 },
    base: `multiboard-compatible-tile-${p.cols}x${p.rows}`,
    warnings,
  };
}

export function generate(req: GenerateRequest): GenerateResult {
  const { part, x, y, connector, base, warnings } = build(req);
  const bb = part.boundingBox();
  const size: Vec3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  const print = req.print;

  let pieces: Piece[] = [{ name: base, part, ix: 0, iy: 0 }];
  if (print.split) {
    const plan = planSplit(x, y, print.bedX, print.bedY, connector ? DOVETAIL_DEPTH : 0);
    if (!plan) {
      warnings.push('A single grid cell is larger than the print bed, so the part cannot be split to fit.');
    } else if (plan.xCuts.length || plan.yCuts.length) {
      pieces = splitPart(part, plan, connector).map((pc) => ({ ...pc, name: `${base}-${pc.name}` }));
      if (req.kind === 'bin') warnings.push('Split bins join with flat faces: glue the pieces together.');
    }
  }

  const out = pieces.map((pc) => toMesh(pc.name, pc.part, print));
  if (out.some((m) => !m.fitsBed)) {
    warnings.push(print.split ? 'Some pieces are still larger than the print bed.' : 'This part is larger than the print bed. Turn on "Split to fit bed".');
  }
  return { pieces: out, warnings, size };
}
