export const MATERIALS = {
  PLA: 1.24,
  PETG: 1.27,
  ABS: 1.04,
} as const;

export type Material = keyof typeof MATERIALS;

const FILAMENT_DIAMETER = 1.75;

export interface FilamentEstimate {
  grams: number;
  metres: number;
}

/**
 * Material for a part printed fully solid (100 % infill). Real prints with
 * normal infill use less, so this is an upper bound.
 */
export function estimateFilament(volumeMm3: number, material: Material): FilamentEstimate {
  const grams = (volumeMm3 / 1000) * MATERIALS[material];
  const area = Math.PI * (FILAMENT_DIAMETER / 2) ** 2;
  return { grams, metres: volumeMm3 / area / 1000 };
}
