import { unionAll } from './kernel';
import type { Manifold, Vec3 } from 'manifold-3d';
import { binLayout, buildBin, cellPitches, validateBin, type BinParams } from './bin';
import { buildPlate, plateLayout, plateHardwareCutters, type PlateParams } from './baseplate';
import { buildSpacer, spacerCells, type SpacerParams } from './spacer';
import { buildHolder, holderLayout, type HolderParams } from './holder';
import { buildLid, defaultLid, type LidParams } from './lid';
import { BASE_PROFILE_HEIGHT, BASE_TOP_SIZE_GAP, GRID } from './constants';
import { buildTile, MB_PITCH, type TileParams } from './multiboard';
import { DOVETAIL_DEPTH, planSplit, splitPart, tabSolid, type AxisSpec, type Connector, type Piece } from './split';

export type PartKind = 'bin' | 'plate' | 'tile' | 'lid' | 'holder' | 'spacer';
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
  lid: LidParams;
  holder: HolderParams;
  spacer: SpacerParams;
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
  /** Neutral facts about the part, e.g. how many items a holder takes. */
  info: string[];
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

function build(req: GenerateRequest): { part: Manifold; x: AxisSpec; y: AxisSpec; connector?: Connector; base: string; warnings: string[]; info?: string[] } {
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
  if (req.kind === 'spacer') {
    const p = req.spacer;
    const part = buildSpacer(p);
    const depth = p.shape === 'corner' ? p.length2 : p.width + (p.lip ? 3 : 0);
    return {
      part,
      x: { cells: spacerCells(p.length), padStart: 0, padEnd: 0, origin: 0 },
      y: { cells: p.shape === 'corner' ? spacerCells(depth) : [depth], padStart: 0, padEnd: 0, origin: 0 },
      base: `gridfinity-spacer-${p.length}x${p.width}`, warnings,
    };
  }
  if (req.kind === 'holder') {
    const p = req.holder;
    const layout = holderLayout(p);
    const gap = -BASE_TOP_SIZE_GAP / 2;

    if (!layout.count) warnings.push('No items fit: reduce the item size, spacing or margin, or enlarge the holder.');
    return {
      part: buildHolder(p),
      x: { cells: cellPitches(p.width), padStart: gap, padEnd: gap, origin: -p.width * GRID / 2 },
      y: { cells: cellPitches(p.depth), padStart: gap, padEnd: gap, origin: -p.depth * GRID / 2 },
      base: `gridfinity-holder-${p.preset}-${p.width}x${p.depth}`, warnings,
      info: layout.count ? [`Holds ${layout.count} item${layout.count === 1 ? '' : 's'}`] : [],
    };
  }
  if (req.kind === 'lid') {
    const p = req.lid;
    const gap = -BASE_TOP_SIZE_GAP / 2;
    return {
      part: buildLid(p),
      x: { cells: cellPitches(p.width), padStart: gap, padEnd: gap, origin: -p.width * GRID / 2 },
      y: { cells: cellPitches(p.depth), padStart: gap, padEnd: gap, origin: -p.depth * GRID / 2 },
      base: `gridfinity-lid-${p.width}x${p.depth}`,
      warnings,
    };
  }
  if (req.kind === 'plate') {
    const p = req.plate;
    const L = plateLayout(p);
    let connector: Connector | undefined;
    if (req.print.split && req.print.connector === 'dovetail') {
      if (L.bottom > 0) {
        const hardware = unionAll(plateHardwareCutters(p, L));
        connector = {
          zMin: -1,
          height: L.bottom,
          slotTop: L.bottom + 0.2,
          clearance: req.print.clearance,
          tabsAt: (axis, cut, lo, hi) => {
            const positions = axis === 'x' ? L.y.centres : L.x.centres;
            const margin = 5.5 + req.print.clearance;
            return positions.filter(at => {
              if (at - margin < lo || at + margin > hi) return false;
              const slot = tabSolid(axis === 'x', cut, at, -1.2, L.bottom + 0.2, req.print.clearance);
              return !hardware || slot.intersect(hardware).volume() < 1e-9;
            });
          },
        };
      } else {
        warnings.push('Thin plates have no bottom layer for dovetails, so pieces butt together flat. Choose a solid or weighted plate for dovetail joints.');
      }
    }
    const axis = (a: typeof L.x): AxisSpec => a.cells.length
      ? { cells: a.cells, padStart: a.padStart, padEnd: a.padEnd, origin: a.padStart }
      : { cells: [a.length], padStart: 0, padEnd: 0, origin: 0 };
    return {
      part: buildPlate(p),
      x: axis(L.x),
      y: axis(L.y),
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

function floorConnector(part: Manifold, x: AxisSpec, y: AxisSpec, floorZ: number, clearance: number, onCut: (count: number) => void): Connector {
  const bb = part.boundingBox();
  const cache = new Map<string, number[]>();
  return {
    zMin: BASE_PROFILE_HEIGHT, height: floorZ, slotTop: floorZ + 0.2, clearance,
    tabsAt(axis, cut, lo, hi) {
      const key = [axis, cut, lo, hi].join(':');
      const cached = cache.get(key);
      if (cached) return cached;
      const spec = axis === 'x' ? y : x;
      const vAxis = axis === 'x' ? 1 : 0;
      // At maximum UI clearance, the 5.6 mm slot reach stays short of screw
      // bores (nearest edge 6.5 mm from a cell boundary); magnets are below this layer.
      const margin = 5.5 + clearance;
      const positions: number[] = [];
      let start = spec.origin;
      for (const pitch of spec.cells) {
        const centre = start + pitch / 2;
        for (const offset of [0, -10.5, 10.5, -7, 7]) {
          const at = centre + offset;
          if (at - margin < Math.max(lo, start, bb.min[vAxis]) || at + margin > Math.min(hi, start + pitch, bb.max[vAxis])) continue;
          const column = tabSolid(axis === 'x', cut, at, floorZ + 0.05, bb.max[2] + 1, clearance);
          if (column.intersect(part).volume() > 0.01) continue;
          positions.push(at);
          break;
        }
        start += pitch;
      }
      cache.set(key, positions);
      onCut(positions.length);
      return positions;
    },
  };
}

function generatePart(req: GenerateRequest): GenerateResult {
  const { part, x, y, connector: plateConnector, base, warnings, info = [] } = build(req);
  let connector = plateConnector;
  let placed = false;
  let missing = false;
  const bb = part.boundingBox();
  const size: Vec3 = [bb.max[0] - bb.min[0], bb.max[1] - bb.min[1], bb.max[2] - bb.min[2]];
  const print = req.print;

  let pieces: Piece[] = [{ name: base, part, ix: 0, iy: 0 }];
  if (print.split) {
    if ((req.kind === 'bin' || req.kind === 'lid') && print.connector === 'dovetail') {
      const floorZ = req.kind === 'bin' ? binLayout(req.bin).floorZ : 7;
      if (floorZ - BASE_PROFILE_HEIGHT < 1.5) {
        warnings.push('Floor too thin for dovetails (needs 1.5 mm); pieces join flat');
      } else {
        connector = floorConnector(part, x, y, floorZ, print.clearance, count => {
          placed ||= count > 0;
          missing ||= count === 0;
        });
      }
    }
    if (connector && req.kind === 'plate') {
      const tabsAt = connector.tabsAt;
      connector = { ...connector, tabsAt: (...args) => {
        const positions = tabsAt(...args);
        placed ||= positions.length > 0;
        missing ||= positions.length === 0;
        return positions;
      } };
    }
    let plan = planSplit(x, y, print.bedX, print.bedY, connector ? DOVETAIL_DEPTH : 0);
    if (!plan && connector) {
      connector = undefined;
      plan = planSplit(x, y, print.bedX, print.bedY);
      if (plan) warnings.push('Dovetails need 5 mm of extra room per piece; this bed only fits flat joints');
    }
    if (!plan) {
      warnings.push('A single grid cell is larger than the print bed, so the part cannot be split to fit.');
    } else if (plan.xCuts.length || plan.yCuts.length) {
      let split = splitPart(part, plan, connector);
      if (connector && !placed) {
        connector = undefined;
        plan = planSplit(x, y, print.bedX, print.bedY)!;
        split = splitPart(part, plan);
      }
      pieces = split.map((pc) => ({ ...pc, name: `${base}-${pc.name}` }));
      if (req.kind === 'plate' && missing) warnings.push('No room for a dovetail on one or more cuts: glue those seams');
      if (req.kind === 'holder') warnings.push('Split holders join with flat faces: glue the pieces together.');
      if (req.kind === 'bin' || req.kind === 'lid') {
        if (missing) warnings.push('No room for a dovetail on one or more cuts: glue those seams');
        if (placed) warnings.push('Dovetails align the floor; glue the wall seams for strength.');
        else if (!connector) warnings.push('Split bins and lids join with flat faces: glue the pieces together.');
      }
    }
  }

  const out = pieces.map((pc) => toMesh(pc.name, pc.part, print));
  if (out.some((m) => !m.fitsBed)) {
    warnings.push(print.split ? 'Some pieces are still larger than the print bed.' : 'This part is larger than the print bed. Turn on "Split to fit bed".');
  }
  return { pieces: out, warnings, info, size };
}

function shiftX(p: MeshOut, dx: number): MeshOut {
  const positions = p.positions.slice();
  for (let i = 0; i < positions.length; i += 3) positions[i] += dx;
  return { ...p, positions, min: [p.min[0] + dx, p.min[1], p.min[2]], max: [p.max[0] + dx, p.max[1], p.max[2]] };
}

export function generate(req: GenerateRequest): GenerateResult {
  const result = generatePart(req);
  if (req.kind !== 'bin' || !req.bin.withLid) return result;
  if (req.bin.lip !== 'normal') {
    result.warnings.push('Lids need the stacking lip');
    return result;
  }
  const lid = generatePart({ ...req, kind: 'lid', lid: {
    ...defaultLid, width: req.bin.width, depth: req.bin.depth, magnets: req.bin.magnets,
  } });
  const base = result.pieces[0].name.replace(/-piece-\d+-\d+$/, '');
  const lidBase = `gridfinity-lid-${req.bin.width}x${req.bin.depth}`;
  // Park the lid beside the bin so previews don't draw it through the bin floor.
  // Exports re-centre every piece, so this only affects the preview.
  const shift = Math.max(...result.pieces.map((p) => p.max[0])) - Math.min(...lid.pieces.map((p) => p.min[0])) + 15;
  result.pieces.push(...lid.pieces.map((piece) => ({ ...shiftX(piece, shift), name: piece.name.replace(lidBase, `${base}-lid`) })));
  result.warnings = [...new Set([...result.warnings, ...lid.warnings])];
  return result;
}
