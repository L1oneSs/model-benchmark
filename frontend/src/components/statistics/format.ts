import type { StatisticsGroup } from '../../benchmark/types';
export const METRICS={inference_ms:'Латентность инференса',load_ms:'Загрузка модели',total_ms:'Полное время',first_token_ms:'До первого предсказания',memory_mb:'Память (изменение JS-кучи)'};
export const SHORT_METRICS={inference_ms:'Инференс',load_ms:'Загрузка',total_ms:'Полное время',first_token_ms:'Первый ответ',memory_mb:'JS-куча'};
export const name=(g:Pick<StatisticsGroup,'model'|'backend'>)=>`${g.model}${g.backend?` · ${g.backend.toUpperCase()}`:''}`;
export const key=(g:Pick<StatisticsGroup,'approach'|'model'|'backend'>)=>JSON.stringify([g.approach,g.model,g.backend]);
export const number=(v:number|null|undefined)=>v==null||!Number.isFinite(v)?'-':v.toLocaleString('ru-RU',{maximumFractionDigits:4});
export const pValue=(v:number|null|undefined)=>v==null?'Недостаточно данных':v<.0001?'< 0,0001':v.toFixed(4).replace('.',',');
export const interval=(v:[number,number]|null|undefined)=>v?v.map(number).join(' - '):'-';
export function download(text:string,filename:string,type='application/json') {const url=URL.createObjectURL(new Blob([text],{type}));const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
