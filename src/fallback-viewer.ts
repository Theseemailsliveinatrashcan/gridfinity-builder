import type { MeshOut } from './geometry/generate';

const COLORS: [number, number, number][] = [
  [79, 124, 255], [242, 140, 40], [47, 179, 109], [214, 79, 138], [138, 99, 210], [31, 163, 184],
];

/**
 * Canvas 2D preview for browsers without WebGL: flat-shaded painter's
 * algorithm. Drag to rotate.
 */
export class FallbackViewer {
  private canvas = document.createElement('canvas');
  private pieces: MeshOut[] = [];
  private yaw = -0.6;
  private pitch = 0.9;

  constructor(private container: HTMLElement) {
    container.appendChild(this.canvas);
    const note = document.createElement('div');
    note.className = 'fallback-note';
    note.textContent = 'Simple preview (WebGL is not available in this browser). Drag to rotate.';
    container.appendChild(note);
    let drag: { x: number; y: number } | undefined;
    this.canvas.onpointerdown = (e) => (drag = { x: e.clientX, y: e.clientY });
    window.addEventListener('pointerup', () => (drag = undefined));
    window.addEventListener('pointermove', (e) => {
      if (!drag) return;
      this.yaw += (e.clientX - drag.x) * 0.01;
      this.pitch = Math.min(1.5, Math.max(0.1, this.pitch + (e.clientY - drag.y) * 0.01));
      drag = { x: e.clientX, y: e.clientY };
      this.draw();
    });
    new ResizeObserver(() => this.draw()).observe(container);
  }

  show(pieces: MeshOut[], explode: boolean): void {
    this.pieces = pieces;
    this.explode = explode;
    this.draw();
  }

  private explode = true;

  private draw(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (!w || !h) return;
    const dpr = Math.min(window.devicePixelRatio, 2);
    this.canvas.width = w * dpr;
    this.canvas.height = h * dpr;
    this.canvas.style.width = `${w}px`;
    this.canvas.style.height = `${h}px`;
    const ctx = this.canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#f3f4f7';
    ctx.fillRect(0, 0, w, h);
    if (!this.pieces.length) return;

    let min = [Infinity, Infinity, Infinity];
    let max = [-Infinity, -Infinity, -Infinity];
    for (const p of this.pieces) {
      min = min.map((v, i) => Math.min(v, p.min[i]));
      max = max.map((v, i) => Math.max(v, p.max[i]));
    }
    const centre = min.map((v, i) => (v + max[i]) / 2);
    const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2]) * 1.25;

    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    // Camera looks down at `pitch` from horizontal; returns [screen x, screen y, depth].
    const project = (x: number, y: number, z: number): [number, number, number] => {
      const rx = x * cy - y * sy;
      const ry = x * sy + y * cy;
      return [rx, -(z * cp + ry * sp), ry * cp - z * sp];
    };
    const light = [0.35, -0.5, 0.8];
    const ll = Math.hypot(...light);
    const W = Math.round(w * dpr);
    const H = Math.round(h * dpr);
    const scale = Math.min(W, H) / span;
    const image = ctx.createImageData(W, H);
    const px = image.data;
    for (let i = 0; i < px.length; i += 4) {
      px[i] = 243; px[i + 1] = 244; px[i + 2] = 247; px[i + 3] = 255;
    }
    const depth = new Float32Array(W * H).fill(Infinity);

    // Z-buffered triangle fill in device pixels.
    const raster = (s: [number, number, number][], r: number, g: number, b: number) => {
      const xs = s.map((v) => v[0] * scale + W / 2);
      const ys = s.map((v) => v[1] * scale + H / 2);
      const minX = Math.max(0, Math.floor(Math.min(...xs)));
      const maxX = Math.min(W - 1, Math.ceil(Math.max(...xs)));
      const minY = Math.max(0, Math.floor(Math.min(...ys)));
      const maxY = Math.min(H - 1, Math.ceil(Math.max(...ys)));
      const den = (ys[1] - ys[2]) * (xs[0] - xs[2]) + (xs[2] - xs[1]) * (ys[0] - ys[2]);
      if (Math.abs(den) < 1e-12) return;
      for (let y = minY; y <= maxY; y++) {
        for (let x = minX; x <= maxX; x++) {
          const fx = x + 0.5, fy = y + 0.5;
          const a = ((ys[1] - ys[2]) * (fx - xs[2]) + (xs[2] - xs[1]) * (fy - ys[2])) / den;
          const bb = ((ys[2] - ys[0]) * (fx - xs[2]) + (xs[0] - xs[2]) * (fy - ys[2])) / den;
          const c = 1 - a - bb;
          if (a < 0 || bb < 0 || c < 0) continue;
          const z = a * s[0][2] + bb * s[1][2] + c * s[2][2];
          const idx = y * W + x;
          if (z >= depth[idx]) continue;
          depth[idx] = z;
          px[idx * 4] = r; px[idx * 4 + 1] = g; px[idx * 4 + 2] = b;
        }
      }
    };

    this.pieces.forEach((p, idx) => {
      const pc = [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2];
      const push = this.explode && this.pieces.length > 1 ? [(pc[0] - centre[0]) * 0.12, (pc[1] - centre[1]) * 0.12] : [0, 0];
      const base = COLORS[idx % COLORS.length];
      const pos = p.positions;
      const ind = p.indices;
      for (let t = 0; t < ind.length; t += 3) {
        const v = [ind[t], ind[t + 1], ind[t + 2]].map((i) => [
          pos[i * 3] - centre[0] + push[0],
          pos[i * 3 + 1] - centre[1] + push[1],
          pos[i * 3 + 2] - centre[2],
        ]);
        const ux = v[1][0] - v[0][0], uy = v[1][1] - v[0][1], uz = v[1][2] - v[0][2];
        const wx = v[2][0] - v[0][0], wy = v[2][1] - v[0][1], wz = v[2][2] - v[0][2];
        const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
        const nl = Math.hypot(nx, ny, nz) || 1;
        const s = v.map(([x, y, z]) => project(x, y, z));
        // Back-face cull in screen space.
        const area = (s[1][0] - s[0][0]) * (s[2][1] - s[0][1]) - (s[2][0] - s[0][0]) * (s[1][1] - s[0][1]);
        if (area >= 0) continue;
        const shade = 0.45 + 0.55 * Math.max(0, (nx * light[0] + ny * light[1] + nz * light[2]) / nl / ll);
        const [r, g, b] = base.map((c) => Math.min(255, Math.round(c * shade + 25)));
        raster(s, r, g, b);
      }
    });
    ctx.putImageData(image, 0, 0);
  }
}
