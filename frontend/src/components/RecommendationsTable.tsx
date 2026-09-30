import { useEffect, useState } from 'react';

import { fetchRecommendations } from '../api/benchmarkApi';
import type { Recommendation } from '../benchmark/types';
import './RecommendationsTable.scss';
import { Icon } from './Icon';

/** Статичная таблица рекомендаций. Содержимое живёт в базе и правится
 *  через PATCH /api/recommendations/{rec_key} по итогам прогонов, поэтому
 *  интерфейс всегда показывает актуальные вердикты. */
export function RecommendationsTable() {
  const [rows, setRows] = useState<Recommendation[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const filtered = rows.filter(row => [row.title, row.tfjs_verdict, row.gemini_verdict, row.comment].join(' ').toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

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
        <div><span className="badge badge--gemini">Встроенная парадигма</span><h3>Gemini Nano</h3><p>Работа с моделью через встроенные API браузера.</p></div>
      </div>
      <label className="recommendations-search"><Icon name="search" /><input aria-label="Поиск по рекомендациям" placeholder="Найти задачу, возможность или ограничение…" value={search} onChange={event => setSearch(event.target.value)} /><span>{filtered.length}/{rows.length}</span></label>
      <div className="table-scroll" tabIndex={0} role="region" aria-label="Сравнение подходов">
    <table className="recommendations">
      <caption>Рекомендации по выбору технологии</caption>
      <thead>
        <tr>
          <th scope="col" className="recommendations__num">№</th>
          <th scope="col">Критерий</th>
          <th scope="col">TensorFlow.js</th>
          <th scope="col">Gemini Nano</th>
          <th scope="col">Комментарий</th>
        </tr>
      </thead>
      <tbody>
        {filtered.map((row, index) => (
          <tr key={row.rec_key}>
            <td className="recommendations__num">{index + 1}</td>
            <th scope="row">{row.title}</th>
            <td>{row.tfjs_verdict}</td>
            <td>{row.gemini_verdict}</td>
            <td className="recommendations__comment">{row.comment}</td>
          </tr>
        ))}
        {filtered.length === 0 && (
          <tr>
            <td colSpan={5} className="recommendations__empty">{loading ? 'Загружаю рекомендации…' : rows.length ? 'По этому запросу ничего не найдено' : 'Рекомендаций пока нет'}</td>
          </tr>
        )}
      </tbody>
    </table>
      </div>
    </section>
  );
}
