import type { Manifold } from 'manifold-3d';
import { binLayout, buildBin, type BinParams } from './bin';
import { DIVIDER_THICKNESS, TAB_DEPTH, TAB_ANGLE_DEG, TAB_TIP } from './constants';
import { box, extrudeAlongX, extrudeAlongY, prism, roundedLoft, roundedRect, subtractAll } from './kernel';

// Independently modelled from Cullen J Webb's MIT V2 standard; see notices.
export const CULLENECT_HEIGHT = 11;
export const CULLENECT_DEPTH = 1.2;
export const LEGACY_GROOVE_CENTRES = [-12.133, 0, 12.133];
export function cullenectCavity(width: number, play: number): Manifold {
  return prism(roundedRect(width + 2 * play, 11 + 2 * play, 0.5 + play), -1.2 - play, 0.02);
}
export function cullenectSocket(width: number, play: number): Manifold {
  const outside = roundedRect(width + 2 * play + 1.6, 11 + 2 * play + 1.6, 1.3 + play);
  const opening = roundedRect(width + 2 * play, 11 + 2 * play, 0.5 + play);
  // Upstream: 0.3 mm total mouth offset and 0.2 mm ribs => 0.05 mm capture.
  // The aperture remains fixed while play changes only the cavity behind it.
  const leadBottom = -0.95 - play - 0.05;
  const aperture = roundedLoft(width + 2 * play, 11 + 2 * play, 0.5 + play, [
    { z: leadBottom - 0.01, inset: 0 }, { z: leadBottom, inset: 0 },
    { z: -0.95, inset: play + 0.05 }, { z: -0.55, inset: play + 0.05 },
    { z: -0.35, inset: play - 0.15 }, { z: -0.34, inset: play - 0.15 },
  ]);
  const lip = prism(opening.offset(0.01), leadBottom, -0.35).subtract(aperture);
  return prism(outside, -3.01, 0).subtract(cullenectCavity(width, play)).add(lip);
}

/** V2 reference label, face at z=0. Legacy rear grooves apply only to 1U. */
export function cullenectReferenceCard(width: number): Manifold {
  const face = roundedRect(width, 11, 0.5);
  const cuts = [prism(face.subtract(roundedRect(width - 0.4, 10.6, 0.3)), -1, -0.4)];
  if (width === 36) for (const x of LEGACY_GROOVE_CENTRES) {
    cuts.push(extrudeAlongY([[-1.21, x - 0.5], [-1, x - 0.5], [-1, x - 1], [-0.4, x - 1],
      [-0.4, x + 1], [-1, x + 1], [-1, x + 0.5], [-1.21, x + 0.5]], -5.51, 5.51));
  }
  return subtractAll(prism(face, -1.2, 0), cuts);
}

export interface CullenectPlacement { width: number; x: number; y: number; z: number; wall: boolean }
export function cullenectLayout(p: BinParams): CullenectPlacement[] {
  if (p.labelSlot !== 'cullenect' || p.solid || p.vase) return [];
  const L = binLayout(p), play = p.socketClearance;
  if (!Number.isFinite(play) || play < 0.1 || play > 0.4) throw new Error('Cullenect socket clearance must be 0.1–0.4 mm per side.');
  const nx = Math.max(1, Math.round(p.compartmentsX)), ny = Math.max(1, Math.round(p.compartmentsY));
  const w = (L.cavW - (nx - 1) * DIVIDER_THICKNESS) / nx, d = (L.cavD - (ny - 1) * DIVIDER_THICKNESS) / ny;
  const wall = p.tab === 'none', tabW = p.tab === 'full' || wall ? w : Math.min(42, w);
  const units = Math.floor((tabW - 2 * play - 1.6 + 6 + 1e-6) / 21) / 2;
  if (units < 0.5) throw new Error('Compartments too narrow for Cullenect label sockets (needs a 15 mm card plus walls).');
  const width = units * 42 - 6, socketH = 11 + 2 * play + 1.6, tabD = Math.min(TAB_DEPTH, d / 2);
  if (wall && L.interiorTop - L.floorZ < socketH + 0.2) throw new Error('Bin too short for a Cullenect wall socket; increase height.');
  if (!wall && (tabD < socketH || Math.tan(TAB_ANGLE_DEG * Math.PI / 180) * tabD + TAB_TIP >= L.interiorTop - L.floorZ - 1)) throw new Error('Compartment too shallow or short for a Cullenect socket on the label tab.');
  const out: CullenectPlacement[] = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    let x = -L.cavW / 2 + i * (w + DIVIDER_THICKNESS) + w / 2;
    if (p.tab === 'left') x -= (w - tabW) / 2;
    if (p.tab === 'right') x += (w - tabW) / 2;
    const back = -L.cavD / 2 + j * (d + DIVIDER_THICKNESS) + d;
    out.push({ width, x, y: wall ? back - 3 : back - tabD / 2, z: wall ? L.floorZ + socketH / 2 + 0.1 : L.interiorTop, wall });
  }
  return out;
}
export function placeCullenect(m: Manifold, at: CullenectPlacement): Manifold {
  return (at.wall ? m.rotate([90, 0, 0]) : m).translate([at.x, at.y, at.z]);
}
export function cullenectTabSupport(p: BinParams, at: CullenectPlacement): Manifold {
  const L = binLayout(p), nx = Math.max(1, Math.round(p.compartmentsX)), ny = Math.max(1, Math.round(p.compartmentsY));
  const w = (L.cavW - (nx - 1) * DIVIDER_THICKNESS) / nx, d = (L.cavD - (ny - 1) * DIVIDER_THICKNESS) / ny;
  const tabW = p.tab === 'full' ? w : Math.min(42, w), depth = Math.min(TAB_DEPTH, d / 2);
  const socketH = 11 + 2 * p.socketClearance + 1.6;
  const back = at.y + depth / 2, front = back - depth;
  const z = at.z - Math.max(TAB_TIP, 3.01 - (depth - socketH) / 2);
  // A full-width 45° wedge supports both the socket backing and the original tab.
  return extrudeAlongX([[front, z], [back + 0.01, z - depth - 0.01], [back + 0.01, at.z], [front, at.z]], at.x - tabW / 2 - 0.01, at.x + tabW / 2 + 0.01)
    .intersect(box(-1e4, 1e4, -1e4, 1e4, L.floorZ - 0.01, at.z));
}

export function addCullenectSockets(part: Manifold, p: BinParams): Manifold {
  const placements = cullenectLayout(p);
  if (!placements.length) return part;
  const envelope = buildBin({ ...p, solid: true, labelSlot: 'none', removableDividers: 'none',
    magnets: false, screws: false, tab: 'none', scoop: 0, withLid: false });
  for (const at of placements) {
    if (!at.wall) part = part.add(cullenectTabSupport(p, at).intersect(envelope));
    part = part.subtract(placeCullenect(cullenectCavity(at.width, p.socketClearance), at))
      .add(placeCullenect(cullenectSocket(at.width, p.socketClearance), at).intersect(envelope));
  }
  return part;
}
