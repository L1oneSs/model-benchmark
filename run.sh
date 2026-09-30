#!/usr/bin/env bash
# Запуск стенда на macOS и Linux
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v docker >/dev/null; then
  echo "Не найден Docker. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

echo "Поднимаю стенд. Первый запуск долгий: качаются образы и языковые модели, около 3,2 ГБ."
docker compose up -d --build

echo
echo "Готово. Откройте http://localhost:8080"
echo "Ход загрузки моделей: docker compose logs -f llm-bootstrap"
echo "Остановить: docker compose down"
