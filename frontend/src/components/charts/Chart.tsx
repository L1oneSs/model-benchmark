import { forwardRef, lazy, Suspense, type CSSProperties } from 'react';
import type { EChartsCoreOption } from 'echarts/core';
const Engine=lazy(()=>import('./EChartEngine'));
export interface ChartHandle {getSVG:()=>string;}
export interface ChartProps {option:EChartsCoreOption;label:string;height?:number;style?:CSSProperties;}
export const Chart=forwardRef<ChartHandle,ChartProps>((props,ref)=><Suspense fallback={<div className="echart flex items-center justify-center text-muted-foreground" role="status">Загружаем график…</div>}><Engine {...props} ref={ref}/></Suspense>);
Chart.displayName='Chart';
