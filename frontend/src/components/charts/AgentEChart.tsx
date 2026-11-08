import { useMemo, useRef, useState } from 'react';
import type { AgentChart } from '../../benchmark/types';
import { Chart, type ChartHandle } from './Chart';
import { Button } from '../ui/button';

export function AgentEChart({chart}:{chart:AgentChart}) {
  const [kind,setKind]=useState(chart.kind??'bar');
  const instance=useRef<ChartHandle>(null);
  const option=useMemo(()=>({
    grid:{left:20,right:30,top:15,bottom:45,containLabel:true},
    xAxis:{type:'value',name:chart.unit,splitLine:{lineStyle:{color:'rgba(128,128,150,.16)'}}},
    yAxis:{type:'category',inverse:true,data:chart.points.map(p=>p.label),axisLabel:{width:200,overflow:'truncate',fontSize:11,formatter:(v:string)=>{const i=v.lastIndexOf(' · ');return i<0?v:`${v.slice(i+3)} · ${v.slice(0,i)}`;}}},
    tooltip:{trigger:'item',renderMode:'richText',valueFormatter:(value:unknown)=>`${Number(Array.isArray(value)?value[0]:value).toLocaleString('ru-RU',{maximumFractionDigits:3})} ${chart.unit}`},
    dataZoom:chart.points.length>6?[{type:'inside',yAxisIndex:0},{type:'slider',yAxisIndex:0,right:0,width:12}]:[],
    series:[{name:chart.statistic==='mean'?'Среднее':'Медиана',type:kind,data:chart.points.map((p,i)=>kind==='bar'?p.value:[p.value,i]),barMaxWidth:28,symbolSize:9,
      label:{show:kind==='bar',position:'right',formatter:(p:{value:unknown})=>Number(p.value).toLocaleString('ru-RU',{maximumFractionDigits:2})}}],
  }),[chart,kind]);
  const save=()=>{const svg=instance.current?.getSVG();if(!svg)return;const url=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));const link=document.createElement('a');link.href=url;link.download=`agent_${chart.metric}_${kind}.svg`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
  return <>
    <div className="echart-tools"><label className="text-xs text-muted-foreground">Вид графика <select aria-label="Вид графика агента" value={kind} onChange={e=>setKind(e.target.value as typeof kind)} className="ml-2 rounded-md border border-input bg-card p-1.5 text-foreground"><option value="bar">Столбчатый</option><option value="line">Линейный</option><option value="scatter">Точечный</option></select></label><Button variant="ghost" size="sm" onClick={save}>Скачать SVG</Button></div>
    <Chart ref={instance} option={option} label={chart.title} height={Math.max(300,Math.min(650,chart.points.length*60+80))}/>
    <details className="echart-data"><summary>Данные графика</summary><table><thead><tr><th>Вариант</th><th>{chart.statistic==='mean'?'Среднее':'Медиана'}, {chart.unit}</th><th>Измерений</th></tr></thead><tbody>{chart.points.map((p,i)=><tr key={i}><th scope="row">{p.label}</th><td>{p.value.toLocaleString('ru-RU',{maximumFractionDigits:3})}</td><td>{p.samples}</td></tr>)}</tbody></table></details>
  </>;
}
