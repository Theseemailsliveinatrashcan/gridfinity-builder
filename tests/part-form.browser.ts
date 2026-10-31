import { mountPartForm } from '../src/ui/part-form';
import { DEFAULTS } from '../src/state';
/** Run in the local browser; no DOM-test dependency is needed. */
export function runPartFormChecks() {
 const host=document.createElement('div');document.body.append(host);
 let current=structuredClone(DEFAULTS),commits=0;
 const mount=()=>mountPartForm(host,{getRequest:()=>current,commit:next=>{commits++;if(next.bin.width>2)return false;current=next;return true;}});
 let dispose=mount();
 const control=(key:string)=>host.querySelector<HTMLInputElement|HTMLSelectElement>(`[data-key="${key}"]`)!;
 const width=control('bin.width');width.value='4';width.dispatchEvent(new Event('change'));
 if(current.bin.width!==2||control('bin.width').value!=='2')throw new Error('Rejected form edit mutated the request or controls.');
 control('bin.scoop').value='0.2';control('bin.scoop').dispatchEvent(new Event('input'));
 const slider=control('bin.scoop');slider.value='0.4';slider.dispatchEvent(new Event('input'));
 if(control('bin.scoop')!==slider||current.bin.scoop!==0.4)throw new Error('Range control was rebuilt during a continuous edit.');
 dispose();current.kind='holder';dispose=mount();
 const preset=control('holder.preset');preset.value='aa';preset.dispatchEvent(new Event('change'));
 if(current.holder.size!==15.1||control('holder.size').value!=='15.1')throw new Error('Preset side effects did not redraw the shared form.');
 const groups=host.querySelectorAll('optgroup').length;
 if(groups!==9)throw new Error('Preset optgroups missing.');
 dispose();const empty=host.children.length===0;host.remove();if(!empty)throw new Error('Form disposal failed.');
 return {rejectedCommit:true,sliderIdentity:true,presetRedraw:true,groups,disposed:true,commits};
}
