import type { Manifold } from 'manifold-3d';
import { box, loft, octagonPoints, subtractAll } from './kernel';

/**
 * EXPERIMENTAL tile compatible with the MultiBoard wall system
 * (MultiBuild / Keep Making, https://www.multiboard.io). Modelled
 * independently from publicly reported dimensions; not official and not
 * endorsed. Verify the fit with a small test print before printing a wall.
 */
export const MB_PITCH = 25;
export const MB_THICKNESS = 6.4;
export const MB_LARGE_FACE = 23.4;
export const MB_LARGE_BAND = 21.4;
export const MB_LARGE_BAND_HEIGHT = 2.4;
export const MB_SMALL_FACE = 7.5;
export const MB_SMALL_BAND = 6.0;
export const MB_SMALL_BAND_HEIGHT = 2.9;

export interface TileParams {
  cols: number;
  rows: number;
  /** Peg holes on the outer edge vertices too (they become half/quarter holes). */
  edgePegHoles: boolean;
}

export const defaultTile: TileParams = { cols: 4, rows: 4, edgePegHoles: false };

/** Octagonal hole: wide at both faces, narrow band in the middle. */
function octagonHole(face: number, band: number, bandHeight: number, x: number, y: number): Manifold {
  const t = MB_THICKNESS;
  const z1 = (t - bandHeight) / 2;
  const z2 = z1 + bandHeight;
  const ext = 0.5;
  const slope = (face - band) / 2 / z1; // inset per mm of height
  return loft([
    { z: -ext, outline: octagonPoints(face + 2 * slope * ext, x, y) },
    { z: z1, outline: octagonPoints(band, x, y) },
    { z: z2, outline: octagonPoints(band, x, y) },
    { z: t + ext, outline: octagonPoints(face + 2 * slope * ext, x, y) },
  ]);
}

/** Tile spans x in [0, cols*25], y in [0, rows*25], z in [0, 6.4]. */
export function buildTile(p: TileParams): Manifold {
  const cols = Math.max(1, Math.round(p.cols));
  const rows = Math.max(1, Math.round(p.rows));
  const tile = box(0, cols * MB_PITCH, 0, rows * MB_PITCH, 0, MB_THICKNESS);
  const holes: Manifold[] = [];
  for (let i = 0; i < cols; i++) {
    for (let j = 0; j < rows; j++) {
      holes.push(octagonHole(MB_LARGE_FACE, MB_LARGE_BAND, MB_LARGE_BAND_HEIGHT, (i + 0.5) * MB_PITCH, (j + 0.5) * MB_PITCH));
    }
  }
  for (let i = 0; i <= cols; i++) {
    for (let j = 0; j <= rows; j++) {
      const edge = i === 0 || j === 0 || i === cols || j === rows;
      if (edge && !p.edgePegHoles) continue;
      holes.push(octagonHole(MB_SMALL_FACE, MB_SMALL_BAND, MB_SMALL_BAND_HEIGHT, i * MB_PITCH, j * MB_PITCH));
    }
  }
  return subtractAll(tile, holes);
}
