import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { MeshOut } from './geometry/generate';

const PIECE_COLORS = [0x4f7cff, 0xf28c28, 0x2fb36d, 0xd64f8a, 0x8a63d2, 0x1fa3b8, 0xc9a227, 0x6b7a8f];
const TOO_BIG = 0xe04545;

export class Viewer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(40, 1, 1, 10000);
  private controls: OrbitControls;
  private group = new THREE.Group();
  private grid?: THREE.GridHelper;
  private framedKey = '';

  constructor(private container: HTMLElement) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    // Z-up to match the printer.
    this.camera.up.set(0, 0, 1);
    this.camera.position.set(150, -200, 160);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;

    this.scene.background = new THREE.Color(0xf3f4f7);
    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8890a0, 1.6));
    const sun = new THREE.DirectionalLight(0xffffff, 1.8);
    sun.position.set(120, -160, 300);
    this.scene.add(sun);
    this.scene.add(this.group);

    new ResizeObserver(() => this.resize()).observe(container);
    this.resize();
    const loop = () => {
      this.controls.update();
      this.renderer.render(this.scene, this.camera);
      requestAnimationFrame(loop);
    };
    loop();
  }

  private resize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  /** Show pieces, pulled apart slightly so splits are visible. */
  show(pieces: MeshOut[], explode: boolean, frameKey: string): void {
    for (const child of [...this.group.children]) {
      const mesh = child as THREE.Mesh;
      mesh.geometry.dispose();
      (mesh.material as THREE.Material).dispose();
      this.group.remove(child);
    }
    const all = new THREE.Box3();
    const centre = new THREE.Vector3();
    for (const p of pieces) all.union(new THREE.Box3(new THREE.Vector3(...p.min), new THREE.Vector3(...p.max)));
    all.getCenter(centre);

    pieces.forEach((p, i) => {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(p.positions, 3));
      geo.setIndex(new THREE.BufferAttribute(p.indices, 1));
      const flat = geo.toNonIndexed();
      flat.computeVertexNormals();
      geo.dispose();
      const color = p.fitsBed ? PIECE_COLORS[i % PIECE_COLORS.length] : TOO_BIG;
      const mesh = new THREE.Mesh(flat, new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.05 }));
      const pc = new THREE.Vector3((p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, 0);
      const push = explode && pieces.length > 1 ? pc.clone().sub(centre).setZ(0).multiplyScalar(0.12) : new THREE.Vector3();
      mesh.position.set(push.x - centre.x, push.y - centre.y, -all.min.z);
      this.group.add(mesh);
    });

    const size = all.getSize(new THREE.Vector3());
    const span = Math.max(size.x, size.y, 42);
    if (this.grid) {
      this.scene.remove(this.grid);
      this.grid.dispose();
    }
    const gridSize = Math.ceil((span * 1.6) / 42) * 42;
    this.grid = new THREE.GridHelper(gridSize, gridSize / 42 * 2, 0xb8bdc8, 0xd9dce3);
    this.grid.rotation.x = Math.PI / 2;
    this.scene.add(this.grid);

    if (frameKey !== this.framedKey) {
      this.framedKey = frameKey;
      const d = Math.max(span, size.z) * 1.9 + 40;
      this.controls.target.set(0, 0, size.z / 3);
      this.camera.position.set(d * 0.55, -d * 0.8, d * 0.65);
      this.camera.near = d / 100;
      this.camera.far = d * 20;
      this.camera.updateProjectionMatrix();
    }
  }
}
