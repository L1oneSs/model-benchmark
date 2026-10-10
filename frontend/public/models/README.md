# Локальные веса TensorFlow.js

Веса не входят в репозиторий; подпапки моделей исключены из Git. По умолчанию модели загружаются библиотеками из внешних хранилищ.

Из корня проекта в Bash с `python3` (дополнительные Python-пакеты не нужны):

```sh
bash scripts/fetch-models.sh
```

Скрипт скачивает `model.json` и шарды его `weightsManifest`:

| Папка | Что скачивается | Использование текущим адаптером |
|---|---|---|
| `model-a` | MobileNet v2 1.0 224 | Используется при `VITE_MODEL_SOURCE=local` |
| `model-b` | Universal Sentence Encoder lite и словарь | Используется при `VITE_MODEL_SOURCE=local`, словарь также нужен Toxicity |
| `toxicity` | Toxicity classifier | Используется при `VITE_MODEL_SOURCE=local` |
| `qna` | MobileBERT и словарь | Используется при `VITE_MODEL_SOURCE=local` |
| `coco-ssd` | COCO-SSD MobileNet v2 | Используется при `VITE_MODEL_SOURCE=local` |
| `face-detector` | MediaPipe Face Detector short | Используется при `VITE_MODEL_SOURCE=local` |

На Windows можно обойтись без Bash: `python scripts/fetch-models.py`.
Для загрузки отдельных моделей перечислите папки: `python scripts/fetch-models.py model-b qna`.
Toxicity также требует словарь из `model-b`. Скрипт повторяет неудачные сетевые
запросы и сохраняет файлы через временный `.part`, чтобы обрыв не оставил неполный файл.

Чтобы переключить все модели TensorFlow.js, задайте в корневом `.env`:

```env
VITE_MODEL_SOURCE=local
```

И пересоберите фронтенд:

```sh
docker compose up -d --build --no-deps frontend
```

MobileNet берётся по `/models/model-a/model.json` в классификации изображения и эксперименте ускорителей. Метрика первой загрузки всё равно включает чтение весов, инициализацию и внутренний прогрев, а не становится нулевой автоматически.

Все шесть моделей TensorFlow.js читают локальные веса и словари. Для зашитых в библиотеках адресов словарей MobileBERT и Toxicity адаптер перенаправляет только соответствующие запросы платформы TF.js на локальные файлы. Если файла нет, загрузка завершается ошибкой, без переключения на CDN.

**Этот режим не делает весь стенд автономным.** Transformers.js / ONNX скачивает веса из Hugging Face и использует свой кеш. Встроенные модели и языковые пакеты скачивает Chrome. Ollama хранит отдельные серверные веса в Docker-томе.

Для полностью автономной работы нужно отдельно подготовить ONNX-модели,
их токенизаторы и runtime-файлы, а также модели и языковые пакеты Chrome.
`fetch-models.sh` занимается только TensorFlow.js.
