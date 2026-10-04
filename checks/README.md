# Проверки стенда

Все проверочные скрипты находятся в этой папке. Для JavaScript-проверок нужны установленные зависимости из `frontend/package.json`.

Запуск из корня проекта:

```sh
node checks/check-rag.mjs
node checks/check-object-detection.mjs
node checks/check-face-counting.mjs
node checks/check-moderation.mjs
node checks/check-text-generation.mjs
```

Реальная генерация с загрузкой весов и двумя вычислительными потоками:

```sh
node checks/check-text-generation.mjs --live
```

`check-ui.mjs` требует запущенный стенд на `http://localhost:8080` и отдельный Chrome с портом отладки `9333`. Снимки сохраняются в `artifacts/` при запуске из корня проекта.

`check-rag-stream.py` и `check-rag-table.py` выполняются внутри контейнера бэкенда, где установлен `httpx` и API доступен на `http://localhost:8000`. Они отправляют реальные запросы к RAG-боту; проверка таблицы удаляет созданный тестовый чат после выполнения.
