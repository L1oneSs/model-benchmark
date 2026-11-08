import type { EChartsCoreOption } from 'echarts/core';
export type ChartKind='bar'|'line'|'scatter'|'histogram'|'box';
export type Statistic='median'|'mean'|'p95';
export interface ChartGroup {name:string;values:number[];}
export function quantile(values:number[],p:number){const sorted=[...values].sort((a,b)=>a-b),i=(sorted.length-1)*p,low=Math.floor(i);return sorted[low]+(sorted[Math.ceil(i)]-sorted[low])*(i-low);}
export function plotOptions(groups:ChartGroup[],kind:ChartKind,unit:string,statistic:Statistic='median',bins=10):EChartsCoreOption {
  const format=(v:number)=>`${v.toLocaleString('ru-RU',{maximumFractionDigits:3})} ${unit}`;
  const categories=groups.map(g=>g.name);
  const names={median:'Медиана',mean:'Среднее',p95:'p95'};
  const base:EChartsCoreOption={grid:{left:22,right:30,top:55,bottom:80,containLabel:true},
    legend:{type:'scroll',top:0},toolbox:{right:0,top:22,feature:{restore:{title:'Сбросить масштаб'}}},
    tooltip:{trigger:'item',renderMode:'richText',valueFormatter:(value:unknown)=>typeof value==='number'?format(value):String(value)},
    dataZoom:[{type:'inside',filterMode:'none'},{type:'slider',height:18,bottom:15,filterMode:'none'}]};
  const valueAxis={type:'value',name:unit,axisLabel:{formatter:(v:number)=>v.toLocaleString('ru-RU',{maximumFractionDigits:2})},splitLine:{lineStyle:{color:'rgba(128,128,150,.16)'}}};
  if(kind==='bar'||kind==='box')return {...base,legend:{show:false},
    xAxis:{...valueAxis},yAxis:{type:'category',inverse:true,data:categories,axisLabel:{width:220,overflow:'truncate',fontSize:11,formatter:(v:string)=>{const i=v.lastIndexOf(' · ');return i<0?v:`${v.slice(i+3)} · ${v.slice(0,i)}`;}}},
    dataZoom:[{type:'inside',yAxisIndex:0},{type:'slider',yAxisIndex:0,right:0,width:12}],
    series:[{name:kind==='box'?'Распределение':names[statistic],type:kind==='box'?'boxplot':'bar',
      barMaxWidth:32,itemStyle:{borderRadius:kind==='bar'?4:0},
      data:groups.map((g,i)=>kind==='box'?[Math.min(...g.values),quantile(g.values,.25),quantile(g.values,.5),quantile(g.values,.75),Math.max(...g.values)]:
        {value:statistic==='mean'?g.values.reduce((a,b)=>a+b,0)/g.values.length:quantile(g.values,statistic==='p95'?.95:.5),name:g.name,itemStyle:{color:['#6366f1','#0d9488','#f59e0b','#e879a8','#0284c7'][i%5]}}),
    }]};
  if(kind==='histogram'){
    const all=groups.flatMap(g=>g.values),low=Math.min(...all),max=Math.max(...all),high=max>low?max:low+Math.max(1,Math.abs(low)*.05),width=(high-low)/bins;
    const labels=Array.from({length:bins},(_,i)=>`${(low+i*width).toLocaleString('ru-RU',{maximumFractionDigits:2})}–${(low+(i+1)*width).toLocaleString('ru-RU',{maximumFractionDigits:2})}`);
    return {...base,xAxis:{type:'category',data:labels,name:unit,axisLabel:{rotate:25,fontSize:10}},yAxis:{...valueAxis,name:'Измерений',minInterval:1},
      tooltip:{trigger:'axis',renderMode:'richText'},series:groups.map(g=>{const counts=Array<number>(bins).fill(0);for(const v of g.values)counts[Math.max(0,Math.min(bins-1,Math.floor((v-low)/width)))]+=1;return {name:g.name,type:'bar',data:counts,barMaxWidth:24};})};
  }
  return {...base,xAxis:{type:'value',name:'Номер измерения',minInterval:1},yAxis:valueAxis,
    series:groups.map(g=>({name:g.name,type:kind,symbolSize:kind==='scatter'?8:5,showSymbol:true,
      data:g.values.map((v,i)=>[i+1,v]),lineStyle:{width:2},emphasis:{focus:'series'}}))};
}
