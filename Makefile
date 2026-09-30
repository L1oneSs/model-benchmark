.PHONY: up down logs rebuild reset models export-csv

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
