# Проверки стенда

Все `check-*`-скрипты проекта собраны здесь. Unit-тесты бэкенда остаются в `backend/tests/`, диагностический `scripts/probe-agent-format.py` — в `scripts/`.

Команды ниже выполняются **из корня проекта**. JavaScript-чекеры импортируют Vite/Transformers.js из `frontend/node_modules`; сначала установите зависимости:

```sh
cd frontend
npm install --legacy-peer-deps
cd ..
```

## Локальные проверки адаптеров

```sh
node checks/check-agent-client.mjs
node checks/check-object-detection.mjs
node checks/check-face-counting.mjs
node checks/check-moderation.mjs
node checks/check-text-generation.mjs
```

Они проверяют обработку событий/истории RAG, разбор ответов, форматирование результатов и настройки адаптеров с подставными API. Запущенные контейнеры и загрузка нейросетевых весов для этих пяти проверок не нужны. Успех таких проверок сам по себе не доказывает качество настоящего нейросетевого ответа.

## Проверка локальных моделей TensorFlow.js

`check-tfjs-local.mjs` запускает настоящие шесть TF.js моделей и блокирует внешние
HTTP-запросы через DevTools. Проверяет успешный инференс, `model_source=local`,
загрузку всех моделей и обоих словарей с самого стенда.

Сначала скачайте веса: `python scripts/fetch-models.py`. Запустите Vite на
`http://127.0.0.1:5174` с `VITE_MODEL_SOURCE=local` и отдельный headless Chrome
с `--remote-debugging-port=9334` и отдельной папкой профиля. Затем:

```sh
node checks/check-tfjs-local.mjs
```

Проверка закрывает только подключённый тестовый браузер. Статистику в БД не записывает.

## Реальная генерация ONNX

```sh
node checks/check-text-generation.mjs --live
```

Загружает SmolLM2 360M Instruct q8 (около 365 МБ весов) в `artifacts/generation-model-cache/`, использует ONNX Runtime Node на CPU с двумя потоками, проверяет непустые ответы и отсутствие повторяющейся петли, включая инструкцию эксперимента по умолчанию. Этот режим не проверяет браузерный WASM или достоверность всех утверждений модели. Нужна сеть при первой загрузке; кеш исключён из Git.

## Проверка интерфейса

```sh
node checks/check-ui.mjs
```

Требует отдельный headless Chrome с портом отладки `9333`. Скрипт подключается к его DevTools, использует тестовую историю без настоящей генерации, проверяет графики, снимает скриншоты в `artifacts/` и закрывает этот браузер после проверки.

По умолчанию проверяется **http://localhost:18080**. Для другого адреса задайте `UI_URL`; проверка не читает `.env` автоматически.

## Реальный агент в Docker

`check-agent-stream.py` и `check-agent-table.py` используют `httpx` и обращаются к **http://localhost:8000 внутри backend-контейнера**. С ноутбука тот же API сейчас доступен на **http://localhost:18000**. Эти адреса не противоречат друг другу: Docker публикует внутренний 8000 на внешний 18000.

Скрипты не включены в backend-образ. Их можно передать через stdin, не копируя в контейнер. Bash:

```sh
docker compose exec -T backend python - < checks/check-agent-stream.py
docker compose exec -T backend python - < checks/check-agent-table.py
```

PowerShell (передавайте UTF-8, чтобы сохранить русский вопрос):

```powershell
$OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Get-Content -Raw -Encoding utf8 checks/check-agent-stream.py | docker compose exec -T backend python -
Get-Content -Raw -Encoding utf8 checks/check-agent-table.py | docker compose exec -T backend python -
```

Потребуются работающие БД, backend и скачанные модели Ollama. Проверки отправляют реальные запросы. Проверка таблицы удаляет свой тестовый чат в `finally`; проверка потока оставляет завершённый тестовый диалог в БД.

Unit-тесты API/сервисов выполняются отдельно, из `backend` с установленными зависимостями:

```sh
python -m unittest discover -s tests
```

## Проверка агента

`check-agent.py` отправляет реальные запросы в локальную Ollama через API: проверяет выбор источников таблицы, статистику, сравнение серий и сохранение истории. Нужны записанные серии `text_generation` (минимум две). Использует отдельный UUID и удаляет только свой тестовый чат в `finally`.

```sh
docker compose run --rm --no-deps -e AGENT_API_URL=http://backend:8000 -v ./checks:/checks:ro backend python /checks/check-agent.py
docker compose run --rm --no-deps -v ./backend/tests:/srv/tests:ro backend python -m unittest discover -s tests
```

Модульные проверки `test_agent*.py` покрывают ограничения инструментов, SQL, медианы, сравнение серий, графики, выбор инструмента, поток ответа, историю и совместимость API. Все чекеры используют основной `/api/agent/*` API. `check-agent.py` проверяет рекомендации, статистику, сравнение серий и график; `AGENT_CHECK_TOOLS` ограничивает сценарии, например `build_chart,calculate_statistics`.

`check-agent-all-metrics.py` проверяет реальный запрос графиков по всем метрикам
эксперимента определения языка. Он требует записанных измерений, проверяет
графики/явно отсутствующие метрики и сохранение в истории, затем очищает свой чат:

```sh
docker compose run --rm --no-deps -e AGENT_API_URL=http://backend:8000 -v ./checks:/checks:ro backend python /checks/check-agent-all-metrics.py
```

`check-agent-mixed.py` проверяет запрос рекомендации на основе таблицы и последних
измерений: обязательны оба источника и статистика `text_classification`. Скрипт
запускается аналогично и очищает только свой тестовый чат.

`test_agent_reports.py` проверяет точный вывод числовых результатов: направление изменения латентности, номера серий, фактическое число samples, выбор метрики и поток отчёта без повторной генерации чисел моделью. Для выборочной проверки API задайте `AGENT_CHECK_TOOLS=calculate_statistics,compare_series` или одно имя инструмента.
### Проверка форматов графиков

`check-agent-explanation.py` проверяет вопрос о формуле через реальное API:
восстановление ID выборки из истории, исходные значения и рассчитанную медиану.
Использует отдельный временный чат и очищает только его после проверки.
Запуск: `docker compose run --rm --no-deps -v ./checks:/checks:ro backend python /checks/check-agent-explanation.py`.

`check-agent-renderers.py` проверяет три формата на сохранённых измерениях без
обращения к Ollama и изменения чатов. Создаёт тестовые файлы в игнорируемой
папке `artifacts/agent-charts` и проверяет доступность PNG/HTML через API.
Запуск: `docker compose run --rm --no-deps -v ./checks:/checks:ro backend python /checks/check-agent-renderers.py`.
Для браузерной проверки передай `CHART_FIXTURE_FILE=artifacts/agent-charts/ui-fixture.json`
при запуске `check-ui.mjs` с отдельным headless Chrome на порте 9333.
