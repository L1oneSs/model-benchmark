import type { PlotObservation } from '../api/benchmarkApi';

export const CHART_COLORS = ['#2563eb', '#d97706', '#059669', '#9333ea', '#dc2626', '#0891b2'];
export interface GraphGroup { name: string; values: number[]; rows: PlotObservation[] }

export function histogram(values: number[], low: number, high: number, bins: number) {
  const counts = Array<number>(bins).fill(0);
  for (const value of values) {
    const index = Math.max(0, Math.min(bins - 1, Math.floor((value - low) / (high - low) * bins)));
    counts[index] += 1;
  }
  return counts;
}

export function ObservationChart({groups, kind, bins, width, height, label, unit}: {
  groups: GraphGroup[]; kind: 'line' | 'scatter' | 'histogram'; bins: number;
  width: number; height: number; label: string; unit: string;
}) {
  const left = 120, right = width - 35, top = 35;
  const bottom = height - Math.ceil(groups.length / 2) * 25 - 90;
  const values = groups.flatMap(g => g.values);
  const observedMin = Math.min(...values), observedMax = Math.max(...values);
  const histLow = observedMin;
  const histHigh = observedMax > histLow ? observedMax : histLow + Math.max(Math.abs(histLow) * .05, 1);
  const counts = groups.map(g => histogram(g.values, histLow, histHigh, bins));
  const valueLow = Math.min(0, observedMin), valueHigh = Math.max(0, observedMax);
  const valueRange = valueHigh - valueLow || 1;
  const yLow = kind === 'histogram' ? 0 : valueLow;
  const yHigh = kind === 'histogram' ? Math.max(1, Math.ceil(Math.max(...counts.flat()) * 1.1)) : valueHigh + valueRange * .08;
  const y = (value: number) => bottom - (value - yLow) / (yHigh - yLow) * (bottom - top);
  const maxSamples = Math.max(...groups.map(g => g.values.length));
  const xIndex = (index: number) => left + (maxSamples === 1 ? .5 : index / (maxSamples - 1)) * (right - left);
  const xValue = (value: number) => left + (value - histLow) / (histHigh - histLow) * (right - left);
  const format = (value: number) => value.toLocaleString('ru-RU', {maximumFractionDigits: unit === 'МиБ' ? 6 : 2});
  const yTicks = [...new Set(Array.from({length: 6}, (_, i) => {
    const value = yLow + (yHigh - yLow) * i / 5;
    return kind === 'histogram' ? Math.round(value) : value;
  }))];
  const xTicks = kind === 'histogram'
    ? Array.from({length: 6}, (_, i) => ({x: xValue(histLow + (histHigh-histLow)*i/5), text: format(histLow + (histHigh-histLow)*i/5)}))
    : [...new Set(Array.from({length: Math.min(maxSamples, 6)}, (_, i) => Math.round(i * (maxSamples - 1) / Math.max(1, Math.min(maxSamples,6)-1))))]
      .map(i => ({x: xIndex(i), text: String(i + 1)}));
  return <g data-chart-type={kind}>
    {yTicks.map(tick => <g key={tick}><line x1={left} x2={right} y1={y(tick)} y2={y(tick)} stroke="#e2e8f0"/>
      <text x={left-12} y={y(tick)+4} textAnchor="end" fill="#475569">{format(tick)}</text></g>)}
    <line x1={left} x2={left} y1={top} y2={bottom} stroke="#94a3b8"/>
    <line x1={left} x2={right} y1={bottom} y2={bottom} stroke="#94a3b8"/>
    {xTicks.map((tick,i) => <text key={i} x={tick.x} y={bottom+23} textAnchor="middle" fill="#475569">{tick.text}</text>)}
    <text x={(left+right)/2} y={bottom+47} textAnchor="middle" fill="#475569">{kind==='histogram' ? `${label}, ${unit}` : 'Номер измерения внутри варианта'}</text>
    <text transform={`translate(19 ${(top+bottom)/2}) rotate(-90)`} textAnchor="middle" fill="#475569">{kind==='histogram' ? 'Количество измерений' : `${label}, ${unit}`}</text>
    {groups.map((group, groupIndex) => {
      const color = CHART_COLORS[groupIndex % CHART_COLORS.length];
      if (kind === 'histogram') {
        const binWidth = (right-left)/bins, barWidth = Math.max(.5, (binWidth-4)/groups.length);
        return <g key={group.name}>{counts[groupIndex].map((count,i) => <rect key={i}
          data-frequency={count} x={left+i*binWidth+2+groupIndex*barWidth} y={y(count)} width={barWidth} height={bottom-y(count)} fill={color}>
          <title>{group.name}: [{format(histLow+(histHigh-histLow)*i/bins)}; {format(histLow+(histHigh-histLow)*(i+1)/bins)}{i===bins-1 ? ']' : ')'} {unit}; измерений: {count}</title>
        </rect>)}</g>;
      }
      return <g key={group.name}>
        {kind==='line' && <polyline data-observation-line="true" fill="none" stroke={color} strokeWidth="2"
          points={group.values.map((value,i) => `${xIndex(i)},${y(value)}`).join(' ')}/>}
        {group.values.map((value,i) => <circle key={group.rows[i].id} data-observation="true" cx={xIndex(i)} cy={y(value)} r={kind==='scatter'?5:3.5} fill={color} fillOpacity={kind==='scatter'?.75:1} stroke="white" strokeWidth="1">
          <title>{group.name}: #{i+1}, ID {group.rows[i].id}, {group.rows[i].created_at}; {format(value)} {unit}</title>
        </circle>)}
      </g>;
    })}
    {groups.map((group,i) => {
      const x=left+(i%2)*(right-left)/2, y=bottom+75+Math.floor(i/2)*25;
      return <g key={group.name}><title>{group.name}; n={group.values.length}</title>
        <rect x={x} y={y-9} width="12" height="12" rx="2" fill={CHART_COLORS[i%CHART_COLORS.length]}/>
        <text x={x+19} y={y+1} fill="#334155" fontSize="11">{group.name.length>65 ? group.name.slice(0,62)+'…' : group.name} (n={group.values.length})</text>
      </g>;
    })}
  </g>;
}
