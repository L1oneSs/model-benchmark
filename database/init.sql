-- Схема стенда. Выполняется один раз при первом создании тома pgdata.
-- Три таблицы: рекомендации (статичная таблица вкладки «Рекомендации»),
-- измерения (результаты экспериментов) и индекс RAG-бота.

CREATE TABLE IF NOT EXISTS recommendations (
    id              SERIAL PRIMARY KEY,
    rec_key         TEXT        NOT NULL UNIQUE,
    title           TEXT        NOT NULL,
    task_type       TEXT        NOT NULL,
    tfjs_verdict    TEXT        NOT NULL,
    gemini_verdict  TEXT        NOT NULL,
    comment         TEXT        NOT NULL DEFAULT '',
    sort_order      INTEGER     NOT NULL DEFAULT 100,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE  recommendations              IS 'Статичная таблица рекомендаций, выводится на вкладке «Рекомендации» и служит основным источником для RAG-бота';
COMMENT ON COLUMN recommendations.rec_key      IS 'Машинный ключ рекомендации, по нему бот связывает рекомендацию с измерениями';
COMMENT ON COLUMN recommendations.task_type    IS 'Класс задачи: text, image, backend, cold_start, privacy';
COMMENT ON COLUMN recommendations.tfjs_verdict IS 'Вердикт по библиотечной парадигме (TensorFlow.js)';

-- Каждый тип измерения хранится со своим ключом и названием: так RAG-бот
-- находит нужные строки без разбора произвольного текста.
CREATE TABLE IF NOT EXISTS measurements (
    id                SERIAL PRIMARY KEY,
    experiment_key    TEXT        NOT NULL,
    experiment_title  TEXT        NOT NULL,
    approach          TEXT        NOT NULL,
    model_name        TEXT        NOT NULL,
    settings          JSONB       NOT NULL DEFAULT '{}'::jsonb,
    metrics           JSONB       NOT NULL DEFAULT '{}'::jsonb,
    environment       JSONB       NOT NULL DEFAULT '{}'::jsonb,
    input_summary     TEXT        NOT NULL DEFAULT '',
    output_summary    TEXT        NOT NULL DEFAULT '',
    status            TEXT        NOT NULL DEFAULT 'ok',
    error_message     TEXT,
    run_index         INTEGER     NOT NULL DEFAULT 1,
    created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT measurements_approach_check
        CHECK (approach IN ('tensorflow_js', 'gemini_nano')),
    CONSTRAINT measurements_status_check
        CHECK (status IN ('ok', 'error', 'unsupported'))
);

COMMENT ON TABLE  measurements                  IS 'Результаты прогонов экспериментов, снятые в браузере';
COMMENT ON COLUMN measurements.experiment_key   IS 'Ключ эксперимента: text_classification, image_classification, tfjs_backends';
COMMENT ON COLUMN measurements.approach         IS 'Парадигма интеграции: tensorflow_js (библиотечная) или gemini_nano (встроенная)';
COMMENT ON COLUMN measurements.settings         IS 'Параметры прогона: бэкенд TF.js, температура, topK, длина входа';
COMMENT ON COLUMN measurements.metrics          IS 'Метрики в миллисекундах и мегабайтах: load_ms, first_token_ms, inference_ms, total_ms, memory_mb';
COMMENT ON COLUMN measurements.environment      IS 'Среда прогона: браузер, версия, ОС, наличие WebGPU, объём памяти устройства';
COMMENT ON COLUMN measurements.status           IS 'ok — прогон удался, error — ошибка, unsupported — подход недоступен в этом браузере';

CREATE INDEX IF NOT EXISTS idx_measurements_key_created
    ON measurements (experiment_key, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_measurements_approach
    ON measurements (approach);
CREATE INDEX IF NOT EXISTS idx_measurements_metrics
    ON measurements USING GIN (metrics);

-- Индекс RAG-бота. Векторы лежат в jsonb: корпус маленький (десятки строк),
-- косинусная близость считается в Python, расширение pgvector не требуется.
CREATE TABLE IF NOT EXISTS rag_documents (
    id           SERIAL PRIMARY KEY,
    source_type  TEXT        NOT NULL,
    source_key   TEXT        NOT NULL,
    content      TEXT        NOT NULL,
    embedding    JSONB       NOT NULL,
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT rag_documents_source_unique UNIQUE (source_type, source_key),
    CONSTRAINT rag_documents_source_type_check
        CHECK (source_type IN ('recommendation', 'measurement_summary'))
);

COMMENT ON TABLE  rag_documents             IS 'Проиндексированные фрагменты для RAG-бота: рекомендации и сводки последних измерений';
COMMENT ON COLUMN rag_documents.embedding   IS 'Вектор эмбеддинга в виде JSON-массива чисел';
