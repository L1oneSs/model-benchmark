import { useEffect, useState } from 'react';

import { fetchRecommendations } from '../api/benchmarkApi';
import type { Recommendation } from '../benchmark/types';
import './RecommendationsTable.scss';
import { Icon } from './Icon';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { flexRender, getCoreRowModel, getSortedRowModel, useReactTable, type ColumnDef, type SortingState } from '@tanstack/react-table';

const columns: ColumnDef<Recommendation>[] = [
  {accessorKey:'title',header:'Критерий'},
  {accessorKey:'tfjs_verdict',header:'TensorFlow.js'},
  {accessorKey:'onnx_verdict',header:'ONNX',cell:info=>String(info.getValue()||'Рекомендация пока не заполнена')},
  {accessorKey:'gemini_verdict',header:'Gemini Nano'},
  {accessorKey:'comment',header:'Комментарий'},
];

/** Статичная таблица рекомендаций. Содержимое живёт в базе и правится
 *  через PATCH /api/recommendations/{rec_key} по итогам прогонов, поэтому
 *  интерфейс всегда показывает актуальные вердикты. */
export function RecommendationsTable() {
  const [rows, setRows] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [sorting,setSorting]=useState<SortingState>([]);
  const filtered = rows.filter(row => [row.title, row.tfjs_verdict, row.onnx_verdict, row.gemini_verdict, row.comment].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const table=useReactTable({data:filtered,columns,state:{sorting},onSortingChange:setSorting,getCoreRowModel:getCoreRowModel(),getSortedRowModel:getSortedRowModel()});

  useEffect(() => {
    fetchRecommendations()
      .then(setRows)
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : String(caught)))
      .finally(() => setLoading(false));
  }, []);

  if (error) {
    return <p className="recommendations__error">Не удалось загрузить рекомендации: {error}</p>;
  }

  return (
    <section className="recommendations-wrap">
      <div className="recommendations-intro">
        <div><span className="section-eyebrow">Гид по выбору</span><h2>Какая технология подходит задаче?</h2><p>Возможности, ограничения и условия применения двух подходов.</p></div>
        <span className="recommendations-count">{loading ? 'Загрузка…' : `${rows.length} критериев`}</span>
      </div>
      <div className="recommendations-approaches">
        <div><span className="badge badge--tfjs">Библиотечная парадигма</span><h3>TensorFlow.js</h3><p>Выбор модели и управление бэкендом исполнения.</p></div>
        <div><span className="badge badge--onnx">Библиотечная парадигма</span><h3>ONNX</h3><p>ONNX Runtime Web через Transformers.js.</p></div>
        <div><span className="badge badge--gemini">Встроенная парадигма</span><h3>Gemini Nano</h3><p>Работа с моделью через встроенные API браузера.</p></div>
      </div>
      <label className="recommendations-search"><Icon name="search" /><Input aria-label="Поиск по рекомендациям" placeholder="Найти задачу, возможность или ограничение…" value={search} onChange={event => setSearch(event.target.value)} /><span>{filtered.length}/{rows.length}</span></label>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Сравнение подходов">
    <table className="recommendations">
      <caption>Рекомендации по выбору технологии</caption>
      <thead>
        <tr>
          <th scope="col" className="recommendations__num">№</th>
          {table.getHeaderGroups()[0].headers.map(header=><th key={header.id} scope="col" aria-sort={header.column.getIsSorted()==='asc'?'ascending':header.column.getIsSorted()==='desc'?'descending':'none'}><Button variant="ghost" size="sm" onClick={header.column.getToggleSortingHandler()} aria-label={`Сортировать: ${header.column.columnDef.header}`}>{flexRender(header.column.columnDef.header,header.getContext())}{header.column.getIsSorted()==='asc'?' ↑':header.column.getIsSorted()==='desc'?' ↓':' ↕'}</Button></th>)}
        </tr>
      </thead>
      <tbody>
        {table.getRowModel().rows.map((row, index) => (
          <tr key={row.original.rec_key}>
            <td className="recommendations__num">{index + 1}</td>
            {row.getVisibleCells().map((cell,i)=>i===0?<th key={cell.id} scope="row">{flexRender(cell.column.columnDef.cell,cell.getContext())}</th>:<td key={cell.id} className={cell.column.id==='comment'?'recommendations__comment':undefined}>{flexRender(cell.column.columnDef.cell,cell.getContext())}</td>)}
          </tr>
        ))}
        {filtered.length === 0 && (
          <tr>
            <td colSpan={6} className="recommendations__empty">{loading ? 'Загружаю рекомендации…' : rows.length ? 'По этому запросу ничего не найдено' : 'Рекомендаций пока нет'}</td>
          </tr>
        )}
      </tbody>
    </table>
      </div>
    </section>
  );
}
