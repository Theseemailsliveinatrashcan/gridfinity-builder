/**
 * Gridfinity dimensions (mm). Values follow gridfinity-rebuilt-openscad
 * (kennetek, MIT, src/core/standard.scad and src/core/gridfinity-baseplate.scad),
 * which in turn follows Zack Freedman's original Gridfinity (MIT).
 */
export const GRID = 42;
export const HEIGHT_UNIT = 7;

// Bin base ("foot"): profile listed bottom to top as [inset from top outline, z].
export const BASE_TOP_SIZE_GAP = 0.5; // 41.5 mm foot top for a 42 mm cell
export const BASE_TOP_RADIUS = 3.75;
export const BASE_PROFILE: [number, number][] = [
  [2.95, 0],
  [2.15, 0.8],
  [2.15, 2.6],
  [0, 4.75],
];
export const BASE_PROFILE_HEIGHT = 4.75;
export const BASE_HEIGHT = 7; // foot + bridge; default floor sits here

// Stacking lip, profile from the inner tip outward/upward.
export const LIP_HEIGHT = 4.4; // theoretical (0.7 + 1.8 + 1.9)
export const LIP_TIP_TRIM = 0.6; // flat top instead of a knife edge (~3.8 printed)
export const LIP_DEPTH = 2.6; // how far the lip reaches in from the outer wall
export const LIP_SUPPORT_HEIGHT = 1.2;

// Holes in the bin base.
export const MAGNET_DIAMETER = 6.5;
export const MAGNET_DEPTH = 2.4;
export const SCREW_DIAMETER = 3;
export const SCREW_DEPTH = 6;
export const HOLE_OFFSET = 13; // from cell centre, both axes (8 mm from cell edge)

// Bin interior defaults.
export const DIVIDER_THICKNESS = 1.2;
export const TAB_DEPTH = 15.85;
export const TAB_ANGLE_DEG = 36;
export const TAB_TIP = 1.2;

// Baseplate socket.
export const BASEPLATE_HEIGHT = 5;
export const BASEPLATE_OUTER_RADIUS = 4;
export const BASEPLATE_INNER_SIZE = 36.3; // 42 - 2 * 2.85
export const BASEPLATE_INNER_RADIUS = 1.15;
// Socket cutter profile, bottom to top, as [inset from 42 mm cell, z above socket floor].
export const BASEPLATE_PROFILE: [number, number][] = [
  [2.85, 0],
  [2.85, 0.35],
  [2.15, 1.05],
  [2.15, 2.85],
  [0, 5],
];
export const WEIGHTED_BOTTOM = 6.4;
export const WEIGHT_POCKET_SIZE = 21.4;
export const WEIGHT_POCKET_DEPTH = 4;
export const SOLID_BOTTOM = 3.2; // room for 2.4 mm magnet pockets plus a floor

// Baseplate screw-down hardware (gridfinity-rebuilt standard.scad).
export const SCREW_HOLE_RADIUS = 1.5;
export const BASEPLATE_SCREW_COUNTERSINK_ADDITIONAL_RADIUS = 5 / 2;
export const BASEPLATE_SCREW_COUNTERBORE_RADIUS = 5.5 / 2;
export const BASEPLATE_SCREW_COUNTERBORE_HEIGHT = 3;
// 3 mm head recess with 0.6 mm of material beneath its shoulder.
export const MOUNT_BOTTOM = BASEPLATE_SCREW_COUNTERBORE_HEIGHT + 0.6;

export const MAGNET_CRUSH_INNER_RADIUS = 5.9 / 2;
export const MAGNET_CRUSH_RIBS = 8;
export const MAGNET_CHAMFER = 0.8;
export const REFINED_RADIUS = 5.86 / 2;
export const REFINED_HEIGHT = 1.9;
export const REFINED_BOTTOM = 0.4;
