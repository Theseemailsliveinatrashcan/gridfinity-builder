import { exportDrawer } from './export/planner-download';
import type { PrintManifest } from './export/planner';
import { BatchQueue, jobKey } from './planner/batch';
import { plannerJobs, assemblyInstances, type PlannedJob, type AssemblyInstance } from './planner/viewer';
import { validatePlacement } from './planner/document';
import { planDrawer } from './planner/layout';
import { displayMeshes } from './geometry/transforms';
import { mountPlanner } from './planner/editor';
import { decodePlanner } from './planner/codec';
import type { PlannerDocument } from './planner/document';
import './style.css';
import { estimateFilament, MATERIALS, type Material } from './export/filament';
import { toBinaryStl } from './export/stl';
import { to3mf } from './export/threemf';
import { mountPartForm } from './ui/part-form';
import type { GenerateResult, MeshOut, PartKind } from './geometry/generate';
import { zipSync } from 'fflate';
import { DEFAULTS, decodeState, encodeState } from './state';
import { FallbackViewer } from './fallback-viewer';
import { Viewer } from './viewer';
import type { WorkerResponse } from './worker';

let initialPlanner:PlannerDocument|undefined;
let initialError='';
let state=decodeState('');
try {const initial=decodePlanner(location.hash);if(initial.mode==='planner')initialPlanner=initial.document;else state=initial.request;}catch(error){initialError=String(error);}

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const form = $<HTMLDivElement>('#form');
const statusEl = $<HTMLDivElement>('#status');
const warningsEl = $<HTMLUListElement>('#warnings');
const downloadsEl = $<HTMLDivElement>('#downloads');
const viewport = $<HTMLDivElement>('#viewport');
const viewer: { show(pieces: MeshOut[], explode: boolean, frameKey: string): void;showAssembly(instances:AssemblyInstance[]):void } = (() => {
  try {
    return new Viewer(viewport);
  } catch {
    viewport.innerHTML = '';
    return new FallbackViewer(viewport);
  }
})();

let lastResult: { r: GenerateResult; ms: number } | undefined;

const TIMEOUT_MS = 30_000;
let worker = startWorker();
let requestId = 0;
let busy = false;
let pending = false;
let watchdog: number | undefined;

function startWorker(): Worker {
  const w = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  w.onmessage = e => { if(w===worker&&!plannerMode)onWorkerMessage(e); };
  w.onerror = (e) => {
    e.preventDefault();
    if(w!==worker||plannerMode)return;
    restartWorker('The geometry engine crashed. Try a smaller part.');
  };
  w.onmessageerror = () => {if(w===worker&&!plannerMode)restartWorker('Could not read the result from the geometry engine.');};
  return w;
}

/** Kill a crashed or runaway worker and start a fresh one. */
function restartWorker(message: string): void {
  clearTimeout(watchdog);
  worker.terminate();
  worker = startWorker();
  busy = false;
  pending = false;
  showError(message);
}

function showError(message: string): void {
  lastResult = undefined;
  statusEl.textContent = '';
  warningsEl.innerHTML = '';
  const li = document.createElement('li');
  li.className = 'error';
  li.textContent = message;
  warningsEl.append(li);
  downloadsEl.innerHTML = '';
}

function onWorkerMessage(e: MessageEvent<WorkerResponse>): void {
  clearTimeout(watchdog);
  busy = false;
  const msg = e.data;
  if (msg.id === requestId) {
    if (msg.ok) showResult(msg.result, msg.ms);
    else showError(msg.error);
  }
  if (pending) {
    pending = false;
    run();
  }
}

function run(): void {
  if(plannerMode)return;
  if (busy) {
    pending = true;
    return;
  }
  busy = true;
  requestId++;
  statusEl.textContent = 'Generating…';
  worker.postMessage({ id: requestId, req: state });
  watchdog = window.setTimeout(
    () => restartWorker(`Generation took longer than ${TIMEOUT_MS / 1000} s and was stopped. Try a smaller part or fewer features.`),
    TIMEOUT_MS,
  );
}

let timer: number | undefined;
let plannerMode=false,disposePlanner:(()=>void)|undefined;
let plannerDocument=initialPlanner;
const plannerBatch=new BatchQueue();
let sceneJobs:PlannedJob[]=[],sceneDocument:PlannerDocument|undefined,sceneSelected:string|undefined,showAccessories=false;
let sceneTimer:number|undefined,sceneErrors:string[]=[],sceneProgress='';
let drawerFormat:'zip'|'3mf'='zip';
let drawerExport:{controller:AbortController;done:number;total:number}|undefined;
let drawerManifest:{document:string;manifest:PrintManifest}|undefined;
let exportNotice='';
const recipeVolumes=new Map<string,number>();
function recordRecipeVolume(key:string,result:GenerateResult){
  const volume=result.parts.reduce((sum,part)=>sum+part.mesh.volume*part.quantity,0);
  recipeVolumes.delete(key);recipeVolumes.set(key,volume);
  while(recipeVolumes.size>256)recipeVolumes.delete(recipeVolumes.keys().next().value!);
}
function drawerFilamentText():string {
  if(drawerManifest&&drawerManifest.document===JSON.stringify(sceneDocument))return `≤ ${Math.round(estimateFilament(drawerManifest.manifest.totalVolume,prefs.material).grams)} g ${prefs.material} for drawer`;
  let volume=0,known=0;
  for(const planned of sceneJobs){const key=jobKey(planned.job),cached=plannerBatch.cache.get(key);if(cached)recordRecipeVolume(key,cached);const amount=recipeVolumes.get(key);if(amount!==undefined){volume+=amount;known++;}}
  return known===sceneJobs.length?`≤ ${Math.round(estimateFilament(volume,prefs.material).grams)} g ${prefs.material} for drawer`:`Drawer filament pending (${known}/${sceneJobs.length} placements)`;
}
function cancelDrawerExport(){drawerExport?.controller.abort();}
async function downloadDrawer(){
  if(!sceneDocument||drawerExport)return;
  const snapshot=structuredClone(sceneDocument),controller=new AbortController();
  plannerBatch.cancel();clearTimeout(sceneTimer);
  const operation={controller,done:0,total:0};drawerExport=operation;exportNotice='';drawPlannerScene();
  try {
    const output=await exportDrawer(snapshot,{format:drawerFormat,material:prefs.material,signal:controller.signal,
      load:(job,signal)=>plannerBatch.run(job,signal),
      progress:(done,total)=>{operation.done=done;operation.total=total;drawPlannerScene();}});
    controller.signal.throwIfAborted();
    if(!plannerMode||JSON.stringify(sceneDocument)!==JSON.stringify(snapshot))throw new DOMException('Drawer changed.','AbortError');
    drawerManifest={document:JSON.stringify(snapshot),manifest:output.manifest};
    const url=URL.createObjectURL(output.blob),link=document.createElement('a');link.href=url;link.download=`drawer.${drawerFormat}`;link.click();setTimeout(()=>URL.revokeObjectURL(url),5000);
    exportNotice=`Downloaded drawer.${drawerFormat}`;
  }catch(error){exportNotice=controller.signal.aborted?'Drawer export cancelled':error instanceof Error?error.message:String(error);}
  finally {if(drawerExport===operation){drawerExport=undefined;if(plannerMode&&sceneDocument)queuePlannerScene(sceneDocument,sceneSelected);}}
}
function drawPlannerScene(){
  if(!plannerMode||!sceneDocument)return;
  const instances=assemblyInstances(sceneDocument,sceneJobs,plannerBatch.cache,sceneSelected,showAccessories);
  viewer.showAssembly(instances);lastResult=undefined;downloadsEl.replaceChildren();
  statusEl.textContent=(drawerExport?`Exporting drawer ${drawerExport.done}/${drawerExport.total}`:sceneProgress)+` · ${sceneDocument.items.length} items · ${instances.filter(i=>i.proxy).length} footprint proxies · ${drawerFilamentText()}`+(exportNotice?' · '+exportNotice:'');
  warningsEl.replaceChildren();for(const issue of [...planDrawer(sceneDocument).issues,...sceneDocument.items.flatMap(item=>validatePlacement(sceneDocument!,item))]){const li=document.createElement('li');li.textContent=issue.message;warningsEl.append(li);}
  if(drawerManifest?.document===JSON.stringify(sceneDocument)&&drawerManifest.manifest.parts.some(part=>!part.fitsBed)){const li=document.createElement('li');li.textContent='Some drawer pieces exceed the print bed. Enable splitting or adjust the bed settings.';warningsEl.append(li);}
  for(const error of sceneErrors){const li=document.createElement('li');li.textContent=error;warningsEl.append(li);}
  const cancel=document.createElement('button');cancel.textContent=drawerExport?'Cancel export':'Cancel generation';cancel.onclick=()=>{if(drawerExport){cancelDrawerExport();return;}clearTimeout(sceneTimer);plannerBatch.cancel();sceneProgress='Drawer preview cancelled';drawPlannerScene();};downloadsEl.append(cancel);
  const retry=document.createElement('button');retry.textContent='Regenerate preview';retry.disabled=!!drawerExport;retry.onclick=()=>queuePlannerScene(sceneDocument!,sceneSelected);downloadsEl.append(retry);
  const label=document.createElement('label'),toggle=document.createElement('input');toggle.type='checkbox';toggle.checked=showAccessories;toggle.onchange=()=>{showAccessories=toggle.checked;drawPlannerScene();};label.append(toggle,document.createTextNode(' Show loose accessories'));downloadsEl.append(label);
  const format=select([['zip','STL ZIP'],['3mf','3MF']] as ['zip'|'3mf',string][],drawerFormat,value=>{drawerFormat=value;},'Drawer file format');format.disabled=!!drawerExport;downloadsEl.append(format);
  const material=select(Object.keys(MATERIALS).map(m=>[m as Material,m]),prefs.material,value=>{prefs.material=value;localStorage.setItem('material',value);drawPlannerScene();},'Drawer material');material.disabled=!!drawerExport;downloadsEl.append(material);
  const downloadButton=document.createElement('button');downloadButton.textContent='Download drawer';downloadButton.className='primary';downloadButton.disabled=!!drawerExport;downloadButton.onclick=()=>void downloadDrawer();downloadsEl.append(downloadButton);
}
function queuePlannerScene(doc:PlannerDocument,selected?:string){
  cancelDrawerExport();
  plannerBatch.cancel();clearTimeout(sceneTimer);sceneDocument=doc;sceneSelected=selected;sceneJobs=plannerJobs(doc);plannerBatch.cache.pin(sceneJobs.find(job=>job.id===selected)?jobKey(sceneJobs.find(job=>job.id===selected)!.job):undefined);sceneErrors=[];sceneProgress='Preparing drawer preview';drawPlannerScene();
  sceneTimer=window.setTimeout(()=>plannerBatch.start([...sceneJobs].sort((a,b)=>Number(b.id===sceneSelected)-Number(a.id===sceneSelected)).map(job=>job.job),{progress:(done,total)=>{sceneProgress=`Drawer preview ${done}/${total}`;},updated:drawPlannerScene,result:recordRecipeVolume,error:(_key,error)=>{sceneErrors.push(error);}}),180);
}
let singleState=structuredClone(state);
/** fromInput: the change came from a form control that already shows the new value. */
function changed(fromInput = false): void {
  if(!plannerMode) history.replaceState(null, '', '#' + encodeState(state));
  if (!fromInput) renderForm();
  clearTimeout(timer);
  timer = window.setTimeout(run, 180);
}

// ---------------------------------------------------------------------------
// Form
// ---------------------------------------------------------------------------

let disposeForm:(()=>void)|undefined;
function renderForm():void {
  disposeForm?.();
  for(const tab of document.querySelectorAll<HTMLButtonElement>('.kinds button'))tab.classList.toggle('active',tab.dataset.kind===state.kind);
  disposeForm=mountPartForm(form,{getRequest:()=>state,commit:next=>{state=next;changed(true);return true;}});
}

for (const tab of document.querySelectorAll<HTMLButtonElement>('.kinds button')) {
  tab.onclick = () => {
    leavePlanner();
    state.kind = tab.dataset.kind as PartKind;
    changed();
  };
}
function clearPlannerPreview():void {
  cancelDrawerExport();
  plannerBatch.cancel();clearTimeout(sceneTimer);sceneDocument=undefined;
  clearTimeout(timer);timer=undefined;clearTimeout(watchdog);watchdog=undefined;
  requestId++;pending=false;
  if(busy){worker.terminate();if(!plannerMode)worker=startWorker();busy=false;}
  lastResult=undefined;viewer.show([],false,'planner-empty');
  statusEl.textContent='Select a planner item to preview.';warningsEl.replaceChildren();downloadsEl.replaceChildren();
}
function leavePlanner(){
  if(!plannerMode)return;cancelDrawerExport();plannerBatch.cancel();clearTimeout(sceneTimer);sceneDocument=undefined;disposePlanner?.();disposePlanner=undefined;plannerMode=false;worker=startWorker();state=structuredClone(singleState);
  $('#planner-canvas').hidden=true;form.hidden=false;$('#planner-panel').hidden=true;$('#reset').hidden=false;
  $('#planner-mode').classList.remove('active');
}
$<HTMLButtonElement>('#planner-mode').onclick=()=>{
  if(plannerMode)return;
  singleState=structuredClone(state);plannerMode=true;disposeForm?.();clearPlannerPreview();worker.terminate();form.hidden=true;$('#reset').hidden=true;$('#planner-panel').hidden=false;$('#planner-canvas').hidden=false;
  document.querySelectorAll('.kinds button').forEach(tab=>tab.classList.remove('active'));$('#planner-mode').classList.add('active');
  disposePlanner=mountPlanner($('#planner-panel'),$('#planner-canvas'),{document:plannerDocument,onEmptySelection:clearPlannerPreview,onDocument:doc=>{plannerDocument=doc;},onPreview:()=>{},onScene:queuePlannerScene});
};
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
  if (fresh) viewer.show(displayMeshes(r), true, `${state.kind}`);
  const [x, y, z] = r.size;
  const n = r.pieces.length;
  statusEl.textContent = `${mm(x)} × ${mm(y)} × ${mm(z)} mm · ${n} piece${n === 1 ? '' : 's'} · ${Math.round(ms)} ms`;
  statusEl.append(filamentLine(r));

  warningsEl.innerHTML = '';
  for (const [text, cls] of [...r.info.map((t) => [t, 'info']), ...r.warnings.map((t) => [t, ''])]) {
    const li = document.createElement('li');
    li.textContent = text;
    if (cls) li.className = cls;
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
      download(`${base}.zip`, zipSync(Object.fromEntries(files.map((f) => [f.name, f.data]))), 'application/zip');
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
      const role = p.name.startsWith(base) ? p.name.slice(base.length + 1) : p.name;
      a.textContent = `${role || 'bin'} · ${mm(p.max[0] - p.min[0])} × ${mm(p.max[1] - p.min[1])} mm${p.fitsBed ? '' : ' (too big)'}`;
      a.onclick = () => single(p);
      li.append(a);
      list.append(li);
    });
    downloadsEl.append(list);
  }
}

renderForm();
if(initialPlanner)$<HTMLButtonElement>('#planner-mode').click();
else run();
if(initialError)showError(initialError);
