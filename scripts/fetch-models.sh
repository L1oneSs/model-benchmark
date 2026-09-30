#!/usr/bin/env bash
# Скачивает модели TensorFlow.js в frontend/public/models, чтобы стенд работал
# без обращения к внешним CDN. После запуска поставьте VITE_MODEL_SOURCE=local.
#
# model-a — MobileNet v2, классификация изображений (1000 классов ImageNet)
# model-b — Universal Sentence Encoder lite, векторизация текста
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEST="$ROOT/frontend/public/models"

MOBILENET_BASE="https://storage.googleapis.com/tfjs-models/tfjs/mobilenet_v2_1.0_224"
USE_BASE="https://storage.googleapis.com/tfjs-models/savedmodel/universal_sentence_encoder"

list_shards () {
  python3 -c '
import json, sys
manifest = json.load(open(sys.argv[1]))
for group in manifest.get("weightsManifest", []):
    for path in group.get("paths", []):
        print(path)
' "$1"
}

fetch_model () {
  local name="$1" base="$2" dir shard
  dir="$DEST/$name"
  mkdir -p "$dir"
  echo "==> $name"
  echo "    model.json"
  curl -fsSL "$base/model.json" -o "$dir/model.json"
  while read -r shard; do
    [ -n "$shard" ] || continue
    echo "    $shard"
    mkdir -p "$dir/$(dirname "$shard")"
    curl -fsSL "$base/$shard" -o "$dir/$shard"
  done < <(list_shards "$dir/model.json")
}

command -v python3 >/dev/null || { echo "Нужен python3 для разбора model.json"; exit 1; }

fetch_model "model-a" "$MOBILENET_BASE"
fetch_model "model-b" "$USE_BASE"

echo
echo "Модели лежат в $DEST"
echo "Поставьте VITE_MODEL_SOURCE=local в .env и пересоберите фронтенд:"
echo "  docker compose up -d --build frontend"
