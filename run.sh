#!/usr/bin/env bash
# Запуск стенда на macOS и Linux
set -e
cd "$(dirname "${BASH_SOURCE[0]}")"

if ! command -v docker >/dev/null; then
  echo "Не найден Docker. Установите Docker Desktop: https://www.docker.com/products/docker-desktop/"
  exit 1
fi

echo "Поднимаю стенд. Первый запуск долгий: качаются образы и языковые модели, около 3,2 ГБ."
export STAND_GIT_COMMIT="${STAND_GIT_COMMIT:-$(git rev-parse HEAD 2>/dev/null || true)}"
if ! git diff --quiet HEAD -- frontend backend 2>/dev/null; then export STAND_GIT_DIRTY=true; fi
docker compose up -d --build

echo
stand_port=$(docker compose port frontend 80 | awk -F: 'NR == 1 {print $NF}')
echo "Готово. Откройте http://localhost:${stand_port}"
echo "Ход загрузки моделей: docker compose logs -f llm-bootstrap"
echo "Остановить: docker compose down"
