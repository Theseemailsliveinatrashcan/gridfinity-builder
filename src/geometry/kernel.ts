import Module from 'manifold-3d';
import type { CrossSection, Manifold, ManifoldToplevel, Vec2, Vec3 } from 'manifold-3d';

let wasm: ManifoldToplevel | undefined;

/**
 * Every Manifold/CrossSection created by a library call is recorded here, so a
 * whole generation can be freed at once with freeAll(). WASM objects are not
 * garbage-collected, and geometry code is far clearer without manual delete().
 */
const arena: { delete(): void }[] = [];

function track(value: unknown): void {
  if (!wasm) return;
  if (value instanceof wasm.Manifold || value instanceof wasm.CrossSection) {
    arena.push(value);
  } else if (Array.isArray(value)) {
    value.forEach(track);
  }
}

function wrapMethods(target: Record<string, unknown>): void {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (name === 'constructor' || name === 'delete' || name === 'prototype') continue;
    const desc = Object.getOwnPropertyDescriptor(target, name);
    if (!desc || typeof desc.value !== 'function') continue;
    const fn = desc.value as (...args: unknown[]) => unknown;
    target[name] = function (this: unknown, ...args: unknown[]) {
      const result = fn.apply(this, args);
      track(result);
      return result;
    };
  }
}

export async function initKernel(locateFile?: () => string): Promise<ManifoldToplevel> {
  if (wasm) return wasm;
  const m = await Module(locateFile ? { locateFile } : undefined);
  m.setup();
  for (const cls of [m.Manifold, m.CrossSection] as unknown as Record<string, unknown>[]) {
    wrapMethods(cls);
    wrapMethods(cls.prototype as Record<string, unknown>);
  }
  wasm = m;
  return m;
}

export function k(): ManifoldToplevel {
  if (!wasm) throw new Error('Geometry kernel not initialised');
  return wasm;
}

export function freeAll(): void {
  for (const obj of arena.splice(0)) {
    try {
      obj.delete();
    } catch {
      // already deleted
    }
  }
}

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

const CORNER_SEGMENTS = 8;

/** Rounded-rectangle outline centred on the origin (CCW). */
export function roundedRectPoints(w: number, d: number, r: number, cx = 0, cy = 0): Vec2[] {
  const rr = Math.max(0.01, Math.min(r, w / 2 - 0.001, d / 2 - 0.001));
  const hx = w / 2 - rr;
  const hy = d / 2 - rr;
  const corners: [number, number, number][] = [
    [hx, hy, 0],
    [-hx, hy, 90],
    [-hx, -hy, 180],
    [hx, -hy, 270],
  ];
  const pts: Vec2[] = [];
  for (const [x, y, start] of corners) {
    for (let i = 0; i <= CORNER_SEGMENTS; i++) {
      const a = ((start + (90 * i) / CORNER_SEGMENTS) * Math.PI) / 180;
      pts.push([cx + x + rr * Math.cos(a), cy + y + rr * Math.sin(a)]);
    }
  }
  return pts;
}

/** Regular octagon with axis-aligned flats, given the across-flats width. */
export function octagonPoints(acrossFlats: number, cx = 0, cy = 0): Vec2[] {
  const R = acrossFlats / 2 / Math.cos(Math.PI / 8);
  const pts: Vec2[] = [];
  for (let i = 0; i < 8; i++) {
    const a = Math.PI / 8 + (i * Math.PI) / 4;
    pts.push([cx + R * Math.cos(a), cy + R * Math.sin(a)]);
  }
  return pts;
}

export function roundedRect(w: number, d: number, r: number, cx = 0, cy = 0): CrossSection {
  return k().CrossSection.ofPolygons([roundedRectPoints(w, d, r, cx, cy)]);
}

/** Extrude a cross-section between two Z heights. */
export function prism(cs: CrossSection, z0: number, z1: number): Manifold {
  return cs.extrude(z1 - z0).translate([0, 0, z0]);
}

export function box(x0: number, x1: number, y0: number, y1: number, z0: number, z1: number): Manifold {
  return k()
    .Manifold.cube([x1 - x0, y1 - y0, z1 - z0])
    .translate([x0, y0, z0]);
}

export interface Level {
  z: number;
  outline: Vec2[];
}

/**
 * Loft through a list of outlines at increasing Z. Each consecutive pair is
 * convex, so it is built as a hull; the segments are then unioned. This gives
 * exact 45-degree chamfers on rounded rectangles (the Gridfinity profiles).
 */
export function loft(levels: Level[]): Manifold {
  const parts: Manifold[] = [];
  for (let i = 0; i + 1 < levels.length; i++) {
    const a = levels[i];
    const b = levels[i + 1];
    if (b.z - a.z < 1e-6) continue;
    const pts: Vec3[] = [
      ...a.outline.map(([x, y]) => [x, y, a.z] as Vec3),
      ...b.outline.map(([x, y]) => [x, y, b.z] as Vec3),
    ];
    parts.push(k().Manifold.hull(pts));
  }
  return k().Manifold.union(parts);
}

/** Rounded-rectangle loft: each level gives z and an inset from (w, d, r). */
export function roundedLoft(
  w: number,
  d: number,
  r: number,
  levels: { z: number; inset: number }[],
  cx = 0,
  cy = 0,
): Manifold {
  return loft(
    levels.map(({ z, inset }) => ({
      z,
      outline: roundedRectPoints(w - 2 * inset, d - 2 * inset, Math.max(r - inset, 0.25), cx, cy),
    })),
  );
}

/**
 * Extrude a profile drawn in the (Y, Z) plane along X from x0 to x1.
 * The coordinate change is a cyclic permutation, so orientation is preserved.
 */
export function extrudeAlongX(profileYZ: Vec2[], x0: number, x1: number): Manifold {
  const cs = k().CrossSection.ofPolygons([ccw(profileYZ)]);
  return cs.extrude(x1 - x0).warp((v: Vec3) => {
    const t = v[2];
    v[2] = v[1];
    v[1] = v[0];
    v[0] = t + x0;
  });
}

/** Extrude a profile drawn in the (Z, X) plane along Y from y0 to y1. */
export function extrudeAlongY(profileZX: Vec2[], y0: number, y1: number): Manifold {
  const cs = k().CrossSection.ofPolygons([ccw(profileZX)]);
  return cs.extrude(y1 - y0).warp((v: Vec3) => {
    const u = v[0];
    v[0] = v[1];
    v[1] = v[2] + y0;
    v[2] = u;
  });
}

export function ccw(pts: Vec2[]): Vec2[] {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    area += x1 * y2 - x2 * y1;
  }
  return area >= 0 ? pts : [...pts].reverse();
}

export function cylinderAt(x: number, y: number, z0: number, z1: number, radius: number, segments = 32): Manifold {
  return k().Manifold.cylinder(z1 - z0, radius, radius, segments).translate([x, y, z0]);
}

export function unionAll(parts: Manifold[]): Manifold | undefined {
  if (parts.length === 0) return undefined;
  if (parts.length === 1) return parts[0];
  return k().Manifold.union(parts);
}

export function subtractAll(base: Manifold, cutters: Manifold[]): Manifold {
  const cut = unionAll(cutters);
  return cut ? base.subtract(cut) : base;
}
