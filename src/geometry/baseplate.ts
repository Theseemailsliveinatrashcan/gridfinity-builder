import { magnetCutter } from './magnets';
import type { Manifold } from 'manifold-3d';
import {
  SKELETON_RADIUS, SKELETON_MIN_BOTTOM, CONNECTION_DIAMETER, CONNECTION_BOTTOM, CONNECTION_REACH,
  MAGNET_DEPTH, MAGNET_DIAMETER,
  BASEPLATE_HEIGHT,
  SCREW_HOLE_RADIUS,
  BASEPLATE_SCREW_COUNTERSINK_ADDITIONAL_RADIUS,
  BASEPLATE_SCREW_COUNTERBORE_RADIUS,
  BASEPLATE_SCREW_COUNTERBORE_HEIGHT,
  MOUNT_BOTTOM,
  BASEPLATE_OUTER_RADIUS,
  BASEPLATE_PROFILE,
  GRID,
  HOLE_OFFSET,
  SOLID_BOTTOM,
  WEIGHTED_BOTTOM,
  WEIGHT_POCKET_DEPTH,
  WEIGHT_POCKET_SIZE,
} from './constants';
import { box, cylinderAt, k, prism, roundedLoft, roundedRect, subtractAll, unionAll } from './kernel';

export type PlateStyle = 'thin' | 'solid' | 'weighted' | 'skeletonized';

export interface PlateParams {
  width: number;
  depth: number;
  style: PlateStyle;
  magnets: boolean;
  magnetStyle: 'plain' | 'crush';
  magnetChamfer: boolean;
  halfCells: boolean;
  connectScrews: boolean;
  mountHoles: 'none' | 'countersink' | 'counterbore';
  /** Drawer interior size in mm; 0 means "use width/depth in units". */
  drawerW: number;
  drawerD: number;
  /** Where leftover drawer space goes: -1 all at the start, 0 split evenly, 1 all at the end. */
  alignX: number;
  alignY: number;
}

export const defaultPlate: PlateParams = {
  width: 3,
  depth: 3,
  style: 'thin',
  magnets: false, magnetStyle: 'plain', magnetChamfer: false,
  halfCells: false,
  connectScrews: false,
  mountHoles: 'none',
  drawerW: 0,
  drawerD: 0,
  alignX: 0,
  alignY: 0,
};

export interface AxisLayout {
  cells: number[];
  centres: number[];
  units: number;
  padStart: number;
  padEnd: number;
  length: number;
}

export interface PlateLayout {
  x: AxisLayout;
  y: AxisLayout;
  bottom: number;
  height: number;
}

function axis(units: number, drawer: number, align: number, halfCells: boolean): AxisLayout {
  if (drawer > 0) {
    const n = Math.max(halfCells ? 0 : 1, Math.floor(drawer / GRID + 1e-9));
    const pad = Math.max(0, drawer - n * GRID);
    const a = Math.min(1, Math.max(-1, align));
    let padStart = (pad * (1 + a)) / 2, padEnd = pad - padStart;
    const cells = Array<number>(n).fill(GRID);
    if (halfCells && pad >= GRID / 2 - 1e-9) {
      if (padStart >= GRID / 2 && padEnd >= GRID / 2) {
        cells.unshift(GRID / 2); cells.push(GRID / 2);
        padStart -= GRID / 2; padEnd -= GRID / 2;
      } else {
        if (padStart > padEnd) cells.unshift(GRID / 2); else cells.push(GRID / 2);
        const remaining = pad - GRID / 2;
        padStart = remaining * (1 + a) / 2; padEnd = remaining - padStart;
      }
    }
    let start = padStart;
    const centres = cells.map(pitch => { const centre = start + pitch / 2; start += pitch; return centre; });
    return { units: n, cells, centres, padStart, padEnd, length: n * GRID + pad };
  }
  const n = Math.max(1, Math.round(units));
  return { units: n, cells: Array(n).fill(GRID), centres: Array.from({ length: n }, (_, i) => (i + 0.5) * GRID), padStart: 0, padEnd: 0, length: n * GRID };
}

export function plateBottom(p: PlateParams): number {
  if (p.connectScrews) return CONNECTION_BOTTOM;
  if (p.style === 'skeletonized') return SKELETON_MIN_BOTTOM + (p.magnets ? MAGNET_DEPTH : 0) + (p.mountHoles === 'countersink' ? 2.5 : p.mountHoles === 'counterbore' ? 3 : CONNECTION_DIAMETER);
  if (p.style === 'weighted') return WEIGHTED_BOTTOM;
  if (p.mountHoles !== 'none') return MOUNT_BOTTOM;
  if (p.style === 'solid' || p.magnets) return SOLID_BOTTOM;
  return 0;
}

export function plateLayout(p: PlateParams): PlateLayout {
  const bottom = plateBottom(p);
  return {
    x: axis(p.width, p.drawerW, p.alignX, p.halfCells),
    y: axis(p.depth, p.drawerD, p.alignY, p.halfCells),
    bottom,
    height: bottom + BASEPLATE_HEIGHT,
  };
}

export function socketCutter(w: number, d: number, cx: number, cy: number, bottom: number): Manifold {
  const levels = BASEPLATE_PROFILE.map(([inset, z]) => ({ z: bottom + z, inset }));
  if (bottom === 0) levels[0] = { z: -1, inset: levels[0].inset };
  levels.push({ z: bottom + BASEPLATE_HEIGHT + 1, inset: -1 });
  return roundedLoft(w, d, BASEPLATE_OUTER_RADIUS, levels, cx, cy);
}

/** Plate spans x in [0, length.x], y in [0, length.y], z in [0, height]. */
export function buildPlate(p: PlateParams): Manifold {
  const L = plateLayout(p);
  const W = L.x.length;
  const D = L.y.length;
  const plate = prism(roundedRect(W, D, BASEPLATE_OUTER_RADIUS, W / 2, D / 2), 0, L.height);

  const cutters: Manifold[] = [];
  for (let i = 0; i < L.x.cells.length; i++) {
    for (let j = 0; j < L.y.cells.length; j++) {
      const cx = L.x.centres[i];
      const cy = L.y.centres[j];
      const cellW = L.x.cells[i], cellD = L.y.cells[j];
      cutters.push(socketCutter(cellW, cellD, cx, cy, L.bottom));
    }
  }
  const hardware = plateHardwareCutters(p, L);
  if (p.style === 'skeletonized' || p.connectScrews) {
    const bridges: Manifold[]=[];
    if(p.mountHoles !== 'none') for(let i=0;i<L.x.cells.length;i++) for(let j=0;j<L.y.cells.length;j++) {
      const cx=L.x.centres[i],cy=L.y.centres[j],dx=L.x.cells[i]/2-2,dy=L.y.cells[j]/2-2;
      const length=Math.hypot(dx,dy),nx=-dy/length*1.2,ny=dx/length*1.2;
      bridges.push(prism(k().CrossSection.ofPolygons([[[cx+nx,cy+ny],[cx-dx+nx,cy-dy+ny],[cx-dx-nx,cy-dy-ny],[cx-nx,cy-ny]]]),0,L.bottom));
    }
    const supports = unionAll([...hardware.map(h => h.project().offset(1).extrude(L.height)), ...connectionSupports(p, L), ...bridges]);
    for (let i=0;i<L.x.cells.length;i++) for(let j=0;j<L.y.cells.length;j++) {
      const cx=L.x.centres[i], cy=L.y.centres[j];
      const w=L.x.cells[i]-5.7, d=L.y.cells[j]-5.7, r=SKELETON_RADIUS;
      let opening = k().CrossSection.square([w-2*r,d-2*r],true).translate([cx,cy]);
      // Rounded corner exclusions leave material around the four magnet locations.
      if (L.x.cells[i]===GRID && L.y.cells[j]===GRID) {
        const exclusions=[];
        for(const sx of [-1,1]) for(const sy of [-1,1]) {
          const x=cx+sx*HOLE_OFFSET, y=cy+sy*HOLE_OFFSET;
          exclusions.push(k().CrossSection.square([w,d]).translate([sx>0?x:x-w,sy>0?y:y-d]).offset(MAGNET_DIAMETER/2+r+2));
        }
        opening=opening.subtract(k().CrossSection.union(exclusions));
      }
      let cut=prism(opening.offset(r),-0.01,L.bottom+0.01);
      if(supports) cut=cut.subtract(supports);
      cutters.push(cut);
    }
  }
  return subtractAll(plate, [...cutters, ...hardware, ...plateConnectionCutters(p)]);
}

export function plateHardwareCutters(p: PlateParams, L = plateLayout(p)): Manifold[] {
  const cutters: Manifold[] = [];
  for (let i = 0; i < L.x.cells.length; i++) for (let j = 0; j < L.y.cells.length; j++) {
    const cx = L.x.centres[i], cy = L.y.centres[j];
    const cellW = L.x.cells[i], cellD = L.y.cells[j];
    const whole = cellW === GRID && cellD === GRID;
    if (p.magnets && L.bottom > 0 && whole) {
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          cutters.push(
            magnetCutter(p.magnetStyle, p.magnetChamfer).mirror([0, 0, 1]).translate([cx + sx * HOLE_OFFSET, cy + sy * HOLE_OFFSET, L.bottom]),
          );
        }
      }
    }
    // Weighted cells keep their underside weight pocket intact: skip mounting holes.
    if (p.mountHoles !== 'none' && (p.style !== 'weighted' || p.connectScrews) && Math.min(cellW, cellD) / 2 - BASEPLATE_PROFILE[0][0] > SCREW_HOLE_RADIUS + BASEPLATE_SCREW_COUNTERSINK_ADDITIONAL_RADIUS) {
      cutters.push(cylinderAt(cx, cy, -1, L.bottom + 0.01, SCREW_HOLE_RADIUS));
      if (p.mountHoles === 'counterbore') {
        cutters.push(cylinderAt(cx, cy, L.bottom - BASEPLATE_SCREW_COUNTERBORE_HEIGHT, L.bottom, BASEPLATE_SCREW_COUNTERBORE_RADIUS));
      } else {
        const depth = BASEPLATE_SCREW_COUNTERSINK_ADDITIONAL_RADIUS;
        cutters.push(k().Manifold.cylinder(depth, SCREW_HOLE_RADIUS, SCREW_HOLE_RADIUS + depth, 32).translate([cx, cy, L.bottom - depth]));
      }
    }
    if (p.style === 'weighted' && !p.connectScrews && whole) {
      const h = WEIGHT_POCKET_SIZE / 2;
      cutters.push(box(cx - h, cx + h, cy - h, cy + h, -1, WEIGHT_POCKET_DEPTH));
    }
  }
  return cutters;
}

function connectionSupports(p: PlateParams, L: PlateLayout): Manifold[] {
  if (!p.connectScrews) return [];
  const r=CONNECTION_DIAMETER/2+1, reach=CONNECTION_REACH-2;
  const boundaries=(a: AxisLayout)=>[a.padStart,...a.cells.map((_,i)=>a.padStart+a.cells.slice(0,i+1).reduce((sum,n)=>sum+n,0))];
  // Stop support before the bore end, opening it into the central tool-access cut-out.
  return [...boundaries(L.x).flatMap(x=>L.y.centres.map(y=>box(x-reach,x+reach,y-r,y+r,0,L.bottom))), ...boundaries(L.y).flatMap(y=>L.x.centres.map(x=>box(x-r,x+r,y-reach,y+reach,0,L.bottom)))];
}

export function plateConnectionCutters(p: PlateParams, xCuts: number[] = [], yCuts: number[] = [], onBlocked?: () => void): Manifold[] {
  if (!p.connectScrews) return [];
  const L=plateLayout(p), z=L.bottom/2, r=CONNECTION_DIAMETER/2;
  const hardware=unionAll(plateHardwareCutters(p,L));
  const holes: Manifold[]=[];
  if(!L.x.centres.length || !L.y.centres.length) onBlocked?.();
  for(const [axis,cuts,positions,length] of [
    ['x',[0,...xCuts,L.x.length],L.y.centres,L.y.length],
    ['y',[0,...yCuts,L.y.length],L.x.centres,L.x.length],
  ] as const) for(const cut of cuts) for(const at of positions) {
    if(at-r-1<0 || at+r+1>length) { onBlocked?.(); continue; }
    const layout=axis==='x'?L.x:L.y;
    const before=CONNECTION_REACH+(cut===layout.length?layout.padEnd:0);
    const after=CONNECTION_REACH+(cut===0?layout.padStart:0);
    const cylinder=cylinderAt(0,0,-before,after,r,48);
    const hole=axis==='x' ? cylinder.rotate([0,90,0]).translate([cut,at,z]) : cylinder.rotate([-90,0,0]).translate([at,cut,z]);
    if(hardware && hole.intersect(hardware).volume()>1e-6) { onBlocked?.(); continue; }
    holes.push(hole);
  }
  return holes;
}
