import { SPACER_HEIGHTS } from './geometry/spacer';
import { presetValues } from './geometry/holder';
import type { GenerateRequest, PartKind } from './geometry/generate';

export type Group = 'bin' | 'plate' | 'tile' | 'lid' | 'holder' | 'spacer' | 'print';

export interface Field {
  group: Group;
  key: string;
  label: string;
  kind: 'number' | 'select' | 'toggle' | 'range';
  min?: number;
  max?: number;
  step?: number;
  options?: [string, string][];
  help?: string;
  unit?: string;
  show?: (s: GenerateRequest) => boolean;
}

export interface Section {
  title: string;
  kinds: PartKind[];
  fields: Field[];
}

const bin = (f: Omit<Field, 'group'>): Field => ({ group: 'bin', ...f });
const lid = (f: Omit<Field, 'group'>): Field => ({ group: 'lid', ...f });
const holder = (f: Omit<Field, 'group'>): Field => ({ group: 'holder', ...f });
const spacer = (f: Omit<Field, 'group'>): Field => ({ group: 'spacer', ...f });
const plate = (f: Omit<Field, 'group'>): Field => ({ group: 'plate', ...f });
const tile = (f: Omit<Field, 'group'>): Field => ({ group: 'tile', ...f });
const print = (f: Omit<Field, 'group'>): Field => ({ group: 'print', ...f });

/** Apply side effects of a field change. Returns true if other fields changed too, so the form must be redrawn. */
export function onFieldChange(state: GenerateRequest, field: Field): boolean {
  if (field.group === 'spacer' && field.key === 'preset' && state.spacer.preset !== 'custom') {
    state.spacer.height = SPACER_HEIGHTS[state.spacer.preset];
    return true;
  }
  if (field.group === 'holder' && field.key === 'preset') {
    Object.assign(state.holder, presetValues(state.holder.preset));
    return true;
  }
  return false;
}

export const SECTIONS: Section[] = [
  {
    title: 'Size',
    kinds: ['bin'],
    fields: [
      bin({ key: 'width', label: 'Width', kind: 'number', min: 0.5, max: 12, step: 0.5, unit: 'units', help: '1 unit = 42 mm. Half units allowed.' }),
      bin({ key: 'depth', label: 'Depth', kind: 'number', min: 0.5, max: 12, step: 0.5, unit: 'units' }),
      bin({ key: 'heightMode', label: 'Set height by', kind: 'select', options: [['units', 'Gridfinity units'], ['internal', 'Inside depth (mm)']] }),
      bin({ key: 'height', label: 'Height', kind: 'number', min: 2, max: 24, step: 1, unit: '× 7 mm', help: 'Includes the foot; the stacking lip sits on top.', show: (s) => s.bin.heightMode !== 'internal' }),
      bin({ key: 'internalDepth', label: 'Inside depth', kind: 'number', min: 5, max: 160, step: 0.5, unit: 'mm', help: 'From the floor to the top of the walls.', show: (s) => s.bin.heightMode === 'internal' }),
    ],
  },
  {
    title: 'Walls and floor',
    kinds: ['bin'],
    fields: [
      bin({ key: 'lip', label: 'Stacking lip', kind: 'select', options: [['normal', 'Standard'], ['none', 'None (flat top)']] }),
      bin({ key: 'withLid', label: 'Include matching lid', kind: 'toggle', help: 'Adds a flat lid with the same footprint and magnet setting. Requires the stacking lip.' }),
      bin({ key: 'wall', label: 'Wall thickness', kind: 'number', min: 0.8, max: 3, step: 0.05, unit: 'mm' }),
      bin({ key: 'floor', label: 'Floor thickness', kind: 'number', min: 0.6, max: 6, step: 0.05, unit: 'mm', help: 'Above the 4.75 mm foot. 2.25 matches the standard 7 mm base.' }),
      bin({ key: 'solid', label: 'Solid bin (no cavity)', kind: 'toggle' }),
    ],
  },
  {
    title: 'Compartments',
    kinds: ['bin'],
    fields: [
      bin({ key: 'compartmentsX', label: 'Across', kind: 'number', min: 1, max: 12, step: 1, show: (s) => !s.bin.solid }),
      bin({ key: 'compartmentsY', label: 'Front to back', kind: 'number', min: 1, max: 12, step: 1, show: (s) => !s.bin.solid }),
      bin({
        key: 'tab', label: 'Label tab', kind: 'select', show: (s) => !s.bin.solid,
        options: [['none', 'None'], ['full', 'Full width'], ['left', 'Left'], ['center', 'Center'], ['right', 'Right']],
      }),
      bin({ key: 'scoop', label: 'Finger scoop', kind: 'range', min: 0, max: 1, step: 0.05, show: (s) => !s.bin.solid, help: 'Curved front edge for scooping out small parts.' }),
    ],
  },
  {
    title: 'Base holes',
    kinds: ['bin'],
    fields: [
      bin({ key: 'magnets', label: 'Magnet holes (6 × 2 mm)', kind: 'toggle' }),
      bin({ key: 'screws', label: 'Screw holes (M3)', kind: 'toggle' }),
      bin({ key: 'cornerHolesOnly', label: 'Outer corners only', kind: 'toggle', show: (s) => s.bin.magnets || s.bin.screws }),
    ],
  },
  {
    title: 'Lid — test-print the fit first',
    kinds: ['lid'],
    fields: [
      lid({ key: 'width', label: 'Width', kind: 'number', min: 0.5, max: 12, step: 0.5, unit: 'units' }),
      lid({ key: 'depth', label: 'Depth', kind: 'number', min: 0.5, max: 12, step: 0.5, unit: 'units' }),
      lid({ key: 'style', label: 'Top style', kind: 'select', options: [['flat', 'Flat'], ['stackable', 'Stackable (baseplate sockets)']] }),
      lid({ key: 'handle', label: 'Finger recess', kind: 'toggle', help: 'Shallow recess in the first cell.' }),
      lid({ key: 'magnets', label: 'Underside magnet holes (6 × 2 mm)', kind: 'toggle', help: 'Whole cells only, matching bin magnet locations.' }),
    ],
  },
  {
    title: 'Holder — Size & base',
    kinds: ['holder'],
    fields: [
      holder({ key: 'width', label: 'Width', kind: 'number', min: 0.5, max: 12, step: 0.5, unit: 'units' }),
      holder({ key: 'depth', label: 'Depth', kind: 'number', min: 0.5, max: 12, step: 0.5, unit: 'units' }),
      holder({ key: 'heightMode', label: 'Height', kind: 'select', options: [['auto', 'Auto (fit item depth)'], ['units', 'Manual units']] }),
      holder({ key: 'height', label: 'Manual height', kind: 'number', min: 1, max: 24, step: 1, unit: '× 7 mm', show: s => s.holder.heightMode === 'units' }),
      holder({ key: 'lip', label: 'Stacking lip', kind: 'select', options: [['normal', 'Standard'], ['none', 'None']] }),
      holder({ key: 'magnets', label: 'Magnet holes', kind: 'toggle' }),
      holder({ key: 'screws', label: 'Screw holes (M3)', kind: 'toggle' }),
    ],
  },
  {
    title: 'Holder — Pockets',
    kinds: ['holder'],
    fields: [
      holder({ key: 'preset', label: 'Item preset', kind: 'select', options: [['aa', 'AA battery'], ['aaa', 'AAA battery'], ['18650', '18650 cell'], ['21700', '21700 cell'], ['cr2032', 'CR2032 coin cell'], ['hex14', '¼″ hex bit'], ['hex4', '4 mm hex bit'], ['sd', 'SD card'], ['microsd', 'microSD card'], ['pen', 'Pen'], ['marker', 'Marker'], ['socket14', '¼″ socket drive'], ['socket38', '⅜″ socket drive'], ['custom', 'Custom (keep values)']], help: 'Presets include typical clearance. Check the dimensions of your items and test-print the fit first.' }),
      holder({ key: 'shape', label: 'Shape', kind: 'select', options: [['round', 'Round pocket'], ['hex', 'Hex pocket'], ['slot', 'Card slot'], ['post', 'Square post']] }),
      holder({ key: 'size', label: 'Item size', kind: 'number', min: 2, max: 100, step: 0.1, unit: 'mm', help: 'Diameter, hex across flats, slot length, or square post side.' }),
      holder({ key: 'slotThickness', label: 'Slot thickness', kind: 'number', min: 0.5, max: 30, step: 0.1, unit: 'mm', show: s => s.holder.shape === 'slot' }),
      holder({ key: 'pocketDepth', label: 'Pocket depth / post height', kind: 'number', min: 0.5, max: 100, step: 0.1, unit: 'mm' }),
      holder({ key: 'clearance', label: 'Item clearance per side', kind: 'number', min: 0, max: 2, step: 0.05, unit: 'mm', help: 'Added to pockets; subtracted from posts. Presets set this to 0.' }),
      holder({ key: 'spacing', label: 'Spacing', kind: 'number', min: 0.5, max: 60, step: 0.1, unit: 'mm', help: 'Gap between pockets; for posts, centre pitch minus the specified post size.' }),
      holder({ key: 'margin', label: 'Inner wall margin', kind: 'number', min: 0, max: 30, step: 0.5, unit: 'mm' }),
      holder({ key: 'layout', label: 'Layout', kind: 'select', options: [['grid', 'Grid'], ['staggered', 'Staggered (round / hex)']] }),
      holder({ key: 'hexPointForward', label: 'Hex point forward', kind: 'toggle', show: s => s.holder.shape === 'hex' }),
      holder({ key: 'slotLean', label: 'Lean toward back', kind: 'number', min: 0, max: 15, step: 1, unit: '°', show: s => s.holder.shape === 'slot' }),
      holder({ key: 'fingerNotch', label: 'Finger notch', kind: 'toggle', show: s => s.holder.shape === 'round' }),
    ],
  },
  {
    title: 'Baseplate',
    kinds: ['plate'],
    fields: [
      plate({ key: 'width', label: 'Width', kind: 'number', min: 1, max: 30, step: 1, unit: 'units', show: (s) => !(s.plate.drawerW > 0) }),
      plate({ key: 'depth', label: 'Depth', kind: 'number', min: 1, max: 30, step: 1, unit: 'units', show: (s) => !(s.plate.drawerD > 0) }),
      plate({ key: 'drawerW', label: 'Fit drawer width', kind: 'number', min: 0, max: 2000, step: 1, unit: 'mm', help: '0 = off. Fills the drawer with whole cells and pads the rest.' }),
      plate({ key: 'drawerD', label: 'Fit drawer depth', kind: 'number', min: 0, max: 2000, step: 1, unit: 'mm' }),
      plate({ key: 'halfCells', label: 'Fill drawer gaps with half cells', kind: 'toggle', show: s => s.plate.drawerW > 0 || s.plate.drawerD > 0, help: 'Uses spare 21 mm rows or columns on the padded side; magnets and weight pockets stay in whole cells.' }),
      plate({ key: 'alignX', label: 'Padding left ↔ right', kind: 'range', min: -1, max: 1, step: 0.1, show: (s) => s.plate.drawerW > 0, help: 'Left end: all padding on the left. Middle: split evenly.' }),
      plate({ key: 'alignY', label: 'Padding front ↔ back', kind: 'range', min: -1, max: 1, step: 0.1, show: (s) => s.plate.drawerD > 0 }),
      plate({ key: 'style', label: 'Style', kind: 'select', options: [['thin', 'Thin (open frame)'], ['solid', 'Solid bottom'], ['weighted', 'Weighted']] }),
      plate({ key: 'mountHoles', label: 'Screw-down holes', kind: 'select', options: [['none', 'None'], ['countersink', 'Countersunk (Ø3 bore, Ø8 head)'], ['counterbore', 'Counterbored (Ø3 bore, Ø5.5 head)']], help: 'Adds a 3.6 mm bottom to thin plates (0.6 mm beneath a 3 mm head recess). Weighted plates skip screw holes to preserve weight pockets.' }),
      plate({ key: 'magnets', label: 'Magnet holes (6 × 2 mm)', kind: 'toggle', help: 'Adds a bottom layer to thin plates.' }),
    ],
  },
  {
    title: 'Spacer',
    kinds: ['spacer'],
    fields: [
      spacer({ key: 'shape', label: 'Shape', kind: 'select', options: [['straight', 'Straight strip'], ['corner', 'Corner (L-shaped)']] }),
      spacer({ key: 'length', label: 'Length', kind: 'number', min: 20, max: 1000, step: 1, unit: 'mm' }),
      spacer({ key: 'length2', label: 'Second arm length', kind: 'number', min: 20, max: 1000, step: 1, unit: 'mm', show: s => s.spacer.shape === 'corner' }),
      spacer({ key: 'width', label: 'Gap width', kind: 'number', min: 2, max: 100, step: 0.1, unit: 'mm' }),
      spacer({ key: 'preset', label: 'Match baseplate height', kind: 'select', options: [['thin', 'Thin (5 mm)'], ['solid', 'Solid (8.2 mm)'], ['weighted', 'Weighted (11.4 mm)'], ['custom', 'Custom']] }),
      spacer({ key: 'height', label: 'Height', kind: 'number', min: 1.2, max: 30, step: 0.1, unit: 'mm', show: s => s.spacer.preset === 'custom' }),
      spacer({ key: 'lip', label: 'Bottom retaining ledge', kind: 'toggle', help: 'Adds 3 mm toward the baseplate at the bottom, 1.2 mm thick; the plate rests on it. Include this when measuring fit.' }),
    ],
  },
  {
    title: 'MultiBoard-compatible tile (experimental)',
    kinds: ['tile'],
    fields: [
      tile({ key: 'cols', label: 'Columns', kind: 'number', min: 1, max: 16, step: 1, unit: '× 25 mm' }),
      tile({ key: 'rows', label: 'Rows', kind: 'number', min: 1, max: 16, step: 1, unit: '× 25 mm' }),
      tile({ key: 'edgePegHoles', label: 'Peg holes on edges', kind: 'toggle', help: 'Half peg holes along the outer edge.' }),
    ],
  },
  {
    title: 'Print bed',
    kinds: ['bin', 'plate', 'tile', 'lid', 'holder', 'spacer'],
    fields: [
      print({ key: 'bedX', label: 'Bed width', kind: 'number', min: 40, max: 1000, step: 1, unit: 'mm' }),
      print({ key: 'bedY', label: 'Bed depth', kind: 'number', min: 40, max: 1000, step: 1, unit: 'mm' }),
      print({ key: 'split', label: 'Split to fit bed', kind: 'toggle', help: 'Cuts along grid lines into the fewest, most even pieces.' }),
      print({
        key: 'connector', label: 'Joints', kind: 'select', show: (s) => s.print.split && s.kind !== 'tile' && s.kind !== 'holder' && s.kind !== 'spacer',
        options: [['dovetail', 'Dovetails'], ['none', 'Flat (no connector)']],
      }),
      print({
        key: 'clearance', label: 'Dovetail fit gap', kind: 'number', min: 0, max: 0.6, step: 0.05, unit: 'mm',
        show: (s) => s.print.split && s.kind !== 'tile' && s.kind !== 'holder' && s.kind !== 'spacer' && s.print.connector === 'dovetail',
        help: 'Per side. Raise it if the joints are too tight.',
      }),
    ],
  },
];

export const BED_PRESETS: [string, number, number][] = [
  ['180²', 180, 180],
  ['220²', 220, 220],
  ['250×210', 250, 210],
  ['256²', 256, 256],
  ['350²', 350, 350],
];
