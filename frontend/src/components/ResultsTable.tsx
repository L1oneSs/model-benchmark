import { useCallback, useEffect, useState } from 'react';

import { csvExportUrl, fetchMeasurements, fetchSummary } from '../api/benchmarkApi';
import { approachBadgeClass, approachLabel, DEFAULT_RESULT_COLUMNS, type ExperimentDefinition, type ResultColumn } from '../benchmark/experiments';
import { formatMb, formatMs } from '../benchmark/metrics';
import {
  type Approach,
  type ApproachSummary,
  type Measurement,
} from '../benchmark/types';
import './ResultsTable.scss';

const PAGE_SIZE = 5;
type SortBy = 'inference_ms' | 'first_token_ms' | 'memory_mb' | 'created_at';
type SortState = { by: SortBy; order: 'asc' | 'desc' } | null;
const ALL_BACKENDS = ['webgpu', 'webgl', 'wasm', 'cpu'];
const COLUMN_LABELS: Record<ResultColumn, string> = {
  approach: 'Парадигма', settings: 'Настройки', inference_ms: 'Инференс',
  first_token_ms: 'Первое предсказание', memory_mb: 'Память', output: 'Результат', created_at: 'Время',
};
const SORT_COLUMNS = new Set<ResultColumn>(['inference_ms', 'first_token_ms', 'memory_mb', 'created_at']);

interface Props {
  experiment: ExperimentDefinition;
  reloadToken: number;
}

/** Блок измерений по одному эксперименту: сводка по парадигмам сверху,
 *  постраничный список последних прогонов снизу. */
export function ResultsTable({ experiment, reloadToken }: Props) {
  const columns = experiment.resultColumns ?? DEFAULT_RESULT_COLUMNS;
  const [summary, setSummary] = useState<Record<string, ApproachSummary | null> | null>(null);
  const [rows, setRows] = useState<Measurement[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [approachFilter, setApproachFilter] = useState<Approach | ''>('');
  const [backendFilter, setBackendFilter] = useState('');
  const [sortState, setSortState] = useState<SortState>(null);

  const load = useCallback(async () => {
    try {
      setError(null);
      const [summaryData, pageData] = await Promise.all([
        experiment.summaryByBackend
          ? Promise.all(ALL_BACKENDS.map(async backend => {
              const data = await fetchSummary(experiment.key, 10, backend);
              return [backend, data.tensorflow_js] as const;
            })).then(entries => Object.fromEntries(entries))
          : fetchSummary(experiment.key, 10),
        fetchMeasurements({
          experimentKey: experiment.key,
          approach: approachFilter || undefined,
          backend: approachFilter === 'gemini_nano' ? undefined : backendFilter || undefined,
          sortBy: sortState?.by,
          sortOrder: sortState?.order,
          limit: PAGE_SIZE,
          offset: page * PAGE_SIZE,
        }),
      ]);
      setSummary(summaryData);
      setRows(pageData.items);
      setTotal(pageData.total);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
    }
  }, [experiment.key, experiment.summaryByBackend, page, approachFilter, backendFilter, sortState]);

  useEffect(() => {
    void load();
  }, [load, reloadToken]);

  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const changeFilter = (setter: (value: string) => void, value: string) => {
    setPage(0);
    setter(value);
  };

  const changeSort = (column: SortBy) => {
    setPage(0);
    setSortState((current) => {
      if (!current || current.by !== column) return { by: column, order: 'asc' };
      if (current.order === 'asc') return { by: column, order: 'desc' };
      return null;
    });
  };

  const sortLabel = (column: SortBy) =>
    sortState?.by === column ? (sortState.order === 'asc' ? ' ↑' : ' ↓') : '';
  const pagerItems = buildPager(page, pages);

  return (
    <section className="results">
      <header className="results__header">
        <h3>{experiment.title}</h3>
        <a className="results__export" href={csvExportUrl(experiment.key)}>Выгрузить CSV</a>
      </header>

      {error && <p className="results__error">Не удалось получить измерения: {error}</p>}

      <div className="results__filters">
        <label>
          Парадигма
          <select
            value={approachFilter}
            onChange={(event) => {
              setPage(0);
              setApproachFilter(event.target.value as Approach | '');
              if (event.target.value === 'gemini_nano') setBackendFilter('');
            }}
          >
            <option value="">Все</option>
            {experiment.approaches.map(approach => <option key={approach} value={approach}>{approachLabel(experiment, approach)}</option>)}
          </select>
        </label>
        {approachFilter !== 'gemini_nano' && experiment.approaches.includes('tensorflow_js') && experiment.usesTensorFlowBackends !== false && <label>
          Бэкенд
          <select value={backendFilter} onChange={(event) => changeFilter(setBackendFilter, event.target.value)}>
            <option value="">Все</option>
            {ALL_BACKENDS.map((backend) => <option key={backend} value={backend}>{backend}</option>)}
          </select>
        </label>}
      </div>

      {experiment.showSummary !== false && <div className="results__summary">
        {(experiment.summaryByBackend ? ALL_BACKENDS.filter(backend => !backendFilter || backend === backendFilter) : experiment.approaches).map((key) => {
          const approach = experiment.summaryByBackend ? 'tensorflow_js' : key as Approach;
          const data = summary?.[key] ?? null;
          return (
            <div key={key} className="results__card">
              <div className={`results__card-title badge badge--${approachBadgeClass(experiment, approach)}`}>
                {approachLabel(experiment, approach)}{experiment.summaryByBackend ? ` · ${key.toUpperCase()}` : ''}
              </div>
              {data ? (
                <>
                  <p className="results__model">{data.model_name}</p>
                  <dl className="results__metrics">
                    <Metric label="Латентность инференса, медиана" value={formatMs(data.inference_ms?.median)} />
                    {experiment.summaryByBackend && <Metric label="Удачных прогонов в сводке" value={String(data.inference_ms?.samples ?? 0)} />}
                    {!experiment.summaryByBackend && <>
                    <Metric label="До первого предсказания, медиана" value={formatMs(data.first_token_ms?.median)} />
                    <Metric label="Загрузка модели, медиана" value={formatMs(data.load_ms?.median)} />
                    <Metric label="Память, медиана" value={formatMb(data.memory_mb?.median)} />
                    <Metric
                      label="Разброс инференса"
                      value={
                        data.inference_ms
                          ? `± ${formatMs(data.inference_ms.stdev)} (${data.inference_ms.samples} прогонов)`
                          : '—'
                      }
                    />
                    </>}
                  </dl>
                </>
              ) : (
                <p className="results__empty">Измерений пока нет</p>
              )}
            </div>
          );
        })}
      </div>}

      <div className="table-scroll" tabIndex={0} role="region" aria-label={`Прогоны: ${experiment.title}`}>
      <table className="results__table">
        <colgroup>
          {columns.map(column => (
            <col key={column} className={`results__col results__col--${column}`} />
          ))}
        </colgroup>
        <caption className="results__caption">
          Последние прогоны, страница {page + 1} из {pages}
        </caption>
        <thead>
          <tr>
            {columns.map(column => <th scope="col" key={column}>
              {SORT_COLUMNS.has(column)
                ? <SortButton label={COLUMN_LABELS[column]} suffix={sortLabel(column as SortBy)} onClick={() => changeSort(column as SortBy)} />
                : COLUMN_LABELS[column]}
            </th>)}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 && (
            <tr>
              <td colSpan={columns.length} className="results__empty-cell">
                Здесь появятся прогоны после запуска эксперимента
              </td>
            </tr>
          )}
          {rows.map((row) => (
            <tr key={row.id} className={row.status !== 'ok' ? 'results__row--muted' : undefined}>
              {columns.map(column => <td key={column} className={column === 'settings' ? 'mono' : column === 'created_at' ? 'results__time' : undefined}>
                <ResultCell column={column} row={row} experiment={experiment} />
              </td>)}
            </tr>
          ))}
        </tbody>
      </table>
      </div>

      <div className="results__pager">
        <button
          type="button"
          className="results__page results__page--wide"
          onClick={() => setPage((value) => Math.max(0, value - 1))}
          disabled={page === 0}
        >
          Назад
        </button>
        {pagerItems.map((item, index) => (
          item === 'ellipsis'
            ? <span key={`ellipsis-${index}`} className="results__ellipsis">…</span>
            : (
            <button
              key={item}
              type="button"
              className={`results__page${item === page ? ' results__page--active' : ''}`}
              onClick={() => setPage(item)}
            >
              {item + 1}
            </button>
            )
        ))}
        <button
          type="button"
          className="results__page results__page--wide"
          onClick={() => setPage((value) => Math.min(pages - 1, value + 1))}
          disabled={page >= pages - 1}
        >
          Вперёд
        </button>
        <span className="results__total">всего прогонов: {total}</span>
      </div>
    </section>
  );
}

function buildPager(current: number, pages: number): Array<number | 'ellipsis'> {
  if (pages <= 7) return Array.from({ length: pages }, (_, index) => index);

  const items = new Set<number>([0, pages - 1]);
  for (let index = Math.max(1, current - 1); index <= Math.min(pages - 2, current + 1); index += 1) {
    items.add(index);
  }

  const sorted = [...items].sort((left, right) => left - right);
  return sorted.flatMap((item, index) => {
    const previous = sorted[index - 1];
    return index > 0 && item - previous > 1 ? ['ellipsis' as const, item] : [item];
  });
}

function ResultCell({ column, row, experiment }: { column: ResultColumn; row: Measurement; experiment: ExperimentDefinition }) {
  switch (column) {
    case 'approach': return <span className={`badge badge--${approachBadgeClass(experiment, row.approach)}`}>{approachLabel(experiment, row.approach)}</span>;
    case 'settings': return <>{describeSettings(row)}</>;
    case 'inference_ms': return row.status === 'ok' ? <>{formatMs(row.metrics.inference_ms)}</> : <StatusCell row={row} />;
    case 'first_token_ms': return <>{formatMs(row.metrics.first_token_ms)}</>;
    case 'memory_mb': return <>{formatMb(row.metrics.memory_mb)}</>;
    case 'output': return row.status === 'ok' ? <>{row.output_summary}</> : <StatusCell row={row} />;
    case 'created_at': return <>{new Date(row.created_at).toLocaleString('ru-RU')}</>;
  }
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{value}</dd>
    </>
  );
}

function SortButton({ label, suffix, onClick }: { label: string; suffix: string; onClick: () => void }) {
  return (
    <button type="button" className="results__sort" onClick={onClick}>
      {label}{suffix}
    </button>
  );
}

function StatusCell({ row }: { row: Measurement }) {
  const modifier = row.status === 'unsupported' ? 'warn' : 'error';
  return (
    <span>
      <span className={`badge badge--${modifier}`}>
        {row.status === 'unsupported' ? 'не поддерживается' : 'ошибка'}
      </span>{' '}
      <span className="results__error-text">{row.error_message}</span>
    </span>
  );
}

function describeSettings(row: Measurement): string {
  const entries = Object.entries(row.settings ?? {});
  if (entries.length === 0) return '—';
  return entries.map(([key, value]) => `${key}=${String(value)}`).join(' ');
}
