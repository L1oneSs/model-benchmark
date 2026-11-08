import type { MetricSummary, StatisticsGroup, StatisticsMetric } from '../../benchmark/types';
import { interval, name, number, pValue } from './format';

type Column={label:string;value:(s:MetricSummary)=>string;hint?:string};
export function SummaryTable({groups,metric,columns,label}:{groups:StatisticsGroup[];metric:StatisticsMetric;columns:Column[];label:string}) {
  return <div className="statistics-modal__scroll" tabIndex={0} role="region" aria-label={label}><table><thead><tr><th>Модель и бэкенд</th>{columns.map(c=><th key={c.label} title={c.hint}>{c.label}</th>)}</tr></thead>
    <tbody>{groups.map(g=><tr key={name(g)}><th scope="row">{name(g)}</th>{columns.map(c=><td key={c.label}>{g.metrics[metric]?c.value(g.metrics[metric]!):'-'}</td>)}</tr>)}</tbody></table></div>;
}
export const overviewColumns:Column[]=[
  {label:'n',value:s=>number(s.samples)},
  {label:'Пропуски',value:s=>number(s.missing??0)},
  {label:'Среднее',value:s=>number(s.mean)},
  {label:'95% ДИ среднего',value:s=>interval(s.mean_ci95)},
  {label:'Медиана',value:s=>number(s.median)},
  {label:'95% ДИ медианы',value:s=>interval(s.ci95)},
  {label:'Станд. отклонение',value:s=>number(s.samples>1?s.stdev:null)},
  {label:'CV, %',value:s=>number(s.cv_percent),hint:'Стандартное отклонение / среднее × 100; только при положительном среднем'},
  {label:'p95',value:s=>number(s.p95)},
  {label:'Мин.',value:s=>number(s.min)},
  {label:'Макс.',value:s=>number(s.max)},
];
export const percentileColumns:Column[]=[
  {label:'p5',value:s=>number(s.p5)},{label:'p10',value:s=>number(s.p10)},
  {label:'p25 (Q1)',value:s=>number(s.q1)},{label:'p50',value:s=>number(s.median)},
  {label:'p75 (Q3)',value:s=>number(s.q3)},{label:'p90',value:s=>number(s.p90)},
  {label:'p95',value:s=>number(s.p95)},{label:'p99',value:s=>number(s.p99)},
  {label:'p95 / медиана',value:s=>number(s.tail_ratio)},
];
export const spreadColumns:Column[]=[
  {label:'Размах',value:s=>number(s.range)},
  {label:'Дисперсия',value:s=>number(s.variance),hint:'Единицы измерения в квадрате'},
  {label:'SEM',value:s=>number(s.sem),hint:'Стандартная ошибка среднего; предполагает независимые наблюдения'},
  {label:'IQR',value:s=>number(s.iqr)},
  {label:'MAD',value:s=>number(s.mad),hint:'Медиана абсолютных отклонений от медианы'},
  {label:'Робастная σ',value:s=>number(s.robust_sigma),hint:'MAD / 0,67449; оценка масштаба при нормальном распределении'},
  {label:'Усечённое среднее',value:s=>number(s.trimmed_mean),hint:'Удалено по floor(0,1 × n) значений с каждого края только для этого расчёта'},
  {label:'Геометрическое',value:s=>number(s.geometric_mean),hint:'Только если все значения положительные'},
  {label:'Гармоническое',value:s=>number(s.harmonic_mean),hint:'Только если все значения положительные'},
];
export const shapeColumns:Column[]=[
  {label:'Асимметрия',value:s=>number(s.skewness)},
  {label:'Эксцесс',value:s=>number(s.excess_kurtosis),hint:'Эксцесс Фишера: для нормального распределения 0'},
  {label:'Шапиро-Уилк W',value:s=>number(s.normality?.statistic)},
  {label:'Шапиро p',value:s=>pValue(s.normality?.p_value)},
  {label:'Выбросов',value:s=>`${s.outliers} (${number(s.outlier_percent)} %)`},
  {label:'Границы 1,5 IQR',value:s=>`${number(s.outlier_low)} - ${number(s.outlier_high)}`},
  {label:'Нулей',value:s=>number(s.zeros)},
  {label:'Уникальных значений',value:s=>number(s.unique)},
];
