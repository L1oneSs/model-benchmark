# database — PostgreSQL 16

PostgreSQL хранит измерения, рекомендации и историю агента, включая графики. Данные находятся в Docker-томе `pgdata`. Порт 5432 доступен другим сервисам Compose по имени `database`; на ноутбук он по умолчанию не опубликован.

## Создание схемы

При первом создании пустого тома PostgreSQL выполняет `init.sql` и `seed_recommendations.sql`. Первый файл создаёт две основные таблицы, второй добавляет девять исходных рекомендаций. Таблица `rag_chats` создаётся ORM бэкенда при его старте.

Повторный `docker compose up` не запускает эти SQL-файлы заново и не обновляет существующие строки. Изменения существующей схемы/данных применяются отдельными SQL-командами. Удаление тома и новый запуск полностью пересоздают БД, но уничтожают сохранённые результаты и чаты.

Все стартовые рекомендации ONNX находятся в `seed_recommendations.sql`. При повторном выполнении он добавляет колонку `onnx_verdict`, если её нет, и заполняет только пустые ячейки ONNX. Непустые вердикты и остальные поля существующих рекомендаций сохраняются. Backend больше не заполняет рекомендации при старте.

## Таблицы

### `recommendations`

Статичная таблица интерфейса и источник агента. Поля: `id`, уникальный `rec_key`, `title`, `task_type`, `tfjs_verdict`, `gemini_verdict`, `comment`, `sort_order`, `created_at`, `updated_at`.

Вердикты — начальные гипотезы, а не автоматически рассчитанные результаты. Их можно изменить через PATCH API или SQL. Инструмент агента читает актуальные строки; после PATCH переиндексация для чата не требуется.

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

Очистить прогоны и историю, сохранив рекомендации (после запуска бэкенда, создавшего `rag_chats`):

```sql
TRUNCATE measurements, rag_chats RESTART IDENTITY;
```

Чтобы очистить также рекомендации, включите таблицу `recommendations` в TRUNCATE; seed автоматически повторно не выполняется.

`docker compose down -v` удаляет **оба** тома стенда: не только БД, но и веса Ollama. `docker compose down` останавливает сервисы с сохранением данных.

Чат агента читает `recommendations` и `measurements` напрямую, рассчитывая статистику кодом. Старая таблица `rag_documents` может оставаться в существующей БД, но приложение её больше не использует; новая установка её не создаёт. История по-прежнему хранится в `rag_chats`.
