import { BED_PRESETS, SECTIONS, onFieldChange, type Field, type Section } from '../fields';
import type { GenerateRequest } from '../geometry/generate';
export interface PartFormOptions {getRequest:()=>GenerateRequest;commit:(request:GenerateRequest)=>boolean|void;sections?:Section[]}
/** Edits a private adapter; rejected commits restore the controls from their source. */
export function mountPartForm(form:HTMLElement, options:PartFormOptions):()=>void {
  const sections=options.sections??SECTIONS;
  let state=structuredClone(options.getRequest()),renderedLayout='';
  const layoutKey=()=>state.kind+sections.flatMap(s=>s.fields.map(f=>f.show&&!f.show(state)?'0':'1')).join('');
  function changed(fromInput=false) {
    const accepted=options.commit(structuredClone(state))!==false;
    state=structuredClone(options.getRequest());
    if(!accepted||!fromInput||layoutKey()!==renderedLayout)renderForm();
  }
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
      changed(true);
    };
    wrap.append(el, title);
  } else if (f.kind === 'select') {
    const el = document.createElement('select');
    const groups = new Map<string, HTMLOptGroupElement>();
    for (const [v, text] of f.options ?? []) {
      const name = f.optionGroups?.[v];
      if (name && !groups.has(name)) {
        const group = document.createElement('optgroup'); group.label = name;
        groups.set(name, group); el.append(group);
      }
      (name ? groups.get(name)! : el).append(new Option(text, v, false, v === value));
    }
    el.onchange = () => {
      groupOf(f)[f.key] = el.value;
      const others = onFieldChange(state, f);
      changed(!others);
    };
    wrap.append(title, el);
  } else {
    const el = document.createElement('input');
    el.type = f.kind === 'range' ? 'range' : 'number';
    if (f.min !== undefined) el.min = String(f.min);
    if (f.max !== undefined) el.max = String(f.max);
    if (f.step !== undefined) el.step = String(f.step);
    el.value = String(value);
    const out = document.createElement('output');
    out.textContent = Number(value).toFixed(2);
    const commit = () => {
      const n = Number(el.value);
      if (!Number.isFinite(n)) return;
      const clamped = Math.min(f.max ?? Infinity, Math.max(f.min ?? -Infinity, n));
      groupOf(f)[f.key] = clamped;
      el.value = String(clamped);
      out.textContent = clamped.toFixed(2);
      changed(true);
    };
    if (f.kind === 'range') {
      el.oninput = commit;
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
  renderedLayout = layoutKey();
  const focused = document.activeElement as HTMLElement | null;
  const focusKey = focused?.dataset.key;
  form.innerHTML = '';
  for (const section of sections) {
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

renderForm();
return ()=>form.replaceChildren();
}
