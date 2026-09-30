# database — схема PostgreSQL 16

Скрипты выполняются автоматически при первом создании тома `pgdata`:
`init.sql` создаёт схему, `seed_recommendations.sql` наполняет таблицу
рекомендаций. Повторный `docker compose up` их не трогает — чтобы перезалить,
нужен `docker compose down -v`.

## Таблицы

### `recommendations`

Статичная таблица вкладки «Рекомендации» и основной источник для RAG-бота.

| Колонка          | Тип    | Назначение                                        |
|------------------|--------|---------------------------------------------------|
| `rec_key`        | text   | машинный ключ, по нему бот связывает с измерениями |
| `title`          | text   | название критерия                                  |
| `task_type`      | text   | класс задачи: text, image, backend, cold_start, privacy |
| `tfjs_verdict`   | text   | вердикт по библиотечной парадигме                  |
| `gemini_verdict` | text   | вердикт по встроенной парадигме                    |
| `comment`        | text   | пояснение                                          |
| `sort_order`     | int    | порядок вывода                                     |

Восемь стартовых строк — гипотезы из теоретической части. После прогонов они
уточняются по фактическим числам:

```bash
curl -X PATCH http://localhost:8000/api/recommendations/text_speed \
  -H 'Content-Type: application/json' \
  -d '{"tfjs_verdict": "Медиана инференса 18 мс против 480 мс у встроенной модели"}'
```

### `measurements`

Результаты прогонов. Каждый тип измерения хранится со своим ключом и названием —
так RAG-бот находит нужные строки, не разбирая произвольный текст.

| Колонка           | Тип   | Назначение                                          |
|-------------------|-------|-----------------------------------------------------|
| `experiment_key`  | text  | `text_classification`, `image_classification`, `tfjs_backends` |
| `approach`        | text  | `tensorflow_js` либо `gemini_nano`                  |
| `model_name`      | text  | конкретная модель                                    |
| `settings`        | jsonb | бэкенд, температура, источник весов                  |
| `metrics`         | jsonb | пять метрик в миллисекундах и мегабайтах             |
| `environment`     | jsonb | браузер, ОС, ядра, память, наличие WebGPU            |
| `status`          | text  | `ok`, `error` либо `unsupported`                     |
| `run_index`       | int   | номер серии                                          |

Метрики и настройки лежат в `jsonb`, а не в отдельных колонках, потому что
набор метрик у парадигм разный: для встроенной модели нет понятия бэкенда, для
библиотечной — температуры. Жёсткая схема тут потребовала бы половину колонок
держать пустыми.

Индексы: по паре `(experiment_key, created_at)` для постраничного вывода, по
`approach` для фильтров и GIN по `metrics` — на случай выборок вида «все прогоны
медленнее 500 мс».

### `rag_documents`

Поисковый индекс бота: фрагмент текста плюс его вектор в `jsonb`.
Пара `(source_type, source_key)` уникальна, поэтому переиндексация обновляет
строки, а не плодит дубликаты.

## Ручные запросы

```bash
docker compose exec database psql -U benchmark -d benchmark
```

Медиана латентности по парадигмам:

```sql
SELECT approach,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (metrics->>'inference_ms')::numeric) AS median_ms,
       count(*) AS runs
FROM measurements
WHERE experiment_key = 'text_classification' AND status = 'ok'
GROUP BY approach;
```

Сравнение ускорителей TensorFlow.js:

```sql
SELECT settings->>'backend' AS backend,
       round(avg((metrics->>'inference_ms')::numeric), 2) AS avg_ms,
       count(*) AS runs
FROM measurements
WHERE experiment_key = 'tfjs_backends' AND status = 'ok'
GROUP BY 1 ORDER BY 2;
```
