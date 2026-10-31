import { SINGLE_PRESETS, presetItems, type NewHolderPreset } from './holder-presets';
import { type MagnetOptions } from './magnets';
import type { CrossSection, Manifold, Vec2 } from 'manifold-3d';
import { binLayout, buildBin, defaultBin, type BinParams, type LipStyle } from './bin';
import { BASE_PROFILE_HEIGHT, BASE_TOP_RADIUS, HEIGHT_UNIT, SCREW_DEPTH } from './constants';
import { k, loft, prism, roundedRect, subtractAll } from './kernel';

export type HolderPreset = 'aa' | 'aaa' | '18650' | '21700' | 'cr2032' | 'hex14' | 'hex4' | 'sd' | 'microsd' | 'pen' | 'marker' | 'socket14' | 'socket38' | 'custom' | NewHolderPreset;
export interface HolderParams extends MagnetOptions {
  width: number;
  depth: number;
  lip: LipStyle;
  magnets: boolean;
  screws: boolean;
  heightMode: 'auto' | 'units';
  height: number;
  preset: HolderPreset;
  shape: 'round' | 'hex' | 'slot' | 'rect' | 'post';
  size: number;
  slotThickness: number;
  pocketDepth: number;
  clearance: number;
  spacing: number;
  margin: number;
  layout: 'grid' | 'staggered';
  hexPointForward: boolean;
  slotLean: number;
  fingerNotch: boolean;
}

export function presetValues(preset: HolderPreset): Partial<HolderParams> {
  if (preset === 'custom') return {};
  const common = { clearance: 0, spacing: 2, slotThickness: 2.4, slotLean: 0, fingerNotch: false };
  const round = (size: number, pocketDepth: number): Partial<HolderParams> => ({ ...common, shape: 'round', size, pocketDepth });
  const hex = (size: number, pocketDepth: number): Partial<HolderParams> => ({ ...common, shape: 'hex', size, pocketDepth });
  const single = SINGLE_PRESETS[preset as keyof typeof SINGLE_PRESETS];
  if(single) return {...common, ...single};
  const items=presetItems(preset);
  if(items) return {...common, shape:items[0].shape, size:items[0].size, fingerNotch:!!items[0].fingerNotch, pocketDepth:Math.max(...items.map(item=>item.pocketDepth))};
  switch (preset) {
    case 'aa': return round(15.1, 13);
    case 'aaa': return round(11.1, 11);
    case '18650': return round(19.2, 16);
    case '21700': return round(22.2, 17);
    case 'cr2032': return { ...round(20.6, 2), fingerNotch: true };
    case 'hex14': return hex(6.75, 11);
    case 'hex4': return hex(4.4, 6);
    case 'sd': return { ...common, shape: 'slot', size: 24.4, slotThickness: 2.4, pocketDepth: 8, slotLean: 10 };
    case 'microsd': return { ...common, shape: 'slot', size: 11.3, slotThickness: 1.3, pocketDepth: 8, slotLean: 10 };
    case 'pen': return round(10.5, 20);
    case 'marker': return round(13.8, 20);
    case 'socket14': return { ...common, shape: 'post', size: 6.2, pocketDepth: 7, spacing: 22 - 6.2 };
    case 'socket38': return { ...common, shape: 'post', size: 9.4, pocketDepth: 9, spacing: 30 - 9.4 };
    default: throw new Error('Unknown holder preset.');
  }
}

export const defaultHolder: HolderParams = {
  width: 2, depth: 2, lip: 'normal', magnets: false, magnetStyle: 'plain', magnetChamfer: false, screws: false,
  heightMode: 'auto', height: 4, preset: 'custom', shape: 'round', size: 15.1,
  slotThickness: 2.4, pocketDepth: 13, clearance: 0.25, spacing: 2, margin: 3,
  layout: 'grid', hexPointForward: false, slotLean: 0, fingerNotch: false,
};

function validate(p: HolderParams): void {
  if (![p.width, p.depth].every(n => Number.isFinite(n) && n >= 0.5 && n <= 12 && Number.isInteger(n * 2))) throw new Error('Holder width and depth must use half-unit steps from 0.5 to 12.');
  if (![p.size, p.slotThickness, p.pocketDepth, p.height].every(n => Number.isFinite(n) && n > 0) || ![p.spacing, p.margin, p.clearance, p.slotLean].every(n => Number.isFinite(n) && n >= 0)) throw new Error('Holder dimensions must be positive, with nonnegative spacing and clearance.');
  if (p.slotLean > 15 || !['round', 'hex', 'slot', 'rect', 'post'].includes(p.shape)) throw new Error('Invalid holder shape or slot lean (0–15°).');
  if (p.shape === 'post' && p.size - 2 * p.clearance <= 1.6) throw new Error('Post size after clearance must exceed 1.6 mm for the top chamfer.');
}

export function holderBinParams(p: HolderParams): BinParams {
  const set=presetItems(p.preset);
  if(set) p={...p,shape:set[0].shape,pocketDepth:Math.max(...set.map(item=>item.pocketDepth))};
  validate(p);
  const base = { ...defaultBin, width: p.width, depth: p.depth, lip: p.lip, magnets: p.magnets, magnetStyle: p.magnetStyle, magnetChamfer: p.magnetChamfer, screws: p.screws, heightMode: 'units' as const };
  const L = binLayout(base);
  const support = L.top - L.interiorTop;
  // Keep a roof over the standard screw bores as well as the 1.2 mm pocket floor.
  const bottom = Math.max(BASE_PROFILE_HEIGHT + 1.2, p.screws ? SCREW_DEPTH + 0.6 : 0);
  const needed = p.shape === 'post' ? L.floorZ + p.pocketDepth + 3 + support : bottom + Math.max(p.pocketDepth, ... (presetItems(p.preset)?.map(item=>item.pocketDepth) ?? [])) + support;
  const height = p.heightMode === 'auto' ? Math.ceil((needed - 1e-9) / HEIGHT_UNIT) : p.height;
  if (!Number.isInteger(height) || height * HEIGHT_UNIT < needed - 1e-6) throw new Error(`Holder height is too low; use at least ${Math.ceil(needed / HEIGHT_UNIT)} height units or Auto height.`);
  const params = { ...base, height };
  // A raised bin floor makes a solid deck while reusing the bin's exact lip and base.
  if (p.shape !== 'post') params.floor = binLayout(params).interiorTop - BASE_PROFILE_HEIGHT;
  return params;
}

export function holderOutline(p: HolderParams): CrossSection {
  const size = p.size + (p.shape === 'post' ? -2 : 2) * p.clearance;
  if (p.shape === 'round') {
    let cs = k().CrossSection.circle(size / 2, 48);
    if (p.fingerNotch) cs = cs.add(k().CrossSection.square([size * 0.45, size / 2 + 2]).translate([-size * 0.225, -size / 2 - 2]));
    return cs;
  }
  if (p.shape === 'hex') {
    const radius = size / Math.sqrt(3);
    const angle = p.hexPointForward ? Math.PI / 2 : 0;
    return k().CrossSection.ofPolygons([Array.from({ length: 6 }, (_, i) => [radius * Math.cos(angle + i * Math.PI / 3), radius * Math.sin(angle + i * Math.PI / 3)] as Vec2)]);
  }
  const d = (p.shape === 'slot' || p.shape === 'rect') ? p.slotThickness + 2 * p.clearance : size;
  return k().CrossSection.square([size, d], true);
}

export function holderPocket(p: HolderParams, top: number, x = 0, y = 0): Manifold {
  let cut = prism(holderOutline(p), top - p.pocketDepth, top + 0.1);
  if (p.shape === 'slot') {
    const lean = Math.tan(p.slotLean * Math.PI / 180);
    cut = cut.warp(v => { v[1] += (v[2] - (top - p.pocketDepth / 2)) * lean; });
  }
  return cut.translate([x, y, 0]);
}

export function holderLayout(p: HolderParams) {
  const bin = holderBinParams(p);
  const L = binLayout(bin);
  const set=presetItems(p.preset);
  if(set) return setLayout(p, bin, set);
  const outline = holderOutline(p);
  const bounds = outline.bounds();
  const w = bounds.max[0] - bounds.min[0];
  const lean = p.shape === 'slot' ? (p.pocketDepth + 0.2) * Math.tan(p.slotLean * Math.PI / 180) : 0;
  const d = bounds.max[1] - bounds.min[1] + lean;
  const availableW = L.cavW - 2 * p.margin, availableD = L.cavD - 2 * p.margin;
  const fillW = p.shape === 'post' ? p.size : w;
  const fillD = p.shape === 'post' ? p.size : d;
  const pitch = fillW + p.spacing;
  const stagger = p.layout === 'staggered' && (p.shape === 'round' || p.shape === 'hex');
  const rowPitch = stagger ? pitch * Math.sqrt(3) / 2 : fillD + p.spacing;
  const cols = Math.max(0, Math.floor((availableW + p.spacing + 1e-9) / pitch));
  const rows = Math.max(0, Math.floor((availableD - fillD + 1e-9) / rowPitch) + 1);
  if (cols * rows > 2000) throw new Error('More than 2000 holder positions; increase size or spacing, or reduce the footprint.');
  const safe = roundedRect(L.cavW, L.cavD, Math.max(BASE_TOP_RADIUS - L.wall, 0.25)).offset(-1);
  const centres: Vec2[] = [];
  const spacedNotches: { shape: CrossSection; bounds: ReturnType<CrossSection['bounds']> }[] = [];
  // A swept slot's envelope includes the full lean; other shapes use their exact outline.
  const envelope = p.shape === 'slot' ? k().CrossSection.square([w, d], true) : outline;
  const shiftY = p.shape === 'slot' ? 0 : -(bounds.max[1] + bounds.min[1]) / 2;
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const x = (i - (cols - 1) / 2) * pitch + (stagger && j % 2 ? pitch / 2 : 0);
    const y = (j - (rows - 1) / 2) * rowPitch;
    if (x + w / 2 > availableW / 2 + 1e-6) continue;
    if (envelope.translate([x, y + shiftY]).subtract(safe).area() > 1e-6) continue;
    // Staggered finger notches can reach the preceding row; omit colliding pockets.
    if (stagger && p.fingerNotch && p.shape === 'round') {
      const shape = envelope.translate([x, y + shiftY]).offset(p.spacing / 2);
      const bounds = shape.bounds();
      if (spacedNotches.some(other => bounds.min[0] < other.bounds.max[0] && bounds.max[0] > other.bounds.min[0] && bounds.min[1] < other.bounds.max[1] && bounds.max[1] > other.bounds.min[1] && shape.intersect(other.shape).area() > 1e-6)) continue;
      spacedNotches.push({ shape, bounds });
    }
    centres.push([x, y + shiftY]);
  }
  return { bin, surface: L.floorZ, centres, count: centres.length, total: undefined as number | undefined, items: undefined as PlacedItem[] | undefined, rows: [] as string[][] };
}

export function buildHolder(p: HolderParams): Manifold {
  const layout = holderLayout(p);
  let part = buildBin(layout.bin);
  if(layout.items) return subtractAll(part,layout.items.map(item=>holderPocket({...p,...item,fingerNotch:!!item.fingerNotch,clearance:0},layout.surface,item.x,item.y)));
  if (p.shape !== 'post') return subtractAll(part, layout.centres.map(([x, y]) => holderPocket(p, layout.surface, x, y)));
  const side = p.size - 2 * p.clearance;
  const half = side / 2;
  const chamfer = Math.min(0.8, p.pocketDepth / 2);
  const square = (inset: number, x: number, y: number): Vec2[] => [
    [x - half + inset, y - half + inset], [x + half - inset, y - half + inset],
    [x + half - inset, y + half - inset], [x - half + inset, y + half - inset],
  ];
  const posts = layout.centres.map(([x, y]) => loft([
    { z: layout.surface - 0.01, outline: square(0, x, y) },
    { z: layout.surface + p.pocketDepth - chamfer, outline: square(0, x, y) },
    { z: layout.surface + p.pocketDepth, outline: square(chamfer, x, y) },
  ]));
  if (posts.length) part = part.add(k().Manifold.union(posts));
  return part;
}

export interface PlacedItem { shape:'round'|'hex'; size:number; pocketDepth:number; label:string; fingerNotch?:boolean; x:number; y:number; row:number }
function setLayout(p:HolderParams,bin:BinParams,set:NonNullable<ReturnType<typeof presetItems>>) {
  const L=binLayout(bin), safe=roundedRect(L.cavW,L.cavD,Math.max(BASE_TOP_RADIUS-L.wall,0.25)).offset(-Math.max(1,p.margin));
  const w=L.cavW-2*Math.max(1,p.margin),d=L.cavD-2*Math.max(1,p.margin);
  let x=-w/2,y=-d/2,rowHeight=0,row=0;
  const items:PlacedItem[]=[],rows:string[][]=[];
  for(const item of set) {
    const outline=holderOutline({...p,...item,clearance:0}),bounds=outline.bounds();
    const iw=bounds.max[0]-bounds.min[0],ih=bounds.max[1]-bounds.min[1];
    if(x+iw>w/2+1e-6) {x=-w/2;y+=rowHeight+p.spacing;rowHeight=0;row++;}
    let placed=false;
    for(let n=0;n<16 && !placed;n++) {
      if(iw>w+1e-6 || y+ih>d/2+1e-6) break;
      if(x+iw>w/2+1e-6) {x=-w/2;y+=rowHeight>0?rowHeight+p.spacing:0.5;rowHeight=0;row++;continue;}
      const cx=x-bounds.min[0],cy=y-bounds.min[1];
      if(outline.translate([cx,cy]).subtract(safe).area()<1e-6) {
        items.push({...item,x:cx,y:cy,row});(rows[row]??=[]).push(item.label);
        x+=iw+p.spacing;rowHeight=Math.max(rowHeight,ih);placed=true;
      } else if(x===-w/2) {x+=1;} else {x=-w/2;y+=rowHeight+p.spacing;rowHeight=0;row++;}
    }
    if(!placed) break;
  }
  return {bin,surface:L.floorZ,centres:items.map(item=>[item.x,item.y] as Vec2),count:items.length,total:set.length,items,rows:rows.filter(row=>row.length)};
}
