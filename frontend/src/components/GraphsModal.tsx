import { useEffect, useId, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { fetchPlotData, type PlotObservation } from '../api/benchmarkApi';
import type { ExperimentDefinition } from '../benchmark/experiments';
import { digest } from '../benchmark/provenance';
import type { GraphGroup } from './ObservationChart';
import { Chart, type ChartHandle } from './charts/Chart';
import { plotOptions } from './charts/plotOptions';
import { Button } from './ui/button';
import './StatisticsModal.scss';
import './GraphsModal.scss';

const METRICS = {inference_ms: 'Латентность инференса', load_ms: 'Загрузка модели', total_ms: 'Полное время', first_token_ms: 'До первого предсказания', memory_mb: 'Память (изменение JS-кучи)'};
type Metric = keyof typeof METRICS;
type ChartKind = 'bar' | 'line' | 'scatter' | 'histogram' | 'box';
type Statistic = 'median' | 'mean' | 'p95';
function quantile(values: number[], p: number) {
  const x = [...values].sort((a,b) => a-b), position = (x.length - 1) * p, lo = Math.floor(position);
  return x[lo] + (x[Math.ceil(position)] - x[lo]) * (position-lo);
}
function download(text: string, type: string, filename: string) {
  const url = URL.createObjectURL(new Blob([text], {type}));
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function MetricChart({experiment, rows, window, metric, kind, statistic, bins, backend}: {
  experiment: ExperimentDefinition; rows: PlotObservation[]; window: number; metric: Metric; kind: ChartKind; statistic: Statistic; bins: number; backend: string;
}) {
  const chart = useRef<ChartHandle>(null);
  const [error,setError]=useState('');
  const filtered=rows.filter(row=>(backend==='all'||row.backend===backend||!row.backend)&&Number.isFinite(row.metrics[metric]));
  const grouped=new Map<string,GraphGroup>();
  for(const row of filtered){const key=JSON.stringify([row.approach,row.model,row.backend]);if(!grouped.has(key))grouped.set(key,{name:row.model+(row.backend?` · ${row.backend.toUpperCase()}`:''),values:[],rows:[]});grouped.get(key)!.rows.push(row);}
  const groups=[...grouped.values()];
  for(const group of groups){group.rows.sort((a,b)=>Date.parse(a.created_at)-Date.parse(b.created_at)||a.id-b.id);group.values=group.rows.map(r=>r.metrics[metric]);}
  const unit=metric==='memory_mb'?'МиБ':'мс';
  const metadata={experiment:experiment.key,title:experiment.title,metric,unit,chart:kind,window,statistic:kind==='bar'?statistic:null,
    histogram_bins:kind==='histogram'?bins:null,observation_order:'created_at then ID ascending within each variant',backend_filter:backend,
    generated_from:'individual successful measurements',observations:filtered,group_order:groups.map(g=>g.name),schema_version:2,renderer:'Apache ECharts'};
  const exportName=`${experiment.key}_${metric}_${kind}`;
  const option=plotOptions(groups,kind,unit,statistic,bins);
  const height=kind==='bar'||kind==='box'?Math.max(340,Math.min(700,groups.length*60+100)):430;
  async function saveMetadata(){try{const figure=chart.current?.getSVG()??'';download(JSON.stringify({...metadata,exported_at:new Date().toISOString(),outputs:{figure_sha256:await digest(figure),observations_sha256:await digest(JSON.stringify(filtered)),hash_encoding:'UTF-8, exact ECharts SVG and JSON.stringify(observations)'}},null,2),'application/json',`${exportName}_chart.json`);}catch(reason){setError(String(reason));}}
  return <section className="graphs-modal__metric" data-metric={metric}>
    <h3>{METRICS[metric]}, {unit}</h3>{error&&<p role="alert">{error}</p>}
    {!groups.length?<p>Для этой метрики пока нет успешных измерений.</p>:<>
      <div className="graphs-modal__plot"><Chart ref={chart} option={option} label={`${experiment.title}: ${METRICS[metric]}, ${unit}`} height={height}/></div>
      <p className="statistics-modal__hint">Наведите на данные для подробностей. Масштаб можно менять ползунком или колёсиком над графиком; легенда включает и скрывает варианты.</p>
      {kind==='box'&&<p className="statistics-modal__hint">Коробка: 25-й и 75-й процентили, черта - медиана, края - минимум и максимум.</p>}
      {(kind==='line'||kind==='scatter')&&<p className="statistics-modal__hint">Номер измерения задаётся внутри каждого варианта по дате и ID; он не обозначает общий запуск.</p>}
      {kind==='histogram'&&<p className="statistics-modal__hint">Границы интервалов одинаковы для всех вариантов. Последний интервал включает правый край.</p>}
      <div className="echart-tools"><Button variant="outline" size="sm" onClick={()=>{const svg=chart.current?.getSVG();if(svg)download(svg,'image/svg+xml',`${exportName}.svg`);}}>Скачать SVG</Button>
        <Button variant="ghost" size="sm" onClick={()=>void saveMetadata()}>Метаданные графика JSON</Button></div>
      <details className="echart-data"><summary>Данные графика: {filtered.length} измерений</summary><div className="statistics-modal__scroll"><table><thead><tr><th>Вариант</th><th>Измерений</th><th>Минимум</th><th>Медиана</th><th>Максимум</th></tr></thead><tbody>{groups.map(g=><tr key={g.name}><th scope="row">{g.name}</th><td>{g.values.length}</td>{[Math.min(...g.values),quantile(g.values,.5),Math.max(...g.values)].map((v,i)=><td key={i}>{v.toLocaleString('ru-RU',{maximumFractionDigits:3})} {unit}</td>)}</tr>)}</tbody></table></div></details>
    </>}
  </section>;
}

export function GraphsModal({experiment, onClose}: {experiment: ExperimentDefinition; onClose: () => void}) {
  const titleId = useId();
  const [rows, setRows] = useState<PlotObservation[]>([]), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [window, setWindow] = useState(30), [metric, setMetric] = useState<Metric | 'all'>('all');
  const [kind, setKind] = useState<ChartKind>('bar'), [backend, setBackend] = useState('all');
  const [statistic, setStatistic] = useState<Statistic>('median'), [bins, setBins] = useState(10);
  useEffect(() => {
    let active = true; setLoading(true); setError('');
    fetchPlotData(experiment.key, window).then(data => {if(active) setRows(data.observations);})
      .catch(reason => {if(active) setError(String(reason));}).finally(() => {if(active) setLoading(false);});
    return () => {active = false;};
  }, [experiment.key, window]);
  const backends = [...new Set(rows.flatMap(row => row.backend ? [row.backend] : []))];
  const metrics = metric === 'all' ? Object.keys(METRICS) as Metric[] : [metric];
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="statistics-modal graphs-modal" aria-labelledby={titleId} aria-describedby={undefined} showCloseButton={false}>
    <header className="statistics-modal__header"><div><DialogTitle id={titleId}>Графики по метрикам</DialogTitle><p>{experiment.title}</p></div>
      <Button variant="outline" className="statistics-modal__close" type="button" aria-label="Закрыть графики" onClick={onClose}>×</Button></header>
    <div className="statistics-modal__body">
      <div className="statistics-modal__filters">
        <label>Метрики<select value={metric} onChange={e => setMetric(e.target.value as Metric | 'all')}>
          <option value="all">Все метрики</option>{Object.entries(METRICS).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
        </select></label>
        <label>Вид графика<select aria-label="Вид графика" value={kind} onChange={e => setKind(e.target.value as ChartKind)}>
          <option value="bar">Столбчатый</option><option value="line">Линейный</option><option value="scatter">Точечный</option>
          <option value="histogram">Гистограмма распределения</option><option value="box">Box plot</option>
        </select></label>
        {kind==='bar' && <label>Показатель<select aria-label="Показатель графика" value={statistic} onChange={e => setStatistic(e.target.value as Statistic)}>
          <option value="median">Медиана</option><option value="mean">Среднее</option><option value="p95">p95</option>
        </select></label>}
        {kind==='histogram' && <label>Число интервалов<select aria-label="Число интервалов" value={bins} onChange={e => setBins(Number(e.target.value))}>
          {[5,10,20,30].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>}
        <label>Измерений на вариант<select value={window} onChange={e => setWindow(+e.target.value)}>{[10,30,50,100].map(n => <option key={n}>{n}</option>)}</select></label>
        {backends.length > 0 && <label>Библиотечный бэкенд<select value={backend} onChange={e => setBackend(e.target.value)}><option value="all">Все</option>{backends.map(b => <option key={b} value={b}>{b.toUpperCase()}</option>)}</select></label>}
      </div>
      {loading ? <p role="status">Загружаем измерения…</p> : error ? <p role="alert">{error}</p> :
        metrics.map(value => <MetricChart key={value} experiment={experiment} rows={rows} window={window} metric={value} kind={kind} statistic={statistic} bins={bins} backend={backend} />)}
    </div>
  </DialogContent></Dialog>;
}
