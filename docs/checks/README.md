# Проверки стенда

В `checks/` находятся 16 скриптов проверок. Модульные тесты backend хранятся в `backend/tests/`, запуск и анализ эксперимента по тональности - в `scripts/experiments/`.

Все команды выполняются из корня проекта. Для JavaScript-проверок нужны Node.js 22 или новее и зависимости frontend:

```sh
cd frontend
npm ci --legacy-peer-deps
cd ..
```

## Быстрые проверки без контейнеров и моделей

```sh
node checks/check-agent-client.mjs
node checks/check-object-detection.mjs
node checks/check-face-counting.mjs
node checks/check-moderation.mjs
node checks/check-text-generation.mjs
```

| Скрипт | Что проверяет |
| --- | --- |
| `check-agent-client.mjs` | Поток ответа, фрагментированный UTF-8, ошибки незавершённого ответа, идентификатор чата и перенос старой истории |
| `check-object-detection.mjs` | Количество объектов, допустимые классы, нулевой результат, ошибки и освобождение ресурсов |
| `check-face-counting.mjs` | Количество лиц, изображения, недопустимые ответы и освобождение ресурсов |
| `check-moderation.mjs` | Категории модерации, старые сохранённые ответы, пороги и ошибки адаптера |
| `check-text-generation.mjs` | Инструкция, параметры генерации, извлечение ответа и пустые входы/ответы |

Эти проверки используют подставные API и не оценивают качество настоящих моделей.

Отдельный режим реальной генерации ONNX:

```sh
node checks/check-text-generation.mjs --live
```

Он загружает SmolLM2 360M Instruct q8 в `artifacts/generation-model-cache/`, запускает ONNX Runtime Node на CPU и проверяет непустые ответы, контрольный ответ и отсутствие повторяющейся петли. При первой загрузке нужна сеть. Браузерный WASM этот режим не проверяет.

## Интерфейс

```sh
node checks/check-redesign.mjs
node checks/check-statistics-ui.mjs
```

Оба скрипта сами запускают отдельный headless Chrome с отдельным профилем и закрывают его после проверки. Путь к Chrome сейчас задан для Windows: `C:/Program Files/Google/Chrome/Application/chrome.exe`.

Нужны работающие frontend и backend, рекомендации и сохранённые измерения. По умолчанию открывается `http://localhost:18080`; другой адрес задаётся через `UI_URL`. Для матрицы сравнений нужны хотя бы два варианта с достаточным числом успешных измерений.

| Скрипт | Что проверяет |
| --- | --- |
| `check-redesign.mjs` | Темы и их сохранение, навигацию, поиск рекомендаций, пять видов графиков, модальные окна, график агента, Thinking, безопасность Markdown, лимит истории и мобильную вёрстку |
| `check-statistics-ui.mjs` | Пять вкладок статистики, матрицу сравнений, семь режимов тепловой карты, выбор памяти, мобильную вёрстку и пустую выборку |

Проверки не запускают экспериментальные измерения. Общая UI-проверка подставляет историю агента в браузере, не отправляя вопросы модели и не меняя пользовательские чаты. Скриншоты сохраняются в `artifacts/redesign/`.

Дополнительно `check-redesign.mjs` принимает `CHART_FIXTURE_FILE` с тремя графиками, подготовленными `check-agent-renderers.py`. В этом режиме проверяются загрузка PNG, ограниченный iframe и выполнение Plotly внутри него. Пример для PowerShell:

```powershell
$env:CHART_FIXTURE_FILE = 'artifacts/agent-charts/ui-fixture.json'
node checks/check-redesign.mjs
Remove-Item Env:CHART_FIXTURE_FILE
```

## Локальные модели TensorFlow.js

`check-tfjs-local.mjs` выполняет настоящий инференс шести TF.js-моделей, блокирует внешние HTTP-запросы и проверяет загрузку весов и словарей со стенда, а также `model_source=local`.

Сначала скачайте веса командой `python scripts/fetch-models.py`. Запустите Vite на `http://127.0.0.1:5174` с `VITE_MODEL_SOURCE=local` и отдельный headless Chrome с `--remote-debugging-port=9334` и отдельной папкой профиля. Затем:

```sh
node checks/check-tfjs-local.mjs
```

Проверка использует `/samples/object-detection.jpg` и `/samples/faces-group.jpg`. Закрывает подключённый тестовый браузер, измерения в БД не записывает.

## Проверка измерительного стенда

```sh
make smoke
make experiment
```

Без Make те же команды:

```sh
node checks/validate-stand.mjs --smoke
node checks/validate-stand.mjs
```

`validate-stand.mjs` требует запущенные Compose-сервисы frontend, backend, database и llm, зависимости frontend, локальные веса USE и Chrome/Chromium. Путь к браузеру задаётся через `CHROME_BIN`; порты сервисов определяются через Compose.

Smoke проверяет сервисы, HTTP/API/БД, настоящий USE/WASM, сохранение измерения и CSV-выгрузку. Полный режим выполняет 20 прогревов, 10 измерений и отдельный диагностический запуск с CPU-профилем. `analyze-stand-validation.py` вызывается автоматически в backend-контейнере: рассчитывает A/A-сравнение, тренд и оценку нагрузки обслуживающего кода. Результаты сохраняются в `artifacts/stand-validation/`.

Для проверки сохранения создаются временные записи с уникальным ключом эксперимента; в `finally` они удаляются. Пользовательские измерения не удаляются. Gemini Nano эта проверка не запускает.

## Агент и реальные данные

Эти проверки выполняются отдельно от быстрых тестов: им нужны работающие сервисы и, где указано, сохранённые измерения. Скрипты не включены в backend-образ; каталог подключается при запуске:

```sh
docker compose run --rm --no-deps -e AGENT_API_URL=http://backend:8000 -v ./checks:/checks:ro backend python /checks/check-agent.py
```

В этой команде можно заменить имя скрипта на нужное из таблицы.

| Скрипт | Что проверяет и какие данные нужны |
| --- | --- |
| `check-agent.py` | Обычный и потоковый ответы API, рекомендации, статистику, сравнение двух последних серий `text_generation`, график и историю. Для полного запуска нужны минимум две записанные серии |
| `check-agent-stream.py` | Время до заголовков и первого токена, завершение настоящего потокового ответа. Измерения не нужны; тестовый диалог остаётся в БД |
| `check-agent-all-metrics.py` | Графики всех пяти метрик и явное указание отсутствующих данных. Нужны измерения `language_detection` |
| `check-agent-mixed.py` | Совместное использование рекомендаций и измерений. Нужны успешные измерения `text_classification` |
| `check-agent-explanation.py` | Объяснение формулы, восстановление выборки из истории и точность исходных значений. Нужны успешные измерения `text_classification` / WebGPU |
| `check-agent-renderers.py` | Одинаковые данные для ECharts, PNG и Plotly, получение файлов через API и отказ для неверного пути. Нужен хотя бы один эксперимент с успешными измерениями |

Первые четыре скрипта обращаются к настоящей Ollama. Проверка объяснения использует подготовленную историю и расчёт по данным. Проверка форматов графиков не вызывает Ollama и не меняет чаты или измерения; создаёт файлы в `artifacts/agent-charts/`, включая `ui-fixture.json` для браузерной проверки.

Кроме `check-agent-stream.py`, проверки чатов используют отдельный UUID и удаляют свой тестовый чат в `finally`.

Внутри Compose API доступен как `http://backend:8000`; с компьютера при стандартной конфигурации - `http://localhost:18000`. Скрипты `check-agent.py`, `check-agent-all-metrics.py` и `check-agent-mixed.py` поддерживают `AGENT_API_URL`; остальные рассчитаны на запуск внутри Compose.

Для выборочного запуска общего скрипта задайте `AGENT_CHECK_TOOLS`, например `read_recommendations` или `calculate_statistics,build_chart`. Проверку рекомендаций можно выполнить без экспериментальных измерений:

```sh
docker compose run --rm --no-deps -e AGENT_API_URL=http://backend:8000 -e AGENT_CHECK_TOOLS=read_recommendations -v ./checks:/checks:ro backend python /checks/check-agent.py
```

## Модульные тесты backend

С установленными зависимостями, из каталога `backend`:

```sh
python -m unittest discover -s tests
```

Или из корня через Compose:

```sh
docker compose run --rm --no-deps -v ./backend/tests:/srv/tests:ro backend python -m unittest discover -s tests
```

Они проверяют расчёты, обработку запросов, инструменты агента, историю, графики и метаданные. Проверки с настоящей моделью дополняют их проверкой поведения локальной Ollama.
