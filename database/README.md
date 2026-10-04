# database — PostgreSQL 16

PostgreSQL хранит измерения, рекомендации, поисковый индекс и историю RAG. Данные находятся в Docker-томе `pgdata`. Порт 5432 доступен другим сервисам Compose по имени `database`; на ноутбук он по умолчанию не опубликован.

## Создание схемы

При первом создании пустого тома PostgreSQL выполняет `init.sql` и `seed_recommendations.sql`. Первый файл создаёт три основные таблицы, второй добавляет девять исходных рекомендаций. Таблица `rag_chats` создаётся ORM бэкенда при его старте.

Повторный `docker compose up` не запускает эти SQL-файлы заново и не обновляет существующие строки. Изменения существующей схемы/данных применяются отдельными SQL-командами. Удаление тома и новый запуск полностью пересоздают БД, но уничтожают сохранённые результаты и чаты.

## Таблицы

### `recommendations`

Статичная таблица интерфейса и источник RAG. Поля: `id`, уникальный `rec_key`, `title`, `task_type`, `tfjs_verdict`, `gemini_verdict`, `comment`, `sort_order`, `created_at`, `updated_at`.

Вердикты — начальные гипотезы, а не автоматически рассчитанные результаты. Их можно изменить через PATCH API или SQL. Прямые вопросы RAG о таблице читают актуальные строки. Для обновления векторного представления после PATCH вызовите ручную переиндексацию.

Пример с текущим внешним портом API:

```sh
curl -X PATCH http://localhost:18000/api/recommendations/text_speed \
  -H 'Content-Type: application/json' \
  -d '{"comment":"Сравнить с текущими измерениями text_classification"}'
```

### `measurements`

Каждая строка — сохранённый прогон либо диагностика встроенного API.

| Поле | Значение |
|---|---|
| `experiment_key`, `experiment_title` | Ключ и название эксперимента; список не ограничен тремя исходными задачами |
| `approach` | `tensorflow_js` или `gemini_nano` |
| `model_name` | Фактическая модель / API |
| `settings` | JSONB: бэкенд, модель, параметры генерации, направление перевода и другие настройки |
| `metrics` | JSONB: `load_ms`, `first_token_ms`, `inference_ms`, `total_ms`, `memory_mb`; некоторые значения могут отсутствовать |
| `environment` | JSONB: браузер, устройство, GPU, WebGPU, видимость вкладки |
| `input_summary`, `output_summary` | Краткое описание входа и результата |
| `status`, `error_message` | `ok`, `error`, `unsupported` и причина ошибки/недоступности |
| `run_index` | Номер сохранённой серии для эксперимента |
| `id`, `created_at` | Идентификатор и время записи |

ONNX тоже хранится как `approach = 'tensorflow_js'`: это общий библиотечный ключ. Интерфейс переименовывает его в ONNX по конфигурации эксперимента; модели различаются по `model_name` и `settings`. Translator/LanguageDetector хранятся как `gemini_nano`, обозначающий встроенную парадигму.

Ограничения проверяют значения `approach` и `status`. Индексы: `(experiment_key, created_at DESC)`, `approach`, GIN по `metrics`. Сводки API выбирают последние успешные строки по подходу и опциональному бэкенду, а не по номеру серии или версии модели.

### `rag_documents`

Поля: `id`, `source_type`, `source_key`, `content`, `embedding` (JSONB), `updated_at`. Тип источника — `recommendation` или `measurement_summary`; пара `(source_type, source_key)` уникальна.

Переиндексация обновляет изменённые документы и добавляет новые. Источники — все рекомендации и окно последних измерений. Старые документы автоматически не удаляются. Косинусная близость считается numpy в бэкенде, расширение pgvector не используется.

### `rag_chats`

Создаётся бэкендом, а не `init.sql`. Поля: `id` (UUID клиента как строка), `turns` (JSONB-массив пар вопрос/ответ с thinking и источниками), `pending`, `pending_at` (маркер и время текущего запроса).

Лимит в коде истории — 30 завершённых пар. Короткие блокировки строки защищают конкурентные изменения. Удаление истории аннулирует маркер выполняющегося запроса. Данные чата сохраняются при перезапуске контейнера.

## Работа с БД

```sh
docker compose exec database psql -U benchmark -d benchmark
```

Если в `.env` изменены `POSTGRES_USER`/`POSTGRES_DB`, подставьте свои значения.

Медиана инференса:

```sql
SELECT approach,
       percentile_cont(0.5) WITHIN GROUP (ORDER BY (metrics->>'inference_ms')::numeric) AS median_ms,
       count(*) AS runs
FROM measurements
WHERE experiment_key = 'text_classification' AND status = 'ok'
GROUP BY approach;
```

Очистить прогоны, индекс и историю, сохранив рекомендации (после запуска бэкенда, создавшего `rag_chats`):

```sql
TRUNCATE measurements, rag_documents, rag_chats RESTART IDENTITY;
```

После этого индекс можно восстановить через `POST /api/rag/reindex`. Чтобы очистить также рекомендации, включите таблицу `recommendations` в TRUNCATE; seed автоматически повторно не выполняется.

`docker compose down -v` удаляет **оба** тома стенда: не только БД, но и веса Ollama. `docker compose down` останавливает сервисы с сохранением данных.
