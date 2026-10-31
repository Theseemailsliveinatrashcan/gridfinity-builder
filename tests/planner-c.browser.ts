import { defaultPlanner } from '../src/planner/document';
import { exportDrawer } from '../src/export/planner-download';
import { generate } from '../src/geometry/generate';
import { initKernel, freeAll } from '../src/geometry/kernel';
import { unzipSync, strFromU8 } from 'fflate';

export async function checkThreeMfXmlInBrowser() {
  await initKernel();
  const doc = structuredClone(defaultPlanner);
  const output = await exportDrawer(doc, { format: '3mf', material: 'PLA', progress: () => {}, load: async job => {
    const result = generate(job.req, job.options);
    freeAll();
    return result;
  } });
  const files = unzipSync(new Uint8Array(await output.blob.arrayBuffer()));
  const parser = new DOMParser();
  const xmlFiles = Object.keys(files).filter(path => path.endsWith('.xml') || path.endsWith('.rels') || path.endsWith('.model'));
  for (const path of xmlFiles) {
    const parsed = parser.parseFromString(strFromU8(files[path]), 'application/xml');
    if (parsed.querySelector('parsererror')) throw new Error(`Malformed XML: ${path}`);
  }
  return { parsedXmlFiles: xmlFiles.length, bomAttached: !!files['Metadata/bom.csv'], bytes: output.blob.size };
}

export async function runPlannerCChecks() {
  document.querySelector<HTMLButtonElement>('#planner-mode')!.click();
  const buttons = () => [...document.querySelectorAll<HTMLButtonElement>('#planner-panel button')];
  buttons().find(button => button.textContent === 'Add bin')!.click();
  buttons().find(button => button.textContent === 'Add bin')!.click();
  let status = '';
  for (let i = 0; i < 100; i++) {
    await new Promise(resolve => setTimeout(resolve, 80));
    status = document.querySelector('#status')!.textContent!;
    if (status.includes('0 footprint proxies') && status.includes('g PLA for drawer')) break;
  }
  if (!status.includes('g PLA for drawer')) throw new Error('Drawer filament total missing.');
  const panel = document.querySelector<HTMLElement>('#panel')!;
  if (panel.scrollWidth > panel.clientWidth + 1) throw new Error(`Panel overflows: ${panel.scrollWidth} > ${panel.clientWidth}`);
  // Intercept downloads locally so the cancellation test cannot save a partial file.
  let downloads = 0;
  const click = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.download.startsWith('drawer.')) downloads++; else click.call(this); };
  try {
    const action = (text: string) => [...document.querySelectorAll<HTMLButtonElement>('#downloads button')].find(button => button.textContent === text)!;
    action('Download drawer').click();
    action('Cancel export').click();
    for (let i = 0; i < 100 && !document.querySelector('#status')!.textContent!.includes('cancelled'); i++) await new Promise(resolve => setTimeout(resolve, 30));
    if (downloads) throw new Error('Cancelled export produced a partial download.');
    action('Download drawer').click();
    for (let i = 0; i < 300 && !downloads; i++) await new Promise(resolve => setTimeout(resolve, 40));
    if (downloads !== 1) throw new Error('Completed drawer export did not download exactly once.');
    return { status, panelWidth: panel.clientWidth, panelScrollWidth: panel.scrollWidth, cancelledDownloads: 0, completeDownloads: downloads };
  } finally {
    HTMLAnchorElement.prototype.click = click;
  }
}
