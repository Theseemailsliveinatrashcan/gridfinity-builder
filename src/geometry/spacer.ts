import type { CrossSection, Manifold } from 'manifold-3d';
import { prism, roundedRect } from './kernel';
import { GRID } from './constants';

export type SpacerPreset = 'thin' | 'solid' | 'weighted' | 'custom';
export interface SpacerParams {
  length: number;
  width: number;
  height: number;
  preset: SpacerPreset;
  shape: 'straight' | 'corner';
  length2: number;
  lip: boolean;
}
export const SPACER_HEIGHTS = { thin: 5, solid: 8.2, weighted: 11.4 };
export const defaultSpacer: SpacerParams = {
  length: 200, width: 10, height: 5, preset: 'thin', shape: 'straight', length2: 100, lip: false,
};

export function spacerHeight(p: SpacerParams): number {
  return p.preset === 'custom' ? p.height : SPACER_HEIGHTS[p.preset];
}

export function spacerCells(length: number): number[] {
  const whole = Math.floor(length / GRID);
  const cells = Array<number>(whole).fill(GRID);
  const remainder = length - whole * GRID;
  if (remainder > 1e-6) cells.push(remainder);
  return cells;
}

function outline(p: SpacerParams, width: number): CrossSection {
  const horizontal = roundedRect(p.length, width, 1, p.length / 2, width / 2);
  return p.shape === 'straight' ? horizontal : horizontal.add(roundedRect(width, p.length2, 1, width / 2, p.length2 / 2));
}

export function buildSpacer(p: SpacerParams): Manifold {
  const height = spacerHeight(p);
  if (!Number.isFinite(p.length) || p.length < 20 || p.length > 1000 || !Number.isFinite(p.width) || p.width < 2 || p.width > 100 || !Number.isFinite(height) || height < 1.2 || height > 30) throw new Error('Spacer length must be 20–1000 mm, width 2–100 mm and height 1.2–30 mm.');
  if (!['straight', 'corner'].includes(p.shape)) throw new Error('Unknown spacer shape.');
  if (p.shape === 'corner' && (!Number.isFinite(p.length2) || p.length2 < 20 || p.length2 > 1000 || Math.min(p.length, p.length2) <= p.width + (p.lip ? 3 : 0))) throw new Error('Corner lengths must be 20–1000 mm and exceed the strip width plus ledge.');
  const body = prism(outline(p, p.width), 0, height);
  // The plate-facing edge is +Y (and +X on the second arm of a corner).
  return p.lip ? body.add(prism(outline(p, p.width + 3), 0, 1.2)) : body;
}
