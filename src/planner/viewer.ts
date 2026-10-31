import * as THREE from 'three';
import type { MeshOut, PartTransform, GenerateRequest, GeneratedPart } from '../geometry/generate';
import { transformMesh } from '../geometry/transforms';
import { DEFAULTS } from '../state';
import { itemRequest, type PlannerDocument } from './document';
import { footprint, planDrawer, seatingOffset } from './layout';
import { jobKey, type Job, type ResultCache } from './batch';

export interface PlannedJob {
  id: string;
  job: Job;
  transform: PartTransform;
}

export interface AssemblyInstance {
  key: string;
  mesh: MeshOut;
  transform: PartTransform;
  proxy?: boolean;
}

function previewRequest(request: GenerateRequest): GenerateRequest {
  return { ...request, print: { ...request.print, split: false } };
}

export function plannerJobs(doc: PlannerDocument): PlannedJob[] {
  const layout = planDrawer(doc);
  const jobs: PlannedJob[] = [{
    id: 'plate',
    job: {
      req: previewRequest({
        ...structuredClone(DEFAULTS),
        kind: 'plate',
        plate: {
          ...DEFAULTS.plate,
          ...doc.baseplate,
          drawerW: doc.drawer.widthMm - 2 * doc.drawer.fitGapMm,
          drawerD: doc.drawer.depthMm - 2 * doc.drawer.fitGapMm,
        },
        print: doc.print,
      }),
      options: { plateLayout: layout.plateLayout },
      purpose: 'preview',
    },
    transform: { translation: [...layout.plateOrigin, 0] },
  }];

  for (const item of doc.items) {
    const rotated = footprint(item);
    jobs.push({
      id: item.id,
      job: { req: previewRequest(itemRequest(item, doc.print)), purpose: 'preview' },
      transform: {
        translation: [
          layout.gridOrigin[0] + (item.x2 + rotated.w2 / 2) * 21,
          layout.gridOrigin[1] + (item.y2 + rotated.d2 / 2) * 21,
          seatingOffset(layout.plateLayout.bottom, item.w2 / 2, item.d2 / 2),
        ],
        rotation: item.rotation,
      },
    });
  }

  layout.spacers.forEach((strip, index) => jobs.push({
    id: `spacer-${index}`,
    job: {
      req: previewRequest({ ...structuredClone(DEFAULTS), kind: 'spacer', print: doc.print }),
      options: { spacerBounds: [strip.width, strip.depth, strip.height] },
      purpose: 'preview',
    },
    transform: { translation: [strip.x, strip.y, 0] },
  }));
  return jobs;
}

export function proxyMesh(width: number, depth: number, height: number): MeshOut {
  const positions = new Float32Array([
    0, 0, 0, width, 0, 0, width, depth, 0, 0, depth, 0,
    0, 0, height, width, 0, height, width, depth, height, 0, depth, height,
  ]);
  const indices = new Uint32Array([
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4,
    1, 2, 6, 1, 6, 5, 2, 3, 7, 2, 7, 6, 3, 0, 4, 3, 4, 7,
  ]);
  return {
    name: 'Pending footprint', positions, indices,
    min: [0, 0, 0], max: [width, depth, height],
    volume: width * depth * height, fitsBed: true,
  };
}

function partTransform(part: GeneratedPart, placement: PartTransform): PartTransform {
  const loose = ['label-card', 'divider'].includes(part.role);
  // Closed lids use their bin-relative seat; loose accessories keep parking offsets.
  const local = part.assemblyTransform?.translation ?? (loose ? part.displayTransform?.translation : undefined) ?? [0, 0, 0];
  const angle = (placement.rotation ?? 0) * Math.PI / 180;
  return {
    translation: [
      placement.translation[0] + local[0] * Math.cos(angle) - local[1] * Math.sin(angle),
      placement.translation[1] + local[0] * Math.sin(angle) + local[1] * Math.cos(angle),
      placement.translation[2] + local[2],
    ],
    rotation: placement.rotation,
  };
}

function footprintInstance(doc: PlannerDocument, planned: PlannedJob): AssemblyInstance {
  const item = doc.items.find(candidate => candidate.id === planned.id);
  if (item) {
    const rotated = footprint(item);
    return {
      key: 'proxy:' + item.id,
      mesh: proxyMesh(rotated.w2 * 21 - 0.5, rotated.d2 * 21 - 0.5, 7),
      transform: {
        translation: [
          planned.transform.translation[0] - rotated.w2 * 10.5 + 0.25,
          planned.transform.translation[1] - rotated.d2 * 10.5 + 0.25,
          planned.transform.translation[2],
        ],
      },
      proxy: true,
    };
  }
  const plate = planned.job.options?.plateLayout;
  const size = planned.job.options?.spacerBounds ?? [plate?.x.length ?? 1, plate?.y.length ?? 1, plate?.height ?? 5];
  return {
    key: 'proxy:' + planned.id,
    mesh: proxyMesh(size[0], size[1], size[2]),
    transform: planned.transform,
    proxy: true,
  };
}

export function assemblyInstances(
  doc: PlannerDocument,
  jobs: PlannedJob[],
  cache: ResultCache,
  selected?: string,
  accessories = false,
): AssemblyInstance[] {
  const instances: AssemblyInstance[] = [];
  let triangles = 0;
  const prioritized = [...jobs].sort((a, b) => Number(b.id === selected) - Number(a.id === selected));
  for (const planned of prioritized) {
    const key = jobKey(planned.job);
    const result = cache.get(key);
    const parts = result?.parts.filter(part => accessories || ['body', 'plate', 'spacer', 'lid'].includes(part.role));
    const count = parts?.reduce((sum, part) => sum + part.mesh.indices.length / 3, 0) ?? Infinity;
    const priority = planned.id === selected || planned.id === 'plate';
    const heavy = count > 10000 && !priority;
    if (parts?.length && !heavy && (triangles + count <= 60000 || priority)) {
      for (const part of parts) {
        instances.push({
          key: key + ':' + part.partKey,
          mesh: part.mesh,
          transform: partTransform(part, planned.transform),
        });
      }
      triangles += count;
    } else {
      instances.push(footprintInstance(doc, planned));
    }
  }
  return instances;
}

export function fallbackAssembly(instances: AssemblyInstance[]): MeshOut[] {
  return instances.map(instance => transformMesh(instance.mesh, instance.transform));
}

function indexedGeometry(mesh: MeshOut): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(mesh.positions, 3));
  geometry.setIndex(new THREE.BufferAttribute(mesh.indices, 1));
  geometry.computeVertexNormals();
  return geometry;
}

/** One indexed geometry and InstancedMesh per identical printable body. */
export function instanceGroup(
  instances: AssemblyInstance[],
  centre: [number, number, number] = [0, 0, 0],
): THREE.Group {
  const group = new THREE.Group();
  const groups = new Map<string, AssemblyInstance[]>();
  for (const instance of instances) {
    const list = groups.get(instance.key) ?? [];
    list.push(instance);
    groups.set(instance.key, list);
  }
  for (const list of groups.values()) {
    const first = list[0];
    const geometry = indexedGeometry(first.mesh);
    const material = new THREE.MeshStandardMaterial({
      color: first.proxy ? 0xaab4c8 : 0x4f7cff,
      transparent: !!first.proxy,
      opacity: first.proxy ? 0.4 : 1,
    });
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((instance, index) => {
      const matrix = new THREE.Matrix4().makeRotationZ((instance.transform.rotation ?? 0) * Math.PI / 180);
      const position = instance.transform.translation.map((value, axis) => value - centre[axis]);
      matrix.setPosition(position[0], position[1], position[2]);
      mesh.setMatrixAt(index, matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
    group.add(mesh);
  }
  return group;
}
