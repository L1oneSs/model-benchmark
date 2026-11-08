import { useRef } from 'react';
import { Chart, type ChartHandle } from '../charts/Chart';
import { Button } from '../ui/button';
import { download, number } from './format';

export interface HeatCell {x:number;y:number;value:number;detail:string;}
export function Heatmap({labels,cells,label,pValues=false,diverging=true,bounds,filename}:{labels:string[];cells:HeatCell[];label:string;pValues?:boolean;diverging?:boolean;bounds?:[number,number];filename:string}) {
  const chart=useRef<ChartHandle>(null);
  if(!cells.length)return <p className="statistics-modal__hint">Недостаточно данных для тепловой карты.</p>;
  const max=Math.max(...cells.map(c=>Math.abs(c.value)),.001);
  const [low,high]=bounds??(diverging?[-max,max]:[0,max]);
  const option={grid:{top:20,left:30,right:30,bottom:105,containLabel:true},
    xAxis:{type:'category',data:labels,splitArea:{show:true},axisLabel:{rotate:25,width:130,overflow:'truncate',fontSize:10}},
    yAxis:{type:'category',inverse:true,data:labels,splitArea:{show:true},axisLabel:{width:170,overflow:'truncate',fontSize:10}},
    tooltip:{trigger:'item',renderMode:'richText',formatter:(p:{data:{detail:string}})=>p.data.detail},
    visualMap:pValues?{type:'piecewise',dimension:2,orient:'horizontal',left:'center',bottom:10,textStyle:{color:'#8b8e9b'},pieces:[
      {lte:.01,color:'#0d9488',label:'p ≤ 0,01'},{gt:.01,lte:.05,color:'#eab308',label:'0,01 < p ≤ 0,05'},{gt:.05,lte:1,color:'#94a3b8',label:'p > 0,05'}]}:
      {min:low,max:high,dimension:2,calculable:true,orient:'horizontal',left:'center',bottom:10,textStyle:{color:'#8b8e9b'},inRange:{color:diverging?['#0d9488','#e5e7eb','#e76f51']:['#f1f5f9','#6366f1']},precision:2},
    series:[{type:'heatmap',data:cells.map(c=>({value:[c.x,c.y,c.value],detail:c.detail})),label:{show:labels.length<=10,color:'#17212f',fontSize:11,formatter:(p:{value:number[]})=>pValues?p.value[2]<.0001?'<0,0001':p.value[2].toFixed(3):number(p.value[2])},itemStyle:{borderWidth:2,borderColor:'rgba(128,128,150,.12)'},emphasis:{itemStyle:{borderColor:'#6366f1',borderWidth:3}}}],
  };
  return <><div className="stats-heatmap"><Chart ref={chart} option={option} label={label} height={Math.max(380,Math.min(800,labels.length*55+150))}/></div>
    <div className="echart-tools"><Button variant="ghost" size="sm" onClick={()=>{const svg=chart.current?.getSVG();if(svg)download(svg,filename+'.svg','image/svg+xml');}}>Скачать карту SVG</Button></div></>;
}
