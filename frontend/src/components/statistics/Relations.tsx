import { useState } from 'react';
import type { StatisticsDiagnostics, StatisticsMetric } from '../../benchmark/types';
import { Chart } from '../charts/Chart';
import { Heatmap, type HeatCell } from './Heatmap';
import { key, METRICS, SHORT_METRICS, name, number, pValue } from './format';

export function Relations({diagnostics,metric}:{diagnostics:StatisticsDiagnostics[];metric:StatisticsMetric}) {
  const [selected,setSelected]=useState(''),[method,setMethod]=useState('spearman');
  const group=diagnostics.find(g=>key(g)===selected)??diagnostics[0];
  if(!group)return <p>Нет данных для анализа связей.</p>;
  const metrics=Object.keys(METRICS) as StatisticsMetric[];
  const cells:HeatCell[]=[];
  for(const [y,a] of metrics.entries())for(const [x,b] of metrics.entries()){
    const pair=group.correlations.find(p=>(p.a===a&&p.b===b)||(p.a===b&&p.b===a));
    const values=group.distributions[a]??[];
    const same=a===b,valid=values.length>=3&&Math.max(...values)>Math.min(...values);
    const value=same?(valid?1:null):method==='spearman'?pair?.spearman_r:pair?.pearson_r;
    if(value!=null)cells.push({x,y,value,detail:`${METRICS[a]}\n${METRICS[b]}\n${method==='spearman'?'ρ Спирмена':'r Пирсона'}: ${number(value)}\nn: ${same?values.length:pair?.samples}`});
  }
  const trend=group.trends[metric];
  const chronology=group.chronology[metric]??[];
  return <>
    <div className="statistics-modal__filters"><label>Вариант<select value={key(group)} onChange={e=>setSelected(e.target.value)}>{diagnostics.map(g=><option key={key(g)} value={key(g)}>{name(g)}</option>)}</select></label><label>Коэффициент<select value={method} onChange={e=>setMethod(e.target.value)}><option value="spearman">Спирмен</option><option value="pearson">Пирсон</option></select></label></div>
    <h3>Связи между метриками одного варианта</h3>
    <Heatmap labels={metrics.map(m=>SHORT_METRICS[m])} cells={cells} label="Корреляции метрик" bounds={[-1,1]} filename="metric_correlations"/>
    <p className="statistics-modal__hint">Спирмен оценивает монотонную связь, Пирсон - линейную. Используются только записи, в которых присутствуют обе метрики. Цвет обозначает знак связи, а не качество варианта. Постоянные значения не дают определённой корреляции. Корреляция не доказывает причинность; полное время и его слагаемые могут быть связаны по определению.</p>
    <details className="statistics-modal__pairs"><summary>Коэффициенты и значимость корреляций</summary><div className="statistics-modal__scroll"><table><thead><tr><th>Метрика A</th><th>Метрика B</th><th>Совместных записей</th><th>ρ Спирмена</th><th>p Спирмена, Холм</th><th>r Пирсона</th><th>p Пирсона, Холм</th></tr></thead><tbody>{group.correlations.map(p=><tr key={p.a+p.b}><th scope="row">{SHORT_METRICS[p.a]}</th><td>{SHORT_METRICS[p.b]}</td><td>{p.samples}</td><td>{number(p.spearman_r)}</td><td>{pValue(p.spearman_p_adjusted)}</td><td>{number(p.pearson_r)}</td><td>{pValue(p.pearson_p_adjusted)}</td></tr>)}</tbody></table></div><p className="statistics-modal__hint">p Спирмена: перестановочный расчёт, 1999 перестановок, seed 0. Поправка Холма внутри варианта отдельно для каждого теста. p Пирсона предполагает независимые наблюдения с нормальными распределениями.</p></details>
    <h3>Стабильность: {METRICS[metric]}</h3>
    {trend?<>
      <div className="stats-kpis"><div><span>ρ по порядку записей</span><strong>{number(trend.spearman_r)}</strong></div><div><span>Наклон за запись</span><strong>{number(trend.slope)} {metric==='memory_mb'?'МиБ':'мс'}</strong></div><div><span>Корреляция соседних значений</span><strong>{number(trend.lag1)}</strong></div><div><span>Изменение медианы половин</span><strong>{number(trend.median_change_percent)} %</strong></div></div>
      <Chart label="Метрика по порядку записей" height={330} option={{grid:{left:20,right:25,top:20,bottom:45,containLabel:true},xAxis:{type:'value',name:'Номер записи',minInterval:1},yAxis:{type:'value',name:metric==='memory_mb'?'МиБ':'мс'},series:[{type:'line',data:chronology.map((v,i)=>[i+1,v]),symbolSize:6}]}}/>
      <p className="statistics-modal__hint">Медианы первой и второй половины: {number(trend.first_half_median)} и {number(trend.last_half_median)}. Порядок задаётся временем сохранения в БД и ID, он может отличаться от порядка вызовов моделей. Это описательная диагностика: изменение входов и настроек тоже меняет метрику. Отсутствие заметного наклона не доказывает стабильность.</p>
    </>:<p>Для диагностики нужны минимум три значения выбранной метрики.</p>}
  </>;
}

export function EmpiricalDistribution({diagnostics,metric}:{diagnostics:StatisticsDiagnostics[];metric:StatisticsMetric}) {
  const available=diagnostics.filter(g=>g.distributions[metric]?.length);
  if(!available.length)return null;
  return <><h3>Эмпирическое распределение (ECDF)</h3><Chart label="Эмпирическая накопленная доля измерений" height={380} option={{
    grid:{left:25,right:25,top:55,bottom:55,containLabel:true},legend:{type:'scroll',top:0},
    xAxis:{type:'value',name:metric==='memory_mb'?'МиБ':'мс'},yAxis:{type:'value',min:0,max:100,name:'Доля, %'},
    series:available.map(g=>({name:name(g),type:'line',step:'end',showSymbol:false,data:g.distributions[metric]!.map((v,i,a)=>[v,(i+1)/a.length*100])})),
  }}/><p className="statistics-modal__hint">Показывает, какая доля измерений не превышает значение на оси X. Скрывайте варианты через легенду. Это эмпирическое распределение выбранных записей, а не прогноз новых результатов.</p></>;
}
