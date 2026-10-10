#!/bin/sh
# Одноразовый сервис: дожидается Ollama и скачивает чат-модель агента.
# Запускается автоматически из docker-compose, завершается после загрузки.
set -e

echo "Жду Ollama на $OLLAMA_HOST"
i=0
until ollama list >/dev/null 2>&1; do
  i=$((i + 1))
  if [ "$i" -gt 60 ]; then
    echo "Ollama не поднялась за 5 минут, выхожу"
    exit 1
  fi
  sleep 5
done

for model in "$CHAT_MODEL"; do
  if ollama list | awk '{print $1}' | grep -qx "$model"; then
    echo "Модель $model уже скачана"
  else
    echo "Скачиваю $model"
    ollama pull "$model"
  fi
done

echo "Модели готовы:"
ollama list
