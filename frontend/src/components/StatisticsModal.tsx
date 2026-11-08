import { useEffect, useId, useState } from 'react';
import { Button } from './ui/button';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Dialog, DialogContent, DialogTitle } from './ui/dialog';
import { fetchExperimentStatistics } from '../api/benchmarkApi';
import type { ExperimentDefinition } from '../benchmark/experiments';
import type { ExperimentStatistics, StatisticsMetric } from '../benchmark/types';
import { SummaryTable, overviewColumns, percentileColumns, spreadColumns, shapeColumns } from './statistics/SummaryTables';
import { PairAnalysis } from './statistics/PairAnalysis';
import { EmpiricalDistribution, Relations } from './statistics/Relations';
import { download, key, METRICS, name, number, pValue } from './statistics/format';
import './StatisticsModal.scss';

export function StatisticsModal({experiment,onClose}:{experiment:ExperimentDefinition;onClose:()=>void}) {
  const titleId=useId();
  const [data,setData]=useState<ExperimentStatistics|null>(null);
  const [error,setError]=useState(''),[loading,setLoading]=useState(true);
  const [window,setWindow]=useState(30),[metric,setMetric]=useState<StatisticsMetric>('inference_ms');
  const [backend,setBackend]=useState('all'),[tab,setTab]=useState('overview');
  useEffect(()=>{
    let active=true;setLoading(true);setError('');
    fetchExperimentStatistics(experiment.key,window).then(result=>{if(active)setData(result);})
      .catch(reason=>{if(active)setError(String(reason));}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;};
  },[experiment.key,window]);
  const groups=(data?.groups??[]).filter(g=>backend==='all'||g.backend===backend||g.backend==null);
  const summaries=groups.flatMap(g=>g.metrics[metric]?[g.metrics[metric]!]:[]);
  const backends=[...new Set((data?.groups??[]).flatMap(g=>g.backend?[g.backend]:[]))];
  const unit=metric==='memory_mb'?'МиБ':'мс';
  const omnibus=data?.omnibus?.find(o=>o.metric===metric);
  const diagnostics=data?.diagnostics??[];
  const csv=()=>{
    const columns=[...overviewColumns,...percentileColumns,...spreadColumns,...shapeColumns];
    const escape=(v:string)=>'"'+(/^[=+@-]/.test(v)?"'"+v:v).replaceAll('"','""')+'"';
    const rows=[['Вариант',...columns.map(c=>c.label)],...groups.map(g=>[name(g),...columns.map(c=>g.metrics[metric]?c.value(g.metrics[metric]!):'-')])];
    download('\ufeff'+rows.map(row=>row.map(escape).join(';')).join('\r\n'),`${experiment.key}_${metric}_statistics.csv`,'text/csv;charset=utf-8');
  };
  return <Dialog open onOpenChange={open=>{if(!open)onClose();}}><DialogContent className="statistics-modal statistics-modal--extended" aria-labelledby={titleId} aria-describedby={undefined} showCloseButton={false}>
    <header className="statistics-modal__header"><div><DialogTitle id={titleId}>Дополнительная статистика</DialogTitle><p>{experiment.title}</p></div><Button variant="ghost" className="statistics-modal__close" aria-label="Закрыть статистику" onClick={onClose}>×</Button></header>
    <div className="statistics-modal__body">
      <div className="statistics-modal__filters">
        <label>Последних измерений на вариант<select aria-label="Размер выборки статистики" value={window} onChange={e=>setWindow(Number(e.target.value))}>{[5,10,30,50,100].map(n=><option key={n}>{n}</option>)}</select></label>
        <label>Метрика<select aria-label="Метрика статистики" value={metric} onChange={e=>setMetric(e.target.value as StatisticsMetric)}>{Object.entries(METRICS).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></label>
        {!!backends.length&&<label>Бэкенд в сводных таблицах<select value={backend} onChange={e=>setBackend(e.target.value)}><option value="all">Все</option>{backends.map(b=><option key={b} value={b}>{b.toUpperCase()}</option>)}</select></label>}
      </div>
      {loading?<p role="status" className="stats-loading">Рассчитываем показатели и связи между метриками…</p>:error?<p role="alert">Не удалось получить статистику: {error}</p>:data?<>
        <div className="stats-kpis"><div><span>Вариантов в сводке</span><strong>{groups.length}</strong></div><div><span>Значений метрики</span><strong>{summaries.reduce((n,s)=>n+s.samples,0)}</strong></div><div><span>Выбросов по 1,5 IQR</span><strong>{summaries.reduce((n,s)=>n+(s.outliers??0),0)}</strong></div><div><span>Единицы измерения</span><strong>{unit}</strong></div></div>
        <Tabs value={tab} onValueChange={setTab} className="stats-tabs">
          <div className="stats-tab-scroll"><TabsList aria-label="Раздел статистики"><TabsTrigger value="overview">Обзор</TabsTrigger><TabsTrigger value="distribution">Распределение</TabsTrigger><TabsTrigger value="pairs">Сравнения</TabsTrigger><TabsTrigger value="heatmaps">Тепловые карты</TabsTrigger><TabsTrigger value="relations">Связи и стабильность</TabsTrigger></TabsList></div>
          <TabsContent value="overview">
            <h3>Основные показатели, {unit}</h3><SummaryTable groups={groups} metric={metric} columns={overviewColumns} label="Показатели статистики"/>
            {omnibus&&<div className="stats-omnibus"><h3>Общее сравнение всех вариантов</h3><dl><div><dt>Краскел-Уоллис H</dt><dd>{number(omnibus.kruskal_h)}</dd></div><div><dt>p с поправкой Холма</dt><dd>{pValue(omnibus.p_value_adjusted)}</dd></div><div><dt>Размер эффекта ε²</dt><dd>{number(omnibus.epsilon_squared)}</dd></div><div><dt>Левен: p с поправкой Холма</dt><dd>{pValue(omnibus.variance_p_adjusted)}</dd></div></dl><p className="statistics-modal__hint">Тест Краскела-Уоллиса проверяет общее различие распределений; значимое p не указывает, какие пары различаются. Учитываются {omnibus.groups} варианта с минимум двумя значениями. Поправка Холма выполнена по доступным метрикам отдельно для каждого общего теста.{omnibus.small_groups?' Есть группы меньше пяти значений: приближённые p следует трактовать осторожно.':''}</p></div>}
            <p className="statistics-modal__hint">Доверительные интервалы среднего и медианы: процентильный bootstrap, 2000 выборок, seed 0. CV - относительный разброс; меньшее значение соответствует более тесной выборке, но не доказывает повторяемость между запусками.</p>
          </TabsContent>
          <TabsContent value="distribution"><h3>Перцентили, {unit}</h3><SummaryTable groups={groups} metric={metric} columns={percentileColumns} label="Перцентили распределения"/>
            <h3>Разброс и устойчивые оценки</h3><SummaryTable groups={groups} metric={metric} columns={spreadColumns} label="Разброс и устойчивые оценки"/>
            <h3>Форма распределения и выбросы</h3><SummaryTable groups={groups} metric={metric} columns={shapeColumns} label="Нормальность и выбросы"/>
            <p className="statistics-modal__hint">MAD - медиана абсолютных отклонений от медианы. Робастная σ = MAD / 0,67449. Усечённое среднее исключает по 10 % значений с каждого края только для своего расчёта. Геометрическое и гармоническое средние доступны при строго положительных значениях. Дисперсия измеряется в {unit}². Для Шапиро-Уилка нужны минимум три непостоянных значения; p ≥ 0,05 не доказывает нормальность. Выбросы за границами Q1 - 1,5 IQR и Q3 + 1,5 IQR сохраняются во всех остальных расчётах.</p>
            <EmpiricalDistribution diagnostics={diagnostics.filter(g=>groups.some(s=>key(s)===key(g)))} metric={metric}/>
          </TabsContent>
          <TabsContent value="pairs"><h3>Все варианты со всеми</h3><PairAnalysis data={data} metric={metric}/></TabsContent>
          <TabsContent value="heatmaps"><h3>Тепловая карта сравнений</h3><PairAnalysis data={data} metric={metric} heatmap/></TabsContent>
          <TabsContent value="relations"><Relations diagnostics={diagnostics} metric={metric}/></TabsContent>
        </Tabs>
        {!summaries.length&&<p>Успешных измерений выбранной метрики пока нет.</p>}
        <div className="stats-footer"><Button variant="outline" size="sm" onClick={csv}>Скачать показатели CSV</Button><Button variant="ghost" size="sm" onClick={()=>download(JSON.stringify({...data,experiment:experiment.key,exported_at:new Date().toISOString()},null,2),`${experiment.key}_statistics.json`)}>Все расчёты JSON</Button></div>
        <details className="stats-methods"><summary>Как интерпретировать результаты</summary><p>Сводки используют успешные отдельные обращения, а не независимые серии. Пропуски не подменяются нулями. '-' означает, что показатель не определён или данных недостаточно. Сравнения и тепловые карты включают все варианты, независимо от фильтра сводных таблиц.</p><p>Манн-Уитни, Уэлч и доверительные интервалы предполагают сопоставимые условия и независимость наблюдений. Автоматическая группировка по модели и бэкенду не подтверждает одинаковые входные данные, настройки и среду. Зависимые повторы могут преувеличивать статистическую значимость. Новые показатели не измеряют правильность ответа модели.</p><p>Перцентили p95 и p99 на маленьких выборках отражают лишь несколько наблюдений и не дают надёжного прогноза редких задержек. Полное время связано со своими слагаемыми по определению; корреляцию нельзя считать доказательством причинности.</p></details>
      </>:null}
    </div>
  </DialogContent></Dialog>;
}
