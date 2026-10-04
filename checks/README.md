# Проверки стенда

Все `check-*`-скрипты проекта собраны здесь. Unit-тесты бэкенда остаются в `backend/tests/`, диагностический `scripts/probe-rag-format.py` — в `scripts/`.

Команды ниже выполняются **из корня проекта**. JavaScript-чекеры импортируют Vite/Transformers.js из `frontend/node_modules`; сначала установите зависимости:

```sh
cd frontend
npm install --legacy-peer-deps
cd ..
```

## Локальные проверки адаптеров

```sh
node checks/check-rag.mjs
node checks/check-object-detection.mjs
node checks/check-face-counting.mjs
node checks/check-moderation.mjs
node checks/check-text-generation.mjs
```

Они проверяют обработку событий/истории RAG, разбор ответов, форматирование результатов и настройки адаптеров с подставными API. Запущенные контейнеры и загрузка нейросетевых весов для этих пяти проверок не нужны. Успех таких проверок сам по себе не доказывает качество настоящего нейросетевого ответа.

## Реальная генерация ONNX

```sh
node checks/check-text-generation.mjs --live
```

Загружает SmolLM2 360M Instruct q8 (около 365 МБ весов) в `artifacts/generation-model-cache/`, использует ONNX Runtime Node на CPU с двумя потоками, проверяет непустые ответы и отсутствие повторяющейся петли, включая инструкцию эксперимента по умолчанию. Этот режим не проверяет браузерный WASM или достоверность всех утверждений модели. Нужна сеть при первой загрузке; кеш исключён из Git.

## Проверка интерфейса

```sh
node checks/check-ui.mjs
```

Требует отдельный headless Chrome с портом отладки `9333`. Скрипт подключается к его DevTools, использует тестовую историю без настоящего RAG-инференса, снимает скриншоты в `artifacts/` и закрывает этот браузер после проверки.

В скрипте адрес приложения пока зафиксирован как **http://localhost:8080**. Текущая конфигурация стенда использует **http://localhost:18080**: перед запуском этой проверки измените URL в `Page.navigate` под фактический `FRONTEND_PORT` либо запустите фронтенд на 8080. Эта проверка не читает `.env` автоматически.

## Реальный RAG в Docker

`check-rag-stream.py` и `check-rag-table.py` используют `httpx` и обращаются к **http://localhost:8000 внутри backend-контейнера**. С ноутбука тот же API сейчас доступен на **http://localhost:18000**. Эти адреса не противоречат друг другу: Docker публикует внутренний 8000 на внешний 18000.

Скрипты не включены в backend-образ. Их можно передать через stdin, не копируя в контейнер. Bash:

```sh
docker compose exec -T backend python - < checks/check-rag-stream.py
docker compose exec -T backend python - < checks/check-rag-table.py
```

PowerShell (передавайте UTF-8, чтобы сохранить русский вопрос):

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content -Raw -Encoding utf8 checks/check-rag-stream.py | docker compose exec -T backend python -
Get-Content -Raw -Encoding utf8 checks/check-rag-table.py | docker compose exec -T backend python -
```

Потребуются работающие БД, backend и скачанные модели Ollama. Проверки отправляют реальные запросы. Проверка таблицы удаляет свой тестовый чат в `finally`; проверка потока оставляет завершённый тестовый диалог в БД.

Unit-тесты API/сервисов выполняются отдельно, из `backend` с установленными зависимостями:

```sh
python -m unittest discover -s tests
```
