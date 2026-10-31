export async function runPlannerBChecks(){
 const pause=()=>new Promise(r=>setTimeout(r,80));
 const button=(name:string)=>[...document.querySelectorAll<HTMLButtonElement>('#planner-panel button')].find(b=>b.textContent===name)!.click();
 document.querySelector<HTMLButtonElement>('#planner-mode')!.click();button('Add bin');button('Add bin');button('Add holder');
 const padding=document.querySelector<HTMLSelectElement>('[aria-label="Baseplate padding"]')!;padding.value='spacers';padding.dispatchEvent(new Event('change'));
 let status='';for(let i=0;i<200;i++){await pause();status=document.querySelector('#status')!.textContent??'';const match=status.match(/Drawer preview (\d+)\/(\d+)/);if(match&&match[1]===match[2]&&status.includes('0 footprint proxies'))break;}
 if(!status.includes('3 items · 0 footprint proxies'))throw new Error('Assembly did not finish: '+status);
 const canvas=document.querySelector<HTMLCanvasElement>('#viewport canvas')!,ctx=canvas.getContext('2d')!;
 const pixels=ctx.getImageData(0,0,canvas.width,canvas.height).data;let colored=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i]!==243||pixels[i+1]!==244||pixels[i+2]!==247)colored++;
 if(!colored)throw new Error('Fallback assembly canvas is blank.');
 if(!document.querySelector('.spacer-outline'))throw new Error('Separate spacer strips missing.');
 const accessories=document.querySelector<HTMLInputElement>('#downloads input[type=checkbox]')!;if(accessories.checked)throw new Error('Loose accessories should start hidden.');
 const cancel=[...document.querySelectorAll<HTMLButtonElement>('#downloads button')].find(b=>b.textContent==='Cancel generation')!;cancel.click();
 if(!document.querySelector('#status')!.textContent!.includes('cancelled'))throw new Error('Cancel action did not update status.');
 return {status,coloredPixels:colored,spacerStrips:document.querySelectorAll('.spacer-outline').length,accessoriesHidden:true,cancel:true};
}
