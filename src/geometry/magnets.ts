import type { Manifold, Vec2 } from 'manifold-3d';
import { MAGNET_DIAMETER, MAGNET_DEPTH, MAGNET_CRUSH_INNER_RADIUS, MAGNET_CRUSH_RIBS, MAGNET_CHAMFER, REFINED_RADIUS, REFINED_HEIGHT, REFINED_BOTTOM } from './constants';
import { box, cylinderAt, k, prism } from './kernel';
export type MagnetStyle = 'plain' | 'crush' | 'refined';
export interface MagnetOptions { magnetStyle: MagnetStyle; magnetChamfer: boolean }

/** Cutter opens at z=0; refined insertion points along +X. */
export function magnetCutter(style: MagnetStyle = 'plain', chamfer = false): Manifold {
  if (style === 'refined') {
    const z = REFINED_BOTTOM, h = z + REFINED_HEIGHT;
    return k().Manifold.union([
      cylinderAt(0, 0, z, h, REFINED_RADIUS), box(0, 11, -REFINED_RADIUS, REFINED_RADIUS, z, h),
      box(-6.93, -2.53, -1.25, 1.25, -0.2, h), cylinderAt(-6.93, 0, -0.2, h, 1.25),
    ]);
  }
  const r = MAGNET_DIAMETER / 2;
  let hole: Manifold;
  if (style === 'crush') {
    const points: Vec2[] = Array.from({ length: 128 }, (_, i) => {
      const a = i * 2 * Math.PI / 128;
      const radius = (r + MAGNET_CRUSH_INNER_RADIUS) / 2 + (r - MAGNET_CRUSH_INNER_RADIUS) / 2 * Math.sin(MAGNET_CRUSH_RIBS * a);
      return [radius * Math.cos(a), radius * Math.sin(a)];
    });
    hole = prism(k().CrossSection.ofPolygons([points]), -0.01, MAGNET_DEPTH);
  } else hole = cylinderAt(0, 0, -0.01, MAGNET_DEPTH, r, 128);
  if (chamfer) hole = hole.add(k().Manifold.cylinder(MAGNET_CHAMFER + 0.01, r + MAGNET_CHAMFER + 0.01, r, 128).translate([0, 0, -0.01]));
  return hole;
}
