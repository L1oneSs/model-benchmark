import { useState } from 'react';
import type { ExperimentStatistics, StatisticsMetric, StatisticalComparison, StatisticsGroup } from '../../benchmark/types';
import { Heatmap, type HeatCell } from './Heatmap';
import { key, name, number, pValue } from './format';

function ComparisonMatrix({groups,pairs,metric}:{groups:StatisticsGroup[];pairs:StatisticalComparison[];metric:StatisticsMetric}) {
  const lookup=new Map(pairs.map(p=>[JSON.stringify([key(p.a),key(p.b)]),p]));
  return <div className="statistics-modal__scroll statistics-modal__matrix stats-comparison-matrix" tabIndex={0} role="region" aria-label="Все варианты со всеми">
    <table><thead><tr><th scope="col">A ↓ / B →</th>{groups.map(g=><th scope="col" key={key(g)}>{name(g)}</th>)}</tr></thead>
      <tbody>{groups.map(a=><tr key={key(a)}><th scope="row">{name(a)}</th>{groups.map(b=>{
        if(key(a)===key(b))return <td key={key(b)} className="statistics-modal__same">Тот же вариант</td>;
        const direct=lookup.get(JSON.stringify([key(a),key(b)]));
        const p=direct??lookup.get(JSON.stringify([key(b),key(a)]));
        if(!p)return <td key={key(b)}>Нет общих данных</td>;
        const sign=direct?1:-1,delta=p.cliffs_delta==null?null:p.cliffs_delta*sign;
        const ma=a.metrics[metric]!.median,mb=b.metrics[metric]!.median;
        const unit=metric==='memory_mb'?'МиБ':'мс';
        return <td key={key(b)} data-comparison="true"><div className="stats-comparison-card">
          <strong className="stats-comparison-card__effect">δ Клиффа <b>{number(delta)}</b></strong>
          <dl><div><dt>p-value</dt><dd>{pValue(p.p_value)}</dd></div><div><dt>p Холм</dt><dd>{pValue(p.p_value_adjusted)}</dd></div>
            <div><dt>Медианы A / B</dt><dd>{number(mb>0&&ma>=0?ma/mb:null)}</dd></div>
          </dl><small>Измерений A / B: {direct?p.n_a:p.n_b} / {direct?p.n_b:p.n_a}</small>
          <details><summary>Ещё показатели</summary><dl>
            <div><dt>Разность медиан</dt><dd>{number(ma-mb)} {unit}</dd></div>
            <div><dt>Разность средних</dt><dd>{number(p.mean_difference==null?null:p.mean_difference*sign)} {unit}</dd></div>
            <div><dt>Изменение медианы</dt><dd>{number(mb>0?(ma-mb)/mb*100:null)} %</dd></div>
            <div><dt>g Хеджеса</dt><dd>{number(p.hedges_g==null?null:p.hedges_g*sign)}</dd></div>
            <div><dt>P(A &lt; B)*</dt><dd>{number(p.probability_a_lower==null?null:direct?p.probability_a_lower:1-p.probability_a_lower)}</dd></div>
            <div><dt>Вассерштейн</dt><dd>{number(p.wasserstein)} {unit}</dd></div>
            <div><dt>Уэлч p Холм</dt><dd>{pValue(p.welch_p_adjusted)}</dd></div>
            <div><dt>Левен p Холм</dt><dd>{pValue(p.variance_p_adjusted)}</dd></div>
          </dl></details>
        </div></td>;
      })}</tr>)}</tbody>
    </table>
  </div>;
}

export function PairAnalysis({data,metric,heatmap=false}:{data:ExperimentStatistics;metric:StatisticsMetric;heatmap?:boolean}) {
  const groups=data.groups.filter(g=>g.metrics[metric]);
  const pairs=data.comparisons.filter(p=>p.metric===metric);
  const [mode,setMode]=useState('cliffs_delta');
  const modes:Record<string,string>={cliffs_delta:'δ Клиффа',p_value_adjusted:'p-value с поправкой Холма',median_ratio:'Отношение медиан A / B',median_change_percent:'Изменение медианы A относительно B, %',hedges_g:'g Хеджеса',wasserstein:'Расстояние Вассерштейна',probability_a_lower:'P(A < B) с половиной совпадений'};
  if(groups.length<2)return <p>Для сравнения нужны измерения хотя бы двух вариантов.</p>;
  if(!heatmap)return <>
    <p className="statistics-modal__hint">В строке - вариант A, в столбце - вариант B. Каждая ячейка содержит показатели их сравнения. Показаны все доступные варианты выбранной метрики.</p>
    <ComparisonMatrix groups={groups} pairs={pairs} metric={metric}/>
    <p className="statistics-modal__hint">A минус B: отрицательные δ, g и разность означают меньшие значения у A. Отношение A / B меньше 1 также означает меньшее значение у A. Это не оценка качества ответа модели.</p>
    <details className="statistics-modal__pairs"><summary>Подробная таблица уникальных пар: {pairs.length}</summary>
    <div className="statistics-modal__scroll" tabIndex={0} role="region" aria-label="Расширенное сравнение вариантов"><table><thead><tr><th>Вариант A</th><th>Вариант B</th><th>n A / B</th><th>Разность медиан</th><th>Разность средних</th><th>A / B</th><th>Изменение, %</th><th>δ Клиффа</th><th>g Хеджеса</th><th>P(A &lt; B)*</th><th>Вассерштейн</th><th>Манн-Уитни p</th><th>p Холм</th><th>Уэлч t</th><th>Уэлч p</th><th>Уэлч p Холм</th><th>Левен p Холм</th></tr></thead>
      <tbody>{pairs.map(p=><tr key={key(p.a)+key(p.b)}><th scope="row">{name(p.a)}</th><td>{name(p.b)}</td><td>{p.n_a} / {p.n_b}</td><td>{number(p.median_difference)}</td><td>{number(p.mean_difference)}</td><td>{number(p.median_ratio)}</td><td>{number(p.median_change_percent)}</td><td>{number(p.cliffs_delta)}</td><td>{number(p.hedges_g)}</td><td>{number(p.probability_a_lower)}</td><td>{number(p.wasserstein)}</td><td title={p.method}>{pValue(p.p_value)}</td><td>{pValue(p.p_value_adjusted)}</td><td>{number(p.welch_t)}</td><td>{pValue(p.welch_p)}</td><td>{pValue(p.welch_p_adjusted)}</td><td>{pValue(p.variance_p_adjusted)}</td></tr>)}</tbody></table></div></details>
    <p className="statistics-modal__hint">* P(A &lt; B) + ½ P(A = B). Манн-Уитни сравнивает ранги, Уэлч - средние независимых выборок с разными дисперсиями, Левен с центром по медиане - дисперсии. Поправка Холма применяется отдельно к каждому тесту в пределах выбранной метрики. Малое p не означает практически важный эффект.</p>
  </>;
  const cells:HeatCell[]=[];
  for(const [y,a] of groups.entries())for(const [x,b] of groups.entries()){
    const same=key(a)===key(b);
    const direct=pairs.find(p=>key(p.a)===key(a)&&key(p.b)===key(b));
    const p=direct??pairs.find(p=>key(p.a)===key(b)&&key(p.b)===key(a));
    let value:number|null|undefined=null;
    const ma=a.metrics[metric]!.median,mb=b.metrics[metric]!.median;
    if(mode==='median_ratio')value=mb>0&&ma>=0?ma/mb:null;
    else if(mode==='median_change_percent')value=mb>0?(ma-mb)/mb*100:null;
    else if(same)value=mode==='p_value_adjusted'||(mode==='hedges_g'&&(a.metrics[metric]!.samples<2||a.metrics[metric]!.stdev===0))?null:mode==='probability_a_lower'?.5:0;
    else if(p){value=p[mode as keyof StatisticalComparison] as number|null|undefined;if(value!=null&&!direct){if(mode==='cliffs_delta'||mode==='hedges_g')value=-value;if(mode==='probability_a_lower')value=1-value;}}
    if(value!=null&&Number.isFinite(value))cells.push({x,y,value,detail:`A: ${name(a)}\nB: ${name(b)}\n${modes[mode]}: ${mode==='p_value_adjusted'?pValue(value):number(value)}${p?`\nn: ${direct?p.n_a:p.n_b} / ${direct?p.n_b:p.n_a}`:''}`});
  }
  return <><label className="stats-select">Показатель карты<select value={mode} onChange={e=>setMode(e.target.value)}>{Object.entries(modes).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
    <p className="statistics-modal__hint">Строка - A, столбец - B. Пустая клетка означает, что показатель не определён. На диагонали карты p тест не выполняется. Наведение показывает полные названия и значение.</p>
    <Heatmap labels={groups.map((g,i)=>`${i+1}. ${g.backend?.toUpperCase()??g.model}`)} cells={cells} label={modes[mode]} pValues={mode==='p_value_adjusted'} diverging={['cliffs_delta','hedges_g','median_change_percent'].includes(mode)} bounds={mode==='cliffs_delta'?[-1,1]:mode==='probability_a_lower'?[0,1]:undefined} filename={`${metric}_${mode}`}/>
    <details className="echart-data"><summary>Названия вариантов</summary><ol>{groups.map((g,i)=><li key={key(g)}>{i+1}. {name(g)}</li>)}</ol></details>
  </>;
}
