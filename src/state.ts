import { SECTIONS, type Field } from './fields';
import { defaultPlate } from './geometry/baseplate';
import { defaultBin } from './geometry/bin';
import { defaultLid } from './geometry/lid';
import type { GenerateRequest, PartKind } from './geometry/generate';
import { defaultTile } from './geometry/multiboard';

export const KINDS: PartKind[] = ['bin', 'lid', 'plate', 'tile'];

export const DEFAULTS: GenerateRequest = {
  kind: 'bin',
  bin: defaultBin,
  lid: defaultLid,
  plate: defaultPlate,
  tile: defaultTile,
  print: { split: false, bedX: 220, bedY: 220, connector: 'dovetail', clearance: 0.2 },
};

const FIELDS: Field[] = SECTIONS.flatMap((s) => s.fields);

/** Clamp a value to what the form allows; fall back to the default otherwise. */
function clean(f: Field, value: unknown, fallback: unknown): unknown {
  switch (f.kind) {
    case 'toggle':
      return typeof value === 'boolean' ? value : fallback;
    case 'select':
      return f.options?.some(([v]) => v === value) ? value : fallback;
    default: {
      const n = typeof value === 'number' ? value : Number.NaN;
      if (!Number.isFinite(n)) return fallback;
      return Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
    }
  }
}

/**
 * Build a safe request from untrusted input (a shared link). Only known
 * fields are kept, each limited to the range the form offers, so a link can
 * never ask the worker for more than the UI could.
 */
export function sanitize(input: unknown): GenerateRequest {
  const s = (input && typeof input === 'object' ? input : {}) as Record<string, Record<string, unknown> | undefined>;
  const out = structuredClone(DEFAULTS);
  const kind = (s as Record<string, unknown>).kind;
  if (KINDS.includes(kind as PartKind)) out.kind = kind as PartKind;
  for (const f of FIELDS) {
    const group = out[f.group] as unknown as Record<string, unknown>;
    const src = s[f.group];
    if (src && typeof src === 'object' && f.key in src) group[f.key] = clean(f, src[f.key], group[f.key]);
  }
  return out;
}

export function encodeState(state: GenerateRequest): string {
  return btoa(encodeURIComponent(JSON.stringify(state)));
}

export function decodeState(hash: string): GenerateRequest {
  try {
    return sanitize(hash ? JSON.parse(decodeURIComponent(atob(hash))) : {});
  } catch {
    return sanitize({});
  }
}
