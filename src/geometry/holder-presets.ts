interface PresetValues {shape?: 'round'|'hex'|'rect';size?:number;slotThickness?:number;pocketDepth?:number;fingerNotch?:boolean}

export interface HolderItem {
  shape: 'round' | 'hex';
  size: number;
  pocketDepth: number;
  label: string;
  fingerNotch?: boolean;
}
const round = (size: number, pocketDepth: number): PresetValues => ({ shape: 'round', size, pocketDepth });
export const SINGLE_PRESETS = {
  '9v': { shape: 'rect', size: 27, slotThickness: 18, pocketDepth: 15 },
  c: round(26.8, 20), d: round(34.8, 25), aaaa: round(8.9, 15), cr123a: round(17.6, 14),
  '14500': round(14.7, 20), '26650': round(26.6, 24),
  lr44: { ...round(12.2, 3), fingerNotch: true },
  cr2025: { ...round(20.6, 1.8), fingerNotch: true },
  cr2016: { ...round(20.6, 1.2), fingerNotch: true },
  cr1220: { ...round(13.1, 1.5), fingerNotch: true },
} satisfies Record<string, PresetValues>;
const drill = (count: number, step: number, start: number): HolderItem[] => Array.from({length:count},(_,i)=>{
  const diameter=start+i*step;
  return {shape:'round',size:diameter+0.3,pocketDepth:12,label:`${Number(diameter.toFixed(4))}`};
});
const keys = (sizes: number[]): HolderItem[] => sizes.map(size=>({shape:'hex',size:size+(size<=3?0.5:0.4),pocketDepth:10,label:`${Number(size.toFixed(5))}`}));
const coins = (values: [number,number][]): HolderItem[] => values.map(([size,thickness])=>({shape:'round',size:size+1,pocketDepth:20*thickness+3,label:`${size}`,fingerNotch:true}));
export const SET_PRESETS = {
  'drill-metric-6.5': drill(12,0.5,1),
  'drill-metric-13': drill(25,0.5,1),
  'drill-fractional': drill(29,25.4/64,25.4/16),
  'hex-metric': keys([1.5,2,2.5,3,4,5,6,8,10]),
  'hex-sae': keys([1/16,5/64,3/32,7/64,1/8,9/64,5/32,3/16,7/32,1/4,5/16,3/8].map(n=>n*25.4)),
  'coins-us': coins([[19.05,1.52],[21.21,1.95],[17.91,1.35],[24.26,1.75],[30.61,2.15],[26.49,2]]),
  'coins-euro': coins([[16.25,1.67],[18.75,1.67],[21.25,1.67],[19.75,1.93],[22.25,2.14],[24.25,2.38],[23.25,2.33],[25.75,2.2]]),
  'coins-uk': coins([[20.3,1.65],[25.9,1.85],[18,1.7],[24.5,1.85],[21.4,1.7],[27.3,1.78],[23.43,2.8],[28.4,2.5]]),
  'nuts-metric': [5.5,7,8,10,13].map((size,i):HolderItem=>({shape:'hex',size:size+0.5,pocketDepth:[2.4,3.2,4.7,5.2,6.8][i]+1,label:`${size}`})),
};
export type NewHolderPreset = keyof typeof SINGLE_PRESETS | keyof typeof SET_PRESETS;
export function presetItems(preset: string): HolderItem[] | undefined {
  const items=SET_PRESETS[preset as keyof typeof SET_PRESETS];
  return items?.map(item=>({...item})).sort((a,b)=>a.size-b.size);
}
export const HOLDER_PRESET_GROUPS: {label:string;options:[string,string][]}[] = [
  {label:'Batteries',options:[['aa','AA'],['aaa','AAA'],['aaaa','AAAA'],['9v','9V'],['c','C'],['d','D'],['cr123a','CR123A'],['14500','14500'],['18650','18650'],['21700','21700'],['26650','26650']]},
  {label:'Button cells',options:[['lr44','LR44'],['cr1220','CR1220'],['cr2016','CR2016'],['cr2025','CR2025'],['cr2032','CR2032']]},
  {label:'Bits & keys',options:[['hex14','¼″ hex bit'],['hex4','4 mm hex bit'],['hex-metric','Metric hex key set'],['hex-sae','SAE hex key set']]},
  {label:'Drill index',options:[['drill-metric-6.5','Metric 1–6.5 mm'],['drill-metric-13','Metric 1–13 mm'],['drill-fractional','Fractional 1/16″–1/2″']]},
  {label:'Coins',options:[['coins-us','US coin tubes'],['coins-euro','Euro coin tubes'],['coins-uk','UK coin tubes']]},
  {label:'Fasteners',options:[['nuts-metric','Metric nuts M3–M8']]},
  {label:'Cards & pens',options:[['sd','SD card'],['microsd','microSD card'],['pen','Pen'],['marker','Marker']]},
  {label:'Sockets',options:[['socket14','¼″ socket drive'],['socket38','⅜″ socket drive']]},
  {label:'Custom',options:[['custom','Custom (keep values)']]},
];
