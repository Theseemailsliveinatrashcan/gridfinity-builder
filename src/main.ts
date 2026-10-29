import './style.css';
import { estimateFilament, MATERIALS, type Material } from './export/filament';
import { toBinaryStl } from './export/stl';
import { to3mf } from './export/threemf';
import { zip } from './export/zip';
import { BED_PRESETS, SECTIONS, type Field } from './fields';
import { defaultPlate } from './geometry/baseplate';
import { defaultBin } from './geometry/bin';
import type { GenerateRequest, GenerateResult, MeshOut, PartKind } from './geometry/generate';
import { defaultTile } from './geometry/multiboard';
import { FallbackViewer } from './fallback-viewer';
import { Viewer } from './viewer';
import type { WorkerResponse } from './worker';

const DEFAULTS: GenerateRequest = {
  kind: 'bin',
  bin: defaultBin,
  plate: defaultPlate,
  tile: defaultTile,
  print: { split: false, bedX: 220, bedY: 220, connector: 'dovetail', clearance: 0.2 },
};

function loadState(): GenerateRequest {
  try {
    const hash = location.hash.slice(1);
    if (hash) {
      const s = JSON.parse(decodeURIComponent(atob(hash)));
      return {
        kind: s.kind ?? DEFAULTS.kind,
        bin: { ...DEFAULTS.bin, ...s.bin },
        plate: { ...DEFAULTS.plate, ...s.plate },
        tile: { ...DEFAULTS.tile, ...s.tile },
        print: { ...DEFAULTS.print, ...s.print },
      };
    }
  } catch {
    // ignore a malformed link
  }
  return structuredClone(DEFAULTS);
}

let state = loadState();

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const form = $<HTMLDivElement>('#form');
const statusEl = $<HTMLDivElement>('#status');
const warningsEl = $<HTMLUListElement>('#warnings');
const downloadsEl = $<HTMLDivElement>('#downloads');
const viewport = $<HTMLDivElement>('#viewport');
const viewer: { show(pieces: MeshOut[], explode: boolean, frameKey: string): void } = (() => {
  try {
    return new Viewer(viewport);
  } catch {
    viewport.innerHTML = '';
    return new FallbackViewer(viewport);
  }
})();

const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
let requestId = 0;
let busy = false;
let pending = false;

worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
  busy = false;
  const msg = e.data;
  if (msg.id === requestId) {
    if (msg.ok) {
      showResult(msg.result, msg.ms);
    } else {
      statusEl.textContent = '';
      warningsEl.innerHTML = '';
      const li = document.createElement('li');
      li.className = 'error';
      li.textContent = msg.error;
      warningsEl.append(li);
      downloadsEl.innerHTML = '';
    }
  }
  if (pending) {
    pending = false;
    run();
  }
};

function run(): void {
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  requestId++;
  statusEl.textContent = 'Generating…';
  worker.postMessage({ id: requestId, req: state });
}

let timer: number | undefined;
function changed(): void {
  history.replaceState(null, '', '#' + btoa(encodeURIComponent(JSON.stringify(state))));
  renderForm();
  clearTimeout(timer);
  timer = window.setTimeout(run, 180);
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

function groupOf(f: Field): Record<string, unknown> {
  return state[f.group] as unknown as Record<string, unknown>;
}

function input(f: Field): HTMLElement {
  const wrap = document.createElement('label');
  wrap.className = `field field-${f.kind}`;
  const value = groupOf(f)[f.key];
  const title = document.createElement('span');
  title.className = 'label';
  title.textContent = f.label;

  if (f.kind === 'toggle') {
    const el = document.createElement('input');
    el.type = 'checkbox';
    el.checked = Boolean(value);
    el.onchange = () => {
      groupOf(f)[f.key] = el.checked;
      changed();
    };
    wrap.append(el, title);
  } else if (f.kind === 'select') {
    const el = document.createElement('select');
    for (const [v, text] of f.options ?? []) el.add(new Option(text, v, false, v === value));
    el.onchange = () => {
      groupOf(f)[f.key] = el.value;
      changed();
    };
    wrap.append(title, el);
  } else {
    const el = document.createElement('input');
    el.type = f.kind === 'range' ? 'range' : 'number';
    if (f.min !== undefined) el.min = String(f.min);
    if (f.max !== undefined) el.max = String(f.max);
    if (f.step !== undefined) el.step = String(f.step);
    el.value = String(value);
    const commit = () => {
      const n = Number(el.value);
      if (!Number.isFinite(n)) return;
      const clamped = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
      groupOf(f)[f.key] = clamped;
      changed();
    };
    if (f.kind === 'range') {
      el.oninput = commit;
      const out = document.createElement('output');
      out.textContent = Number(value).toFixed(2);
      wrap.append(title, el, out);
    } else {
      el.onchange = commit;
      const row = document.createElement('span');
      row.className = 'with-unit';
      row.append(el);
      if (f.unit) {
        const u = document.createElement('span');
        u.className = 'unit';
        u.textContent = f.unit;
        row.append(u);
      }
      wrap.append(title, row);
    }
  }
  if (f.help) {
    const help = document.createElement('small');
    help.textContent = f.help;
    wrap.append(help);
  }
  return wrap;
}

function renderForm(): void {
  const focused = document.activeElement as HTMLElement | null;
  const focusKey = focused?.dataset.key;
  form.innerHTML = '';
  for (const tab of document.querySelectorAll<HTMLButtonElement>('.kinds button')) {
    tab.classList.toggle('active', tab.dataset.kind === state.kind);
  }
  for (const section of SECTIONS) {
    if (!section.kinds.includes(state.kind)) continue;
    const fieldset = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = section.title;
    fieldset.append(legend);
    for (const f of section.fields) {
      if (f.show && !f.show(state)) continue;
      const el = input(f);
      const control = el.querySelector<HTMLElement>('input, select');
      if (control) control.dataset.key = `${f.group}.${f.key}`;
      fieldset.append(el);
    }
    if (section.title === 'Print bed') {
      const presets = document.createElement('div');
      presets.className = 'presets';
      for (const [name, x, y] of BED_PRESETS) {
        const b = document.createElement('button');
        b.type = 'button';
        b.textContent = name;
        b.title = `${x} × ${y} mm`;
        b.classList.toggle('active', state.print.bedX === x && state.print.bedY === y);
        b.onclick = () => {
          state.print.bedX = x;
          state.print.bedY = y;
          changed();
        };
        presets.append(b);
      }
      fieldset.insertBefore(presets, fieldset.children[1]);
    }
    form.append(fieldset);
  }
  if (focusKey) form.querySelector<HTMLElement>(`[data-key="${focusKey}"]`)?.focus();
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('.kinds button')) {
  tab.onclick = () => {
    state.kind = tab.dataset.kind as PartKind;
    changed();
  };
}
$<HTMLButtonElement>('#reset').onclick = () => {
  const kind = state.kind;
  state = structuredClone(DEFAULTS);
  state.kind = kind;
  changed();
};

// ---------------------------------------------------------------------------
// Results and downloads
// ---------------------------------------------------------------------------

const mm = (v: number) => (Math.round(v * 10) / 10).toString();

/** Centre each piece on the bed origin, resting on z = 0. */
const bedOffset = (p: MeshOut): [number, number, number] => [(p.min[0] + p.max[0]) / 2, (p.min[1] + p.max[1]) / 2, p.min[2]];

function stlFor(p: MeshOut): Uint8Array {
  return toBinaryStl(p.positions, p.indices, bedOffset(p));
}

type Format = 'stl' | '3mf';
const prefs = {
  format: (localStorage.getItem('format') === '3mf' ? '3mf' : 'stl') as Format,
  material: (localStorage.getItem('material') ?? 'PLA') as Material,
};
if (!(prefs.material in MATERIALS)) prefs.material = 'PLA';

function savePrefs(): void {
  localStorage.setItem('format', prefs.format);
  localStorage.setItem('material', prefs.material);
  if (lastResult) showResult(lastResult.r, lastResult.ms);
}

let lastResult: { r: GenerateResult; ms: number } | undefined;

function select<T extends string>(options: [T, string][], value: T, onChange: (v: T) => void, label: string): HTMLSelectElement {
  const el = document.createElement('select');
  el.setAttribute('aria-label', label);
  for (const [v, text] of options) el.add(new Option(text, v, false, v === value));
  el.onchange = () => onChange(el.value as T);
  return el;
}

function filamentLine(r: GenerateResult): HTMLElement {
  const total = r.pieces.reduce((s, p) => s + p.volume, 0);
  const est = estimateFilament(total, prefs.material);
  const row = document.createElement('div');
  row.className = 'filament';
  const text = document.createElement('span');
  text.textContent = `≤ ${Math.round(est.grams)} g · ${est.metres.toFixed(1)} m of 1.75 mm`;
  text.title = 'Upper bound: the part printed fully solid. Normal infill uses less.';
  row.append(
    text,
    select(
      Object.keys(MATERIALS).map((m) => [m as Material, m]),
      prefs.material,
      (v) => {
        prefs.material = v;
        savePrefs();
      },
      'Material',
    ),
  );
  return row;
}

function download(name: string, data: Uint8Array, type: string): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

function showResult(r: GenerateResult, ms: number): void {
  const fresh = lastResult?.r !== r;
  lastResult = { r, ms };
  if (fresh) viewer.show(r.pieces, true, `${state.kind}`);
  const [x, y, z] = r.size;
  const n = r.pieces.length;
  statusEl.textContent = `${mm(x)} × ${mm(y)} × ${mm(z)} mm · ${n} piece${n === 1 ? '' : 's'} · ${Math.round(ms)} ms`;
  statusEl.append(filamentLine(r));

  warningsEl.innerHTML = '';
  for (const w of r.warnings) {
    const li = document.createElement('li');
    li.textContent = w;
    warningsEl.append(li);
  }

  downloadsEl.innerHTML = '';
  const base = r.pieces[0].name.replace(/-piece-.*$/, '');
  const threeMf = (pieces: MeshOut[]) =>
    to3mf(pieces.map((p) => ({ name: p.name, positions: p.positions, indices: p.indices, offset: bedOffset(p) })));
  const single = (p: MeshOut) =>
    prefs.format === '3mf'
      ? download(`${p.name}.3mf`, threeMf([p]), 'model/3mf')
      : download(`${p.name}.stl`, stlFor(p), 'model/stl');

  const bar = document.createElement('div');
  bar.className = 'download-bar';
  const main = document.createElement('button');
  main.className = 'primary';
  const fmt = prefs.format.toUpperCase();
  if (n === 1) {
    main.textContent = `Download ${fmt}`;
    main.onclick = () => single(r.pieces[0]);
  } else if (prefs.format === '3mf') {
    main.textContent = `Download all ${n} pieces (.3mf)`;
    main.onclick = () => download(`${base}.3mf`, threeMf(r.pieces), 'model/3mf');
  } else {
    main.textContent = `Download all ${n} pieces (.zip)`;
    main.onclick = () => {
      const files = r.pieces.map((p) => ({ name: `${p.name}.stl`, data: stlFor(p) }));
      download(`${base}.zip`, zip(files), 'application/zip');
    };
  }
  bar.append(
    main,
    select<Format>([['stl', 'STL'], ['3mf', '3MF']], prefs.format, (v) => {
      prefs.format = v;
      savePrefs();
    }, 'File format'),
  );
  downloadsEl.append(bar);
  if (n > 1) {
    const list = document.createElement('ul');
    list.className = 'pieces';
    r.pieces.forEach((p) => {
      const li = document.createElement('li');
      const a = document.createElement('button');
      a.className = 'link';
      a.textContent = `${p.name.replace(/^.*-(piece-)/, '$1')} · ${mm(p.max[0] - p.min[0])} × ${mm(p.max[1] - p.min[1])} mm${p.fitsBed ? '' : ' (too big)'}`;
      a.onclick = () => single(p);
      li.append(a);
      list.append(li);
    });
    downloadsEl.append(list);
  }
}

renderForm();
run();
