import * as THREE from 'three';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { buildBin, cellPitches, defaultBin } from '../src/geometry/bin';
import { buildHolder, defaultHolder, presetValues } from '../src/geometry/holder';
import { buildPlateFromLayout, defaultPlate, type AxisLayout, type PlateLayout } from '../src/geometry/baseplate';
import { freeAll, initKernel } from '../src/geometry/kernel';
import { defaultPlanner, validatePlacement, type PlannerItem } from '../src/planner/document';
import { plannerJobs, proxyMesh, type AssemblyInstance } from '../src/planner/viewer';
import { seatingOffset } from '../src/planner/layout';
import { Viewer } from '../src/viewer';

beforeAll(async () => { await initKernel(); });
afterEach(() => { freeAll(); vi.restoreAllMocks(); });

function axis(units: number): AxisLayout {
  const cells = cellPitches(units);
  let start = 0;
  const centres = cells.map(pitch => {
    const centre = start + pitch / 2;
    start += pitch;
    return centre;
  });
  return { cells, centres, length: units * 42, units, padStart: 0, padEnd: 0 };
}

for (const [kind, width, depth] of [
  ['bin', 1, 1], ['bin', 2, 1], ['bin', 2, 2],
  ['bin', 0.5, 1], ['bin', 1.5, 1], ['holder', 2, 1],
] as const) {
  it(`seats ${kind} ${width}×${depth} clear of every socket, but intersects 0.01 mm lower`, () => {
    const layout: PlateLayout = { x: axis(width), y: axis(depth), bottom: 3.2, height: 8.2 };
    const plate = buildPlateFromLayout(layout, { ...defaultPlate, style: 'solid' });
    const body = kind === 'bin'
      ? buildBin({ ...defaultBin, width, depth })
      : buildHolder({ ...defaultHolder, ...presetValues('aa'), width, depth });
    const seat = seatingOffset(layout.bottom, width, depth);
    const feet = layout.x.cells.length * layout.y.cells.length;
    expect(seat).toBeCloseTo(layout.bottom + (feet > 1 ? 0.25 : 0), 6);
    const placed = body.translate([width * 21, depth * 21, seat]);
    expect(placed.intersect(plate).volume()).toBeLessThan(1e-6);
    expect(placed.translate([0, 0, -0.01]).intersect(plate).volume()).toBeGreaterThan(1e-9);
  });
}

it('uses the same seat for preview and the 45.9 mm drawer warning', () => {
  const doc = structuredClone(defaultPlanner);
  doc.drawer.heightMm = 45.9;
  const { width: _width, depth: _depth, ...params } = defaultBin;
  const item: PlannerItem = {
    id: 'multi', name: '6U bin', x2: 0, y2: 0, w2: 4, d2: 2,
    rotation: 0, kind: 'bin', params: { ...params, height: 6 },
  };
  doc.items = [item];
  const job = plannerJobs(doc).find(job => job.id === item.id)!;
  expect(job.transform.translation[2]).toBe(0.25);
  expect(45.8 + job.transform.translation[2]).toBeCloseTo(46.05);
  expect(validatePlacement(doc, item).some(issue => issue.code === 'height')).toBe(true);
});

it('disposes every instance, geometry and material once across assembly → assembly → single-part', () => {
  // Exercise the real display methods without allocating a renderer or requiring WebGL.
  const viewer = Object.create(Viewer.prototype) as Viewer;
  const group = new THREE.Group();
  Object.assign(viewer, {
    group,
    scene: new THREE.Scene(),
    camera: new THREE.PerspectiveCamera(40, 1, 1, 10000),
    controls: { target: new THREE.Vector3() },
    framedKey: '',
  });
  const mesh = proxyMesh(10, 20, 30);
  const instance: AssemblyInstance = { key: 'a', mesh, transform: { translation: [15, 25, 3.2], rotation: 90 } };
  const flat = vi.spyOn(THREE.BufferGeometry.prototype, 'toNonIndexed');
  const counts: { instance: number; geometry: number; material: number }[] = [];
  const track = () => {
    for (const child of group.children) {
      expect(child).toBeInstanceOf(THREE.InstancedMesh);
      const instanced = child as THREE.InstancedMesh;
      const count = { instance: 0, geometry: 0, material: 0 };
      counts.push(count);
      instanced.addEventListener('dispose', () => count.instance++);
      instanced.geometry.addEventListener('dispose', () => count.geometry++);
      (instanced.material as THREE.Material).addEventListener('dispose', () => count.material++);
    }
  };
  viewer.showAssembly([instance]);
  track();
  viewer.showAssembly([instance, { ...instance, key: 'b' }]);
  expect(counts).toEqual([{ instance: 1, geometry: 1, material: 1 }]);
  track();
  expect(flat).not.toHaveBeenCalled();
  viewer.show([mesh], false, 'single');
  expect(flat).toHaveBeenCalledTimes(1);
  expect(counts).toEqual(Array.from({ length: 3 }, () => ({ instance: 1, geometry: 1, material: 1 })));
  viewer.show([], false, 'empty');
});
