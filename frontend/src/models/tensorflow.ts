/** Библиотечная парадигма: TensorFlow.js.
 *
 *  Модели загружаются один раз и кешируются в модуле — иначе каждый прогон
 *  мерил бы сеть, а не инференс. Время загрузки записывается отдельной
 *  метрикой load_ms: при первом обращении это реальное время, дальше 0 мс.
 *
 *  Источник весов задаётся переменной VITE_MODEL_SOURCE:
 *    cdn   — официальные хранилища Google (по умолчанию);
 *    local — public/models, заполняется скриптом scripts/fetch-models.sh.
 */

import * as tf from '@tensorflow/tfjs';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import * as mobilenet from '@tensorflow-models/mobilenet';
import * as use from '@tensorflow-models/universal-sentence-encoder';

import { elapsed, heapDelta, heapUsedMb, now, withTotal } from '../benchmark/metrics';
import type { RunOutcome, TranslationDirection } from '../benchmark/types';
import { formatObjectCounts } from '../benchmark/objectDetection';
import { formatModerationScores, MODERATION_THRESHOLD } from '../benchmark/moderation';

export type TfBackend = 'webgl' | 'webgpu' | 'wasm' | 'cpu';

export const MOBILENET_MODEL_NAME = 'MobileNet v2 1.0 224 (TensorFlow.js)';
export const USE_MODEL_NAME = 'Universal Sentence Encoder lite (TensorFlow.js)';
export const TOXICITY_MODEL_NAME = 'Toxicity classifier (TensorFlow.js)';
export const QNA_MODEL_NAME = 'MobileBERT QnA (TensorFlow.js)';
export const COCO_SSD_MODEL_NAME = 'COCO-SSD MobileNet v2 (TensorFlow.js)';
export const FACE_MODEL_NAME = 'BlazeFace / MediaPipe Face Detector (TensorFlow.js)';

type ToxicityPrediction = {
  label: string;
  results: Array<{ probabilities?: Float32Array | number[]; match: boolean | null }>;
};
type ToxicityModel = { classify(inputs: string[]): Promise<ToxicityPrediction[]> };
type QnaAnswer = { text: string; score: number; startIndex?: number; endIndex?: number };
type QnaModel = { findAnswers(question: string, passage: string): Promise<QnaAnswer[]> };


const LOCAL_MODELS = import.meta.env.VITE_MODEL_SOURCE === 'local';
const localModel = (folder: string, file = 'model.json'): string =>
  `${window.location.origin}/models/${folder}/${file}`;

// MobileBERT and Toxicity have hardcoded vocabulary URLs in the installed versions.
// Redirect only those TF.js requests; do not patch global fetch or other traffic.
if (LOCAL_MODELS) {
  const platform = tf.env().platform;
  const fetch = platform.fetch.bind(platform);
  platform.fetch = (path, init, options) => fetch(
    path.split('?')[0] === 'https://tfhub.dev/tensorflow/tfjs-model/mobilebert/1/processed_vocab.json'
      ? localModel('qna', 'processed_vocab.json')
      : path.split('?')[0] === 'https://storage.googleapis.com/tfjs-models/savedmodel/universal_sentence_encoder/vocab.json'
        ? localModel('model-b', 'vocab.json') : path,
    init, options,
  );
}
const TOXICITY_LABELS = ['identity_attack', 'insult', 'obscene', 'severe_toxicity', 'sexual_explicit', 'threat', 'toxicity'];

/** Опорные фразы для классификации тональности: их векторы считаются один раз
 *  при загрузке, поэтому в латентность инференса попадает только входной текст. */
const ANCHORS = {
  positive: 'Это отличный, удобный и полезный продукт, я очень доволен.',
  negative: 'Это ужасный, неудобный и бесполезный продукт, я очень разочарован.',
};

let mobilenetModel: mobilenet.MobileNet | null = null;
let useModel: use.UniversalSentenceEncoder | null = null;
let anchorVectors: { positive: Float32Array; negative: Float32Array } | null = null;
let toxicityModel: ToxicityModel | null = null;
let qnaModel: QnaModel | null = null;
let objectDetectionModel: import('@tensorflow-models/coco-ssd').ObjectDetection | null = null;
let faceDetector: import('@tensorflow-models/face-detection').FaceDetector | null = null;
let webgpuRegistered = false;
let tensorflowReady: Promise<void> | null = null;
let backendProbe: Promise<TfBackend[]> | null = null;

/** Бинарники WebAssembly-бэкенда раздаются самим стендом из /wasm/
 *  (их копирует туда Dockerfile при сборке), поэтому внешняя сеть не нужна. */
const WASM_PATH = `${window.location.origin}/wasm/`;
// Configure assets before tf.ready() can initialize the statically registered WASM backend.
setWasmPaths(WASM_PATH);

/** Набор бэкендов, реально доступных в этом браузере. */
export async function availableBackends(): Promise<TfBackend[]> {
  backendProbe ??= probeBackends().finally(() => { backendProbe = null; });
  return backendProbe;
}

async function probeBackends(): Promise<TfBackend[]> {
  try {
    await ensureTensorFlowReady();
  } catch {
    // Individual backend probes below can still identify registered backends.
  }
  const found: TfBackend[] = [];
  const previous = tf.getBackend();

  for (const backend of ['webgpu', 'webgl', 'wasm', 'cpu'] as TfBackend[]) {
    try {
      if (backend === 'webgpu') {
        const gpu = (navigator as Navigator & { gpu?: unknown }).gpu;
        if (!gpu) continue;
        await ensureWebgpuRegistered();
      }
      // findBackend() returns null while an async backend is still initializing.
      // setBackend() waits for initialization and reports actual availability.
      if (await tf.setBackend(backend)) found.push(backend);
    } catch {
      // A broken driver or missing WASM asset must not hide the other backends.
    }
  }

  if (previous) {
    try {
      await tf.setBackend(previous);
      await tf.ready();
    } catch {
      // Keep the discovered list even if restoring the initial backend fails.
    }
  }
  return found;
}

/** TensorFlow.js должен завершить выбор начального бэкенда до проверки или смены другого. */
async function ensureTensorFlowReady(): Promise<void> {
  tensorflowReady ??= tf.ready();
  await tensorflowReady;
}

async function ensureWebgpuRegistered(): Promise<void> {
  if (webgpuRegistered) return;
  try {
    await import('@tensorflow/tfjs-backend-webgpu');
    webgpuRegistered = true;
  } catch {
    webgpuRegistered = false;
  }
}

/** Переключение ускорителя. Используется экспериментом сравнения бэкендов. */
export async function setBackend(backend: TfBackend): Promise<boolean> {
  await ensureTensorFlowReady();
  if (backend === 'webgpu') await ensureWebgpuRegistered();
  const ok = await tf.setBackend(backend);
  if (ok) await tf.ready();
  return ok;
}

/** Обычные эксперименты не должны зависеть от backend, оставшегося после предыдущего запуска. */
export async function ensureBenchmarkBackend(): Promise<void> {
  const backends = await availableBackends();
  const preferred = (['webgl', 'webgpu', 'wasm', 'cpu'] as TfBackend[]).find((backend) =>
    backends.includes(backend),
  );
  if (preferred && tf.getBackend() !== preferred) await setBackend(preferred);
}

export const currentBackend = (): string => tf.getBackend();

/** Прогрев: первый вызов любого бэкенда компилирует шейдеры и всегда медленнее
 *  последующих. Прогретый прогон в статистику не попадает. */
async function warmUpMobilenet(model: mobilenet.MobileNet): Promise<void> {
  const blank = tf.zeros([224, 224, 3], 'int32') as tf.Tensor3D;
  try {
    await model.classify(blank);
  } finally {
    blank.dispose();
  }
}

async function loadMobilenet(): Promise<number> {
  if (mobilenetModel) return 0;
  const started = now();
  mobilenetModel = await mobilenet.load(
    LOCAL_MODELS
      ? { version: 2, alpha: 1.0, modelUrl: localModel('model-a'), inputRange: [0, 1] }
      : { version: 2, alpha: 1.0 },
  );
  await warmUpMobilenet(mobilenetModel);
  return elapsed(started);
}

async function loadSentenceEncoder(): Promise<number> {
  if (useModel && anchorVectors) return 0;
  const started = now();
  useModel = await use.load(LOCAL_MODELS
    ? { modelUrl: localModel('model-b'), vocabUrl: localModel('model-b', 'vocab.json') }
    : undefined);
  const embeddings = await useModel.embed([ANCHORS.positive, ANCHORS.negative]);
  const data = (await embeddings.array()) as number[][];
  embeddings.dispose();
  anchorVectors = {
    positive: Float32Array.from(data[0]),
    negative: Float32Array.from(data[1]),
  };
  return elapsed(started);
}

function cosine(a: Float32Array | number[], b: Float32Array | number[]): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i += 1) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dot / (Math.sqrt(normA) * Math.sqrt(normB) || 1e-9);
}

async function prepareTextModel(backend?: TfBackend): Promise<{ loadMs: number; settings: Record<string, unknown> }> {
  if (backend) {
    if (!(await setBackend(backend))) {
      throw new Error(`Бэкенд ${backend} недоступен`);
    }
  } else await ensureBenchmarkBackend();
  await ensureTensorFlowReady();
  const loadMs = await loadSentenceEncoder();
  if (!useModel) throw new Error('Энкодер не загрузился');
  return {
    loadMs,
    settings: { backend: currentBackend(), model_source: LOCAL_MODELS ? 'local' : 'cdn' },
  };
}

async function prepareTfBackend(backend?: TfBackend): Promise<Record<string, unknown>> {
  if (backend) {
    if (!(await setBackend(backend))) {
      throw new Error(`?????? ${backend} ??????????`);
    }
  } else await ensureBenchmarkBackend();
  await ensureTensorFlowReady();
  return { backend: currentBackend(), model_source: LOCAL_MODELS ? 'local' : 'cdn' };
}

async function loadToxicityModel(): Promise<number> {
  if (toxicityModel) return 0;
  const started = now();
  const toxicity = await import('@tensorflow-models/toxicity');
  if (LOCAL_MODELS) {
    class LocalToxicityClassifier extends toxicity.ToxicityClassifier {
      override loadModel() { return tf.loadGraphModel(localModel('toxicity')); }
    }
    const model = new LocalToxicityClassifier(MODERATION_THRESHOLD, TOXICITY_LABELS);
    await model.load();
    toxicityModel = model as ToxicityModel;
  } else {
    toxicityModel = await toxicity.load(MODERATION_THRESHOLD, TOXICITY_LABELS) as ToxicityModel;
  }
  return elapsed(started);
}

async function loadQnaModel(): Promise<number> {
  if (qnaModel) return 0;
  const started = now();
  const qna = await import('@tensorflow-models/qna');
  qnaModel = await qna.load(LOCAL_MODELS
    ? { modelUrl: localModel('qna'), fromTFHub: false } : undefined) as QnaModel;
  return elapsed(started);
}


const splitSentences = (text: string): string[] =>
  text
    .replace(/\s+/g, ' ')
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);

async function embedTexts(texts: string[]): Promise<number[][]> {
  if (!useModel) throw new Error('Энкодер не загрузился');
  const embeddings = await useModel.embed(texts);
  try {
    return (await embeddings.array()) as number[][];
  } finally {
    embeddings.dispose();
  }
}

interface SearchDocument {
  id: string;
  text: string;
}

function parseSearchInput(text: string): { query: string; documents: SearchDocument[] } {
  const queryMatch = text.match(/(?:^|\n)\s*Query:\s*(.+?)(?:\n\s*\n|$)/is);
  const docsBlock = text.match(/Documents:\s*([\s\S]+)/i)?.[1] ?? '';
  const documents = docsBlock
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line, index) => {
      const match = line.match(/^([A-ZА-Я0-9]+)[.)]\s*(.+)$/i);
      return {
        id: match?.[1] ?? String(index + 1),
        text: match?.[2] ?? line,
      };
    });

  return {
    query: queryMatch?.[1]?.trim() || text.split(/\n+/)[0]?.trim() || text.trim(),
    documents: documents.length > 0 ? documents : splitSentences(text).map((sentence, index) => ({
      id: String(index + 1),
      text: sentence,
    })),
  };
}

function parseQuestionAnsweringInput(text: string): { question: string; context: string } {
  const question =
    text.match(/(?:^|\n)\s*(?:Question|Q):\s*(.+?)(?:\n\s*\n|$)/is)?.[1]?.trim() ||
    text.split(/\n+/)[0]?.replace(/^(Question|Q):\s*/i, '').trim() ||
    text.trim();
  const context =
    text.match(/(?:Context|Passage):\s*([\s\S]+)/i)?.[1]?.trim() ||
    text
      .split(/\n+/)
      .slice(1)
      .join(' ')
      .replace(/^(Context|Passage):\s*/i, '')
      .trim() ||
    text.trim();
  return { question, context };
}


function parseTranslationSource(text: string): string {
  return (
    text.match(/(?:^|\n)\s*(?:Text|Source):\s*(.+?)(?:\n\s*\n|$)/is)?.[1]?.trim() ||
    text.split(/\n+/)[0]?.replace(/^(Text|Source):\s*/i, '').trim() ||
    text.trim()
  );
}

/** Эксперимент 1: тональность короткого текста.
 *  Вход кодируется энкодером, метка выбирается по близости к опорным векторам. */
export async function runTextClassification(text: string, backend?: TfBackend): Promise<RunOutcome> {
  if (backend) {
    if (!(await setBackend(backend))) {
      return failure(USE_MODEL_NAME, { backend }, new Error(`Бэкенд ${backend} недоступен`));
    }
  } else await ensureBenchmarkBackend();
  await ensureTensorFlowReady();
  const heapBefore = heapUsedMb();
  const settings = { backend: currentBackend(), model_source: LOCAL_MODELS ? 'local' : 'cdn' };

  try {
    const loadMs = await loadSentenceEncoder();
    if (!useModel || !anchorVectors) throw new Error('Энкодер не загрузился');

    const started = now();
    const embedding = await useModel.embed([text]);
    const vector = ((await embedding.array()) as number[][])[0];
    embedding.dispose();

    const positive = cosine(vector, anchorVectors.positive);
    const negative = cosine(vector, anchorVectors.negative);
    const inferenceMs = elapsed(started);

    const label = positive >= negative ? 'позитивная' : 'негативная';

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: `Тональность ${label}`,
      metadata: {anchors: ANCHORS, similarities: {positive, negative}, embedding_dimensions: vector.length,
        decision: 'positive if positive cosine >= negative cosine; otherwise negative'},
      model_name: USE_MODEL_NAME,
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(USE_MODEL_NAME, settings, error);
  }
}

export async function runTextModeration(text: string, backend?: TfBackend): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  const settings = await prepareTfBackend(backend);

  try {
    const loadMs = await loadToxicityModel();
    if (!toxicityModel) throw new Error('Модель модерации не загрузилась');

    const started = now();
    const predictions = await toxicityModel.classify([text]);
    const inferenceMs = elapsed(started);
    const matched = predictions
      .filter((prediction) => prediction.results[0]?.match === true)
      .map((prediction) => prediction.label);
    const scores = Object.fromEntries(predictions.map(prediction =>
      [prediction.label, Number(prediction.results[0]?.probabilities?.[1] ?? 0)]));

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: formatModerationScores(scores, matched),
      model_name: TOXICITY_MODEL_NAME,
      settings: { ...settings, task: 'toxicity_classification', threshold: MODERATION_THRESHOLD, category_scores: scores, matched_categories: matched },
      status: 'ok',
    };
  } catch (error) {
    return failure(TOXICITY_MODEL_NAME, { backend: backend ?? currentBackend(), task: 'toxicity_classification' }, error);
  }
}

export async function runQuestionAnswering(text: string, backend?: TfBackend): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  const settings = await prepareTfBackend(backend);

  try {
    const loadMs = await loadQnaModel();
    if (!qnaModel) throw new Error('QnA model ?? ???????????');
    const { question, context } = parseQuestionAnsweringInput(text);

    const started = now();
    const answers = await qnaModel.findAnswers(question, context);
    const inferenceMs = elapsed(started);
    const best = answers[0];
    if (!best) throw new Error('QnA model ?? ????? ?????');

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: `${best.text} ? score=${best.score.toFixed(3)}`,
      model_name: QNA_MODEL_NAME,
      settings: { ...settings, task: 'question_answering', question },
      status: 'ok',
    };
  } catch (error) {
    return failure(QNA_MODEL_NAME, { backend: backend ?? currentBackend(), task: 'question_answering' }, error);
  }
}


/** Суммаризация без генеративной модели: выбираем предложения, наиболее близкие
 *  к эмбеддингу всего текста. Это библиотечный baseline для сравнения с
 *  готовым Summarizer API. */
export async function runTextSummarization(text: string, backend?: TfBackend): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  try {
    const { loadMs, settings } = await prepareTextModel(backend);
    const sentences = splitSentences(text);
    if (sentences.length === 0) throw new Error('Нет предложений для суммаризации');

    const started = now();
    const vectors = await embedTexts([text, ...sentences]);
    const documentVector = vectors[0];
    const selected = sentences
      .map((sentence, index) => ({ sentence, index, score: cosine(documentVector, vectors[index + 1]) }))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(2, sentences.length))
      .sort((left, right) => left.index - right.index)
      .map((item) => item.sentence);
    const inferenceMs = elapsed(started);

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: selected.join(' '),
      model_name: USE_MODEL_NAME,
      settings: { ...settings, task: 'extractive_summarization', sentences: sentences.length },
      status: 'ok',
    };
  } catch (error) {
    return failure(USE_MODEL_NAME, { backend: backend ?? currentBackend(), task: 'extractive_summarization' }, error);
  }
}

/** Семантический поиск: запрос и короткие документы кодируются одним USE,
 *  победитель выбирается по косинусной близости. */
export async function runSemanticSearch(text: string, backend?: TfBackend): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  try {
    const { loadMs, settings } = await prepareTextModel(backend);
    const { query, documents } = parseSearchInput(text);
    if (documents.length === 0) throw new Error('Нет документов для поиска');

    const started = now();
    const vectors = await embedTexts([query, ...documents.map((document) => document.text)]);
    const queryVector = vectors[0];
    const best = documents
      .map((document, index) => ({ document, score: cosine(queryVector, vectors[index + 1]) }))
      .sort((left, right) => right.score - left.score)[0];
    const inferenceMs = elapsed(started);

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: `Документ ${best.document.id}: ${best.document.text.slice(0, 160)} · similarity=${best.score.toFixed(3)}`,
      model_name: USE_MODEL_NAME,
      settings: { ...settings, task: 'semantic_search', documents: documents.length },
      status: 'ok',
    };
  } catch (error) {
    return failure(USE_MODEL_NAME, { backend: backend ?? currentBackend(), task: 'semantic_search' }, error);
  }
}

type TextGenerationResult = { generated_text?: string; summary_text?: string; translation_text?: string };
type Text2TextPipeline = (
  input: string,
  options?: { max_new_tokens?: number; do_sample?: boolean; num_beams?: number },
) => Promise<TextGenerationResult[] | TextGenerationResult>;

const REWRITING_MODEL = 'Xenova/flan-t5-small';
const TEXT_GENERATION_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';
const TEXT_GENERATION_MODEL_NAME = 'SmolLM2 360M Instruct (Transformers.js / ONNX)';

type GenerationMessage = { role: 'system' | 'user' | 'assistant'; content: string };
type ChatGenerationResult = { generated_text: string | GenerationMessage[] };
type ChatGenerationPipeline = (
  messages: GenerationMessage[],
  options: {
    max_new_tokens: number; do_sample: boolean; return_full_text: boolean;
    repetition_penalty: number; no_repeat_ngram_size: number;
  },
) => Promise<ChatGenerationResult[]>;
let textGenerationPipeline: ChatGenerationPipeline | null = null;
let textGenerationPipelinePromise: Promise<ChatGenerationPipeline> | null = null;

let rewritingPipeline: Text2TextPipeline | null = null;
let rewritingPipelinePromise: Promise<Text2TextPipeline> | null = null;

async function loadRewritingPipeline(): Promise<{ generator: Text2TextPipeline; loadMs: number }> {
  if (rewritingPipeline) return { generator: rewritingPipeline, loadMs: 0 };
  const started = now();
  rewritingPipelinePromise ??= import('@huggingface/transformers').then(async ({ pipeline }) => {
    const generator = await pipeline('text2text-generation', REWRITING_MODEL, { dtype: 'q8' });
    return generator as Text2TextPipeline;
  });
  rewritingPipeline = await rewritingPipelinePromise;
  return { generator: rewritingPipeline, loadMs: elapsed(started) };
}

async function loadTextGenerationPipeline(): Promise<{ generator: ChatGenerationPipeline; loadMs: number }> {
  if (textGenerationPipeline) return { generator: textGenerationPipeline, loadMs: 0 };
  const started = now();
  textGenerationPipelinePromise ??= import('@huggingface/transformers').then(async ({ pipeline }) => {
    const generator = await pipeline('text-generation', TEXT_GENERATION_MODEL, { dtype: 'q8', device: 'wasm' });
    return generator as unknown as ChatGenerationPipeline;
  });
  try {
    textGenerationPipeline = await textGenerationPipelinePromise;
  } catch (error) {
    textGenerationPipelinePromise = null;
    throw error;
  }
  return { generator: textGenerationPipeline, loadMs: elapsed(started) };
}

function readChatGeneratedText(raw: ChatGenerationResult[]): string {
  const generated = raw[0]?.generated_text;
  if (typeof generated === 'string') return generated.trim();
  return generated?.filter(message => message.role === 'assistant').at(-1)?.content.trim() ?? '';
}

function readGeneratedText(raw: TextGenerationResult[] | TextGenerationResult): string {
  const first = Array.isArray(raw) ? raw[0] : raw;
  return (first?.generated_text ?? first?.summary_text ?? first?.translation_text ?? '').trim();
}

const PROOFREADING_MODEL = 'rabden/t5-tiny-gec-hone';
let proofreadingPipeline: Text2TextPipeline | null = null;
let proofreadingPipelinePromise: Promise<Text2TextPipeline> | null = null;

async function loadProofreadingPipeline(): Promise<{ corrector: Text2TextPipeline; loadMs: number }> {
  if (proofreadingPipeline) return { corrector: proofreadingPipeline, loadMs: 0 };
  const started = now();
  proofreadingPipelinePromise ??= import('@huggingface/transformers').then(async ({ pipeline }) => {
    const corrector = await pipeline('text2text-generation', PROOFREADING_MODEL, { dtype: 'q8' });
    return corrector as Text2TextPipeline;
  });
  proofreadingPipeline = await proofreadingPipelinePromise;
  return { corrector: proofreadingPipeline, loadMs: elapsed(started) };
}

/** Browser ONNX text-to-text model through Transformers.js. */
export async function runTextRewriting(text: string, backend?: TfBackend): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  const settings = {
    backend: backend ?? 'transformers.js',
    model: REWRITING_MODEL,
    task: 'text_rewriting_model',
  };

  try {
    const { generator, loadMs } = await loadRewritingPipeline();
    const prompt = `Rewrite the following sentence in polished concise English, preserving the original meaning. Return only the rewritten sentence: ${text}`;
    const started = now();
    const raw = await generator(prompt, {
      max_new_tokens: 80,
      do_sample: false,
      num_beams: 4,
    });
    const inferenceMs = elapsed(started);
    const rewritten = readGeneratedText(raw);
    if (!rewritten) throw new Error('?????? ???????????????? ?? ??????? ?????????');

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: rewritten.slice(0, 220),
      model_name: 'FLAN-T5 small rewriting (Transformers.js / ONNX)',
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure('FLAN-T5 small rewriting (Transformers.js / ONNX)', settings, error);
  }
}

type LanguageIdResult = { label: string; score: number };
type LanguageIdPipeline = (
  input: string,
  options?: { topk?: number },
) => Promise<LanguageIdResult[] | LanguageIdResult>;

const LANGUAGE_ID_MODEL = 'onnx-community/xlm-roberta-base-language-detection-ONNX';
let languageIdPipeline: LanguageIdPipeline | null = null;
let languageIdPipelinePromise: Promise<LanguageIdPipeline> | null = null;

async function loadLanguageIdPipeline(): Promise<{ classifier: LanguageIdPipeline; loadMs: number }> {
  if (languageIdPipeline) return { classifier: languageIdPipeline, loadMs: 0 };
  const started = now();
  languageIdPipelinePromise ??= import('@huggingface/transformers').then(async ({ pipeline }) => {
    const classifier = await pipeline('text-classification', LANGUAGE_ID_MODEL, { dtype: 'q8' });
    return classifier as LanguageIdPipeline;
  });
  languageIdPipeline = await languageIdPipelinePromise;
  return { classifier: languageIdPipeline, loadMs: elapsed(started) };
}

export async function runLanguageDetection(text: string, backend?: TfBackend): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  const settings = {
    backend: backend ?? 'transformers.js',
    model: LANGUAGE_ID_MODEL,
    task: 'language_identification_model',
  };

  try {
    const { classifier, loadMs } = await loadLanguageIdPipeline();
    const started = now();
    const raw = await classifier(text, { topk: 1 });
    const inferenceMs = elapsed(started);
    const best = Array.isArray(raw) ? raw[0] : raw;
    if (!best) throw new Error('?????? ??????????? ????? ?? ??????? ?????????');

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: best.label + ', confidence=' + best.score.toFixed(2),
      model_name: 'XLM-RoBERTa language detection (Transformers.js)',
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure('XLM-RoBERTa language detection (Transformers.js)', settings, error);
  }
}

export async function runProofreading(text: string, backend?: TfBackend): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  const settings = {
    backend: backend ?? 'transformers.js',
    model: PROOFREADING_MODEL,
    task: 'grammar_correction_model',
  };

  try {
    const { corrector, loadMs } = await loadProofreadingPipeline();
    const started = now();
    const raw = await corrector(text, {
      max_new_tokens: 120,
      do_sample: false,
      num_beams: 4,
    });
    const inferenceMs = elapsed(started);
    const corrected = readGeneratedText(raw);
    if (!corrected) throw new Error('?????? ???????? ?????????? ?? ??????? ?????????');

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: corrected.slice(0, 220),
      model_name: 'T5 Tiny GEC grammar correction (Transformers.js / ONNX)',
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure('T5 Tiny GEC grammar correction (Transformers.js / ONNX)', settings, error);
  }
}


export async function runTextGeneration(text: string, _backend?: TfBackend): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  const generationOptions = {
    max_new_tokens: 100,
    do_sample: false,
    return_full_text: false,
    repetition_penalty: 1.1,
    no_repeat_ngram_size: 4,
  };
  const settings = {
    backend: 'wasm',
    model: TEXT_GENERATION_MODEL,
    dtype: 'q8',
    task: 'short_text_generation_model',
    ...generationOptions,
  };

  try {
    const prompt = text.trim();
    if (!prompt) throw new Error('Введите инструкцию для генерации текста');
    const { generator, loadMs } = await loadTextGenerationPipeline();
    const started = now();
    const raw = await generator([
      { role: 'system', content: 'You are a helpful assistant. Answer in English in two or three concise sentences.' },
      { role: 'user', content: prompt },
    ], generationOptions);
    const inferenceMs = elapsed(started);
    const generated = readChatGeneratedText(raw);
    if (!generated) throw new Error('Модель вернула пустой текст');

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: generated.slice(0, 220),
      model_name: TEXT_GENERATION_MODEL_NAME,
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(TEXT_GENERATION_MODEL_NAME, settings, error);
  }
}


type TranslationPipelineResult = { translation_text?: string; generated_text?: string };
type TranslationPipeline = (input: string) => Promise<TranslationPipelineResult[] | TranslationPipelineResult>;

const TRANSLATION_MODELS: Record<TranslationDirection, string> = {
  en_ru: 'onnx-community/opus-mt-en-ru',
  ru_en: 'Xenova/opus-mt-ru-en',
};

const translationPipelines: Partial<Record<TranslationDirection, TranslationPipeline>> = {};
const translationPipelinePromises: Partial<Record<TranslationDirection, Promise<TranslationPipeline>>> = {};

async function loadTranslationPipeline(
  direction: TranslationDirection,
): Promise<{ translator: TranslationPipeline; loadMs: number }> {
  if (translationPipelines[direction]) return { translator: translationPipelines[direction], loadMs: 0 };
  const started = now();
  translationPipelinePromises[direction] ??= import('@huggingface/transformers').then(async ({ pipeline }) => {
    const translator = await pipeline('translation', TRANSLATION_MODELS[direction], { dtype: 'q8' });
    return translator as TranslationPipeline;
  });
  translationPipelines[direction] = await translationPipelinePromises[direction];
  return { translator: translationPipelines[direction], loadMs: elapsed(started) };
}

/** Browser ONNX translation model through Transformers.js. */
export async function runTextTranslation(
  text: string,
  backend?: TfBackend,
  direction: TranslationDirection = 'en_ru',
): Promise<RunOutcome> {
  const heapBefore = heapUsedMb();
  const source = parseTranslationSource(text);
  const [sourceLanguage, targetLanguage] = direction.split('_');
  const modelName = `OPUS-MT ${sourceLanguage}->${targetLanguage} (Transformers.js / ONNX)`;
  const settings = {
    backend: backend ?? 'transformers.js',
    model: TRANSLATION_MODELS[direction],
    task: 'translation_model',
    source: sourceLanguage,
    target: targetLanguage,
    direction,
  };

  try {
    const { translator, loadMs } = await loadTranslationPipeline(direction);
    const started = now();
    const raw = await translator(source);
    const inferenceMs = elapsed(started);
    const first = Array.isArray(raw) ? raw[0] : raw;
    const translated = (first?.translation_text ?? first?.generated_text ?? '').trim();
    if (!translated) throw new Error('?????? ???????? ?? ??????? ?????????');

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: translated.slice(0, 220),
      model_name: modelName,
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(modelName, settings, error);
  }
}

export async function runFaceCounting(image: HTMLImageElement, backend?: TfBackend): Promise<RunOutcome> {
  let settings: Record<string, unknown> = {
    backend, task: 'face_counting', runtime: 'tfjs', model_type: 'short', max_faces: 20, model_source: LOCAL_MODELS ? 'local' : 'cdn',
  };
  const heapBefore = heapUsedMb();
  try {
    settings = { ...settings, ...await prepareTfBackend(backend) };
    let loadMs = 0;
    if (!faceDetector) {
      const started = now();
      // TF.js entry avoids bundling the separate MediaPipe runtime.
      const faces = await import('@tensorflow-models/face-detection/dist/tfjs/detector');
      faceDetector = await faces.load({
        runtime: 'tfjs', modelType: 'short', maxFaces: 20,
        ...(LOCAL_MODELS ? { detectorModelUrl: localModel('face-detector') } : {}),
      });
      loadMs = elapsed(started);
    }
    const started = now();
    const faces = await faceDetector.estimateFaces(image, { flipHorizontal: false });
    const inferenceMs = elapsed(started);
    return {
      metrics: withTotal({ load_ms: loadMs, first_token_ms: inferenceMs, inference_ms: inferenceMs, memory_mb: heapDelta(heapBefore) }),
      output_summary: `Лиц: ${faces.length}`,
      model_name: FACE_MODEL_NAME,
      settings: { ...settings, faces_count: faces.length, faces, image_width: image.naturalWidth, image_height: image.naturalHeight },
      status: 'ok',
    };
  } catch (error) {
    return failure(FACE_MODEL_NAME, settings, error);
  }
}

/** Обнаружение нескольких объектов. Рамки сохраняются в настройках результата;
 * общий результат сравнения с Gemini — список классов и количество объектов. */
export async function runObjectDetection(image: HTMLImageElement, backend?: TfBackend): Promise<RunOutcome> {
  let settings: Record<string, unknown> = {
    backend, task: 'object_detection', model_source: LOCAL_MODELS ? 'local' : 'cdn',
    base: 'mobilenet_v2', max_objects: 20, min_score: 0.5,
  };
  const heapBefore = heapUsedMb();
  try {
    settings = { ...settings, ...await prepareTfBackend(backend) };
    let loadMs = 0;
    if (!objectDetectionModel) {
      const started = now();
      const cocoSsd = await import('@tensorflow-models/coco-ssd');
      objectDetectionModel = await cocoSsd.load({ base: 'mobilenet_v2',
        ...(LOCAL_MODELS ? { modelUrl: localModel('coco-ssd') } : {}) });
      loadMs = elapsed(started);
    }
    const started = now();
    const predictions = await objectDetectionModel.detect(image, 20, 0.5);
    const inferenceMs = elapsed(started);
    const counts = new Map<string, number>();
    for (const prediction of predictions) counts.set(prediction.class, (counts.get(prediction.class) ?? 0) + 1);
    return {
      metrics: withTotal({ load_ms: loadMs, first_token_ms: inferenceMs, inference_ms: inferenceMs, memory_mb: heapDelta(heapBefore) }),
      output_summary: formatObjectCounts(Object.fromEntries(counts)),
      model_name: COCO_SSD_MODEL_NAME,
      settings: { ...settings, objects_count: predictions.length, objects: predictions, image_width: image.naturalWidth, image_height: image.naturalHeight },
      status: 'ok',
    };
  } catch (error) {
    return failure(COCO_SSD_MODEL_NAME, settings, error);
  }
}

/** Эксперимент 2: классификация изображения, топ-1 класс ImageNet. */
export async function runImageClassification(image: HTMLImageElement, backend?: TfBackend): Promise<RunOutcome> {
  if (backend) {
    if (!(await setBackend(backend))) {
      return failure(MOBILENET_MODEL_NAME, { backend }, new Error(`Бэкенд ${backend} недоступен`));
    }
  } else await ensureBenchmarkBackend();
  await ensureTensorFlowReady();
  const heapBefore = heapUsedMb();
  const settings = { backend: currentBackend(), model_source: LOCAL_MODELS ? 'local' : 'cdn' };

  try {
    const loadMs = await loadMobilenet();
    if (!mobilenetModel) throw new Error('MobileNet не загрузился');

    const started = now();
    const predictions = await mobilenetModel.classify(image, 3);
    const inferenceMs = elapsed(started);

    const top = predictions[0];
    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: inferenceMs,
        inference_ms: inferenceMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: top
        ? `${top.className} (${(top.probability * 100).toFixed(1)} %)`
        : 'Классы не определены',
      model_name: MOBILENET_MODEL_NAME,
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(MOBILENET_MODEL_NAME, settings, error);
  }
}

/** Эксперимент 3: тот же инференс на конкретном ускорителе.
 *  Встроенная парадигма такой настройки не даёт, поэтому эксперимент
 *  выполняется только для TensorFlow.js. */
export async function runOnBackend(image: HTMLImageElement, backend: TfBackend): Promise<RunOutcome> {
  const switched = await setBackend(backend);
  if (!switched) {
    return {
      metrics: {},
      output_summary: '',
      model_name: MOBILENET_MODEL_NAME,
      settings: { backend, model_source: LOCAL_MODELS ? 'local' : 'cdn' },
      status: 'unsupported',
      error_message: `Бэкенд ${backend} недоступен в этом браузере`,
    };
  }

  // Смена бэкенда обесценивает скомпилированные ядра: модель перезагружаем.
  mobilenetModel = null;
  const outcome = await runImageClassification(image);
  return { ...outcome, settings: { ...outcome.settings, backend } };
}

function failure(modelName: string, settings: Record<string, unknown>, error: unknown): RunOutcome {
  return {
    metrics: {},
    output_summary: '',
    model_name: modelName,
    settings,
    status: 'error',
    error_message: error instanceof Error ? error.message : String(error),
  };
}
