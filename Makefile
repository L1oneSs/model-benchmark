.PHONY: up down logs rebuild reset models export-csv smoke experiment

smoke:        ## Проверка сервисов, настоящего USE/WASM и сохранения метрик
	node checks/validate-stand.mjs --smoke

experiment:   ## Контроль стенда: 20 прогревов, 10 измерений USE/WASM и отдельный CPU-профиль
	node checks/validate-stand.mjs

up:            ## Поднять весь стенд
	docker compose up -d --build

down:          ## Остановить стенд, данные сохраняются
	docker compose down

reset:         ## Остановить стенд и стереть базу и скачанные модели LLM
	docker compose down -v

logs:          ## Логи всех сервисов
	docker compose logs -f

rebuild:       ## Пересобрать образы без кеша
	docker compose build --no-cache

models:        ## Скачать модели TensorFlow.js в frontend/public/models
	bash scripts/fetch-models.sh

export-csv:    ## Выгрузить измерения в exports/measurements.csv
	mkdir -p exports
	curl -sS "http://localhost:$${BACKEND_PORT:-8000}/api/measurements/export.csv" -o exports/measurements.csv
	@echo "Готово: exports/measurements.csv"
