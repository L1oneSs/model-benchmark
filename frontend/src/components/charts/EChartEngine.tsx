import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';
import { init, use, type EChartsType } from 'echarts/core';
import { BarChart, LineChart, ScatterChart, BoxplotChart, HeatmapChart } from 'echarts/charts';
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent, DataZoomComponent, ToolboxComponent, TitleComponent, VisualMapComponent } from 'echarts/components';
import { SVGRenderer } from 'echarts/renderers';
import { useTheme } from '../ThemeProvider';
import type { ChartHandle, ChartProps } from './Chart';

use([BarChart,LineChart,ScatterChart,BoxplotChart,HeatmapChart,VisualMapComponent,AriaComponent,GridComponent,LegendComponent,TooltipComponent,DataZoomComponent,ToolboxComponent,TitleComponent,SVGRenderer]);

const Engine=forwardRef<ChartHandle,ChartProps>(({option,label,height=420,style},ref)=>{
  const container=useRef<HTMLDivElement>(null),chart=useRef<EChartsType|null>(null);
  const {resolved}=useTheme();
  useImperativeHandle(ref,()=>({getSVG:()=>chart.current?.renderToSVGString()??''}),[]);
  useEffect(()=>{
    const node=container.current;if(!node)return;
    const css=getComputedStyle(document.documentElement),color=(key:string)=>css.getPropertyValue(key).trim();
    let frame=0;
    const render=()=>{
      if(!node.clientWidth||!node.clientHeight)return;
      const instance=chart.current??init(node,undefined,{renderer:'svg'});chart.current=instance;
      const axis=(value:unknown)=>{
        const one=(entry:unknown)=>{
          const original=(entry??{}) as Record<string,unknown>;
          return {...original,axisLabel:{color:color('--muted-foreground'),...(original.axisLabel as object??{})},
            nameTextStyle:{color:color('--muted-foreground')},axisLine:{lineStyle:{color:color('--border')}}};
        };
        return Array.isArray(value)?value.map(one):one(value);
      };
      instance.setOption({backgroundColor:color('--card'),color:[1,2,3,4,5].map(i=>color(`--chart-${i}`)),
        textStyle:{color:color('--foreground'),fontFamily:'Inter, Segoe UI, sans-serif'},
        animation:!matchMedia('(prefers-reduced-motion: reduce)').matches,animationDuration:250,
        aria:{enabled:true,label:{description:label}},
        ...option,
        xAxis:axis(option.xAxis),yAxis:axis(option.yAxis),
        tooltip:{trigger:'item',renderMode:'richText',backgroundColor:color('--popover'),borderColor:color('--border'),textStyle:{color:color('--foreground')},...(option.tooltip as object??{})},
        legend:{textStyle:{color:color('--muted-foreground')},pageTextStyle:{color:color('--foreground')},...(option.legend as object??{})},
      },{notMerge:true});
      instance.resize();
    };
    frame=requestAnimationFrame(render);
    const observer=new ResizeObserver(()=>{cancelAnimationFrame(frame);frame=requestAnimationFrame(()=>{if(chart.current)chart.current.resize();else render();});});observer.observe(node);
    return()=>{cancelAnimationFrame(frame);observer.disconnect();chart.current?.dispose();chart.current=null;};
  },[option,resolved,label]);
  return <div ref={container} className="echart" style={{height,...style}} role="img" aria-label={label}/>;
});
Engine.displayName='EChartEngine';
export default Engine;
