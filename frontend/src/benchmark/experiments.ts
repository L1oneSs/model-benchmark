/** Описание экспериментов стенда.
 *
 *  Набор задач и метрик задан теоретической частью: сравниваются обработка
 *  текста и обработка изображения, плюс отдельный эксперимент, выполнимый
 *  только для библиотечной парадигмы — выбор ускорителя, которого встроенная
 *  модель разработчику не даёт.
 */

import * as nano from '../models/geminiNano';
import * as tfjs from '../models/tensorflow';
import type { Approach, ExperimentInput, RunOutcome, TranslationDirection } from './types';

export type ResultColumn = 'approach' | 'settings' | 'inference_ms' | 'first_token_ms' | 'memory_mb' | 'output' | 'created_at';
export const DEFAULT_RESULT_COLUMNS: ResultColumn[] = ['approach', 'settings', 'inference_ms', 'first_token_ms', 'memory_mb', 'output', 'created_at'];

export interface ExperimentDefinition {
  resultColumns?: ResultColumn[];
  showSummary?: boolean;
  summaryByBackend?: boolean;
  key: string;
  title: string;
  description: string;
  /** Какие парадигмы участвуют. Третий эксперимент — только TensorFlow.js. */
  approaches: Approach[];
  inputKind: 'text' | 'image';
  defaultText?: string;
  defaultImageUrl?: string;
  defaultImageLabel?: string;
  /** Для эксперимента с ускорителями: прогон повторяется по каждому бэкенду. */
  sweepsBackends?: boolean;
  /** Использует ли библиотечная парадигма выбор TensorFlow.js backend. */
  usesTensorFlowBackends?: boolean;
  /** Название библиотечной парадигмы в UI, если это не TensorFlow.js. */
  libraryLabel?: string;
  run(
    approach: Approach,
    input: ExperimentInput,
    backend?: tfjs.TfBackend,
    options?: { translationDirection?: TranslationDirection },
  ): Promise<RunOutcome>;
}

/** Вход сравнительных экспериментов — английский, и это вынужденно.
 *  Prompt API принимает en, ja, es, de и fr; на русский вход браузер отвечает
 *  NotSupportedError. Universal Sentence Encoder тоже обучен на английском.
 *  Русский текст сюда вставить можно: встроенная парадигма вернёт отказ, он
 *  запишется статусом «не поддерживается» и станет отдельным наблюдением. */
const DEFAULT_TEXT =
  'The interface is fast, the model loaded instantly, and the application is convenient to use.';

export const EXPERIMENTS: ExperimentDefinition[] = [
  {
    key: 'text_classification',
    title: 'Сравнение в скорости обработки текста',
    description:
      'Обе парадигмы определяют тональность одного и того же текста. Библиотечный путь кодирует ' +
      'вход энкодером и сравнивает с опорными векторами, встроенный — отвечает на промпт. ' +
      'Метрика «до первого предсказания» для встроенной модели снимается по первому фрагменту потока. ' +
      'Текст английский: Prompt API принимает только en, ja, es, de и fr, на русский вход отвечает отказом.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText: DEFAULT_TEXT,
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runTextClassification(input.text, backend)
        : nano.runTextClassification(input.text);
    },
  },
  {
    key: 'text_moderation',
    title: 'Модерация и токсичность текста',
    description:
      'TensorFlow.js использует готовую toxicity-модель и выдаёт категории риска, Gemini Nano классифицирует тот же текст через Prompt API. ' +
      'Эксперимент показывает задержку узкой специализированной модели против генеративной классификации.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText: 'You are awful and nobody wants to work with you.',
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runTextModeration(input.text, backend)
        : nano.runTextModeration(input.text);
    },
  },
  {
    key: 'question_answering',
    title: 'Вопрос-ответ по короткому контексту',
    description:
      'TensorFlow.js использует MobileBERT QnA и извлекает короткий ответ из контекста, Gemini Nano отвечает на тот же вопрос через Prompt API. ' +
      'Введите вопрос и текст контекста в отдельные поля.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText:
      'Question: Which browser machine learning approach lets developers choose WebGPU, WebGL, WebAssembly, and CPU backends?\n\n' +
      'Context: TensorFlow.js lets developers select execution backends such as WebGPU, WebGL, WebAssembly, and CPU inside the browser. Gemini Nano is managed by Chrome as a built-in browser service and hides accelerator selection from the application.',
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runQuestionAnswering(input.text, backend)
        : nano.runQuestionAnswering(input.text);
    },
  },
  {
    key: 'image_classification',
    title: 'Сравнение в скорости обработки изображения',
    description:
      'Классификация одного изображения. MobileNet v2 против мультимодального запроса к Gemini Nano. ' +
      'Если сборка Chrome не принимает изображение на вход, прогон помечается статусом «не поддерживается» — ' +
      'это тоже результат сравнения.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'image',
    async run(approach, input, backend) {
      if (input.kind !== 'image') throw new Error('Эксперимент ожидает изображение');
      return approach === 'tensorflow_js'
        ? tfjs.runImageClassification(input.element, backend)
        : nano.runImageClassification(input.element);
    },
  },
  {
    key: 'object_detection',
    defaultImageUrl: '/samples/object-detection.jpg',
    defaultImageLabel: 'Пляж: люди и воздушные змеи (официальное демо COCO-SSD)',
    title: 'Обнаружение объектов на изображении',
    description:
      'COCO-SSD MobileNet v2 и Gemini Nano определяют объекты на одном изображении. ' +
      'Сравниваются найденные классы, количество объектов и время обработки. COCO-SSD использует порог уверенности 50%. ' +
      'Gemini отвечает в рамках тех же 80 классов COCO; его оценки количества могут отличаться. ' +
      'Загрузите фотографию с несколькими объектами. Если Prompt API не поддерживает изображения, прогон Gemini получит статус «не поддерживается».',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'image',
    async run(approach, input, backend) {
      if (input.kind !== 'image') throw new Error('Эксперимент ожидает изображение');
      return approach === 'tensorflow_js'
        ? tfjs.runObjectDetection(input.element, backend)
        : nano.runObjectDetection(input.element);
    },
  },
  {
    key: 'face_counting',
    title: 'Подсчёт лиц на изображении',
    description:
      'BlazeFace через TensorFlow.js и Gemini Nano считают видимые лица на одной фотографии. ' +
      'Сравниваются найденное количество лиц и время обработки. ' +
      'До 20 лиц; для мелких и частично закрытых лиц точность может снижаться. ' +
      'Gemini требует поддержки изображений в Prompt API.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'image',
    defaultImageUrl: '/samples/faces-group.jpg',
    defaultImageLabel: 'Групповая фотография из тестовых данных TensorFlow.js',
    async run(approach, input, backend) {
      if (input.kind !== 'image') throw new Error('Эксперимент ожидает изображение');
      return approach === 'tensorflow_js'
        ? tfjs.runFaceCounting(input.element, backend)
        : nano.runFaceCounting(input.element);
    },
  },
  {
    key: 'tfjs_backends',
    resultColumns: ['approach', 'settings', 'inference_ms', 'created_at'],
    summaryByBackend: true,
    title: 'Влияние ускорителя на латентность (только TensorFlow.js)',
    description:
      'Один и тот же инференс MobileNet v2 прогоняется на каждом доступном бэкенде: WebGPU, WebGL, ' +
      'WebAssembly, CPU. Встроенная парадигма в эксперименте не участвует — Prompt API не позволяет ' +
      'выбрать ускоритель, и это ограничение фиксируется как самостоятельный вывод.',
    approaches: ['tensorflow_js'],
    inputKind: 'image',
    sweepsBackends: true,
    async run(approach, input) {
      if (input.kind !== 'image') throw new Error('Эксперимент ожидает изображение');
      if (approach !== 'tensorflow_js') throw new Error('Эксперимент выполняется только для TensorFlow.js');
      return tfjs.runImageClassification(input.element);
    },
  },
  {
    key: 'text_summarization',
    title: 'Суммаризация текста',
    description:
      'Сравнение готовой встроенной суммаризации Gemini Nano с библиотечным baseline на TensorFlow.js. ' +
      'TensorFlow.js кодирует предложения через Universal Sentence Encoder и выбирает ключевые фразы, ' +
      'а встроенная парадигма использует Summarizer API или Prompt API.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText:
      'Browser-based machine learning lets web applications process data locally without sending it to a server. ' +
      'TensorFlow.js gives developers direct control over models, backends, caching, and acceleration. ' +
      'Built-in AI APIs in Chrome expose Gemini Nano as a browser service with simpler integration. ' +
      'The trade-off is control: developers can tune TensorFlow.js pipelines, while the browser manages Gemini Nano internally. ' +
      'A benchmark should therefore measure startup time, inference latency, supported inputs, and device availability.',
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runTextSummarization(input.text, backend)
        : nano.runTextSummarization(input.text);
    },
  },
  {
    key: 'semantic_search',
    title: 'Семантический поиск по коротким документам',
    description:
      'Обе парадигмы выбирают наиболее релевантный документ для запроса. TensorFlow.js считает эмбеддинги ' +
      'запроса и документов через Universal Sentence Encoder, Gemini Nano выбирает ответ через Prompt API.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText:
      'Query: Which approach gives developers control over WebGPU, WebGL, WebAssembly, and CPU backends?\n\n' +
      'Documents:\n' +
      'A. TensorFlow.js lets developers select execution backends and manage model lifecycle inside the browser tab.\n' +
      'B. Gemini Nano is managed by Chrome and hides accelerator selection behind built-in browser services.\n' +
      'C. Server-side APIs execute models outside the browser and require network communication.',
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runSemanticSearch(input.text, backend)
        : nano.runSemanticSearch(input.text);
    },
  },
  {
    key: 'text_rewriting',
    usesTensorFlowBackends: false,
    libraryLabel: 'ONNX',
    title: 'Перефразирование короткого текста',
    description:
      'Сравнение ONNX-модели FLAN-T5 small через Transformers.js со встроенным Rewriter API или Prompt API. ' +
      'ONNX-модель генерирует новую формулировку в браузере, а встроенная парадигма делегирует перефразирование модели Gemini Nano в Chrome.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText: 'The interface is fast, the model loaded instantly, and the application is convenient to use.',
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runTextRewriting(input.text, backend)
        : nano.runTextRewriting(input.text);
    },
  },

  {
    key: 'text_translation',
    usesTensorFlowBackends: false,
    libraryLabel: 'ONNX',
    title: 'Перевод текста',
    description:
      'Сравнение готовой ONNX-модели перевода OPUS-MT через Transformers.js со встроенным Translator API. ' +
      'ONNX-модель выполняется в браузере через ONNX Runtime Web, встроенная парадигма использует браузерный Translator API.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText: 'The interface is fast, the model loaded instantly, and the application is convenient to use.',
    async run(approach, input, backend, options) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      const direction = options?.translationDirection ?? 'en_ru';
      return approach === 'tensorflow_js'
        ? tfjs.runTextTranslation(input.text, backend, direction)
        : nano.runTextTranslation(input.text, direction);
    },
  },

  {
    key: 'language_detection',
    usesTensorFlowBackends: false,
    libraryLabel: 'ONNX',
    title: 'Определение языка текста',
    description:
      'Сравнение готовой ONNX-модели language identification через Transformers.js с браузерным LanguageDetector API. ' +
      'ONNX-модель выполняется в браузере через ONNX Runtime Web, встроенная парадигма использует отдельную модель определения языка Chrome.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText: 'Browser machine learning runs models locally in the user browser.',
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runLanguageDetection(input.text, backend)
        : nano.runLanguageDetection(input.text);
    },
  },
  {
    key: 'text_proofreading',
    usesTensorFlowBackends: false,
    libraryLabel: 'ONNX',
    title: 'Проверка грамматики текста',
    description:
      'Сравнение ONNX-модели T5 Tiny GEC через Transformers.js со встроенным Proofreader API или Prompt API. ' +
      'ONNX-модель исправляет грамматические и орфографические ошибки в браузере, а встроенная парадигма делегирует проверку модели Gemini Nano в Chrome.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText: 'Teh modle loaded fast, but the aplication do not works correctly.',
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runProofreading(input.text, backend)
        : nano.runProofreading(input.text);
    },
  },

  {
    key: 'text_generation',
    usesTensorFlowBackends: false,
    libraryLabel: 'ONNX',
    title: 'Генерация короткого текста',
    description:
      'Сравнение ONNX-модели SmolLM2 360M Instruct через Transformers.js со встроенным Writer API или Prompt API. ' +
      'Вход — краткая инструкция, выход — новый короткий текст, сгенерированный на стороне клиента.',
    approaches: ['tensorflow_js', 'gemini_nano'],
    inputKind: 'text',
    defaultText: 'Write a short benchmark note explaining when Gemini Nano is preferable for browser machine learning.',
    async run(approach, input, backend) {
      if (input.kind !== 'text') throw new Error('Эксперимент ожидает текстовый вход');
      return approach === 'tensorflow_js'
        ? tfjs.runTextGeneration(input.text, backend)
        : nano.runTextGeneration(input.text);
    },
  },

];

export const getExperiment = (key: string): ExperimentDefinition => {
  const found = EXPERIMENTS.find((item) => item.key === key);
  if (!found) throw new Error(`Неизвестный эксперимент: ${key}`);
  return found;
};

export const approachLabel = (experiment: ExperimentDefinition, approach: Approach): string =>
  approach === 'tensorflow_js'
    ? experiment.libraryLabel ?? 'TensorFlow.js'
    : 'Gemini Nano';

export const approachBadgeClass = (experiment: ExperimentDefinition, approach: Approach): string => {
  if (approach === 'gemini_nano') return 'gemini';
  return experiment.libraryLabel === 'ONNX' ? 'onnx' : 'tfjs';
};


/** Диагностика доступности в таблицу измерений попадает так же, как прогоны,
 *  поэтому вкладке «Измерения» нужен её описатель. Запускать его как обычный
 *  эксперимент нельзя — он снимается кнопкой на панели среды. */
export const AVAILABILITY_PSEUDO_EXPERIMENT: ExperimentDefinition = {
  key: 'builtin_availability',
  title: 'Доступность встроенных ИИ-API браузера',
  description:
    'По строке на каждый встроенный API: объявлен ли он в этом браузере и что отвечает availability(). ' +
    'Снимается кнопкой «Записать в датасет» на панели среды во вкладке «Стенд». ' +
    'На устройстве, не проходящем аппаратный порог, часть объектов браузер не объявляет вовсе.',
  approaches: ['gemini_nano'],
  inputKind: 'text',
  async run() {
    throw new Error('Диагностика снимается кнопкой на панели среды, а не запуском эксперимента');
  },
};
