/** Встроенная парадигма: Gemini Nano через Prompt API браузера.
 *
 *  Состояние API на сентябрь 2026. Для веба он стабилен начиная с Chrome 148
 *  и живёт в глобальном объекте LanguageModel; флаги больше не нужны.
 *  В расширениях доступен с Chrome 138. В более ранних сборках API лежал в
 *  window.ai.languageModel с методом capabilities() — адаптер понимает и эту
 *  форму, чтобы стенд запускался на машине с отстающим браузером.
 *
 *  Два ограничения, которые важны для методики эксперимента.
 *
 *  Первое: список языков. Prompt API принимает en, ja, es, de и fr. Русского
 *  среди них нет, на русский вход браузер отвечает NotSupportedError. Поэтому
 *  сравнительные прогоны идут на английском тексте — иначе сравнивались бы не
 *  парадигмы, а наличие языка в списке поддерживаемых.
 *
 *  Второе: temperature и topK доступны только расширениям. На вебе сессия
 *  создаётся с параметрами модели по умолчанию, и это фиксируется в настройках
 *  прогона, чтобы числа не выглядели снятыми при произвольной температуре.
 */

import { elapsed, heapDelta, heapUsedMb, now, withTotal } from '../benchmark/metrics';
import type { RunOutcome, TranslationDirection } from '../benchmark/types';

export const NANO_MODEL_NAME = 'Gemini Nano (Chrome Prompt API)';

/** Языки, которые принимает Prompt API. Русского в списке нет. */
export const SUPPORTED_LANGUAGES = ['en', 'ja', 'es', 'de', 'fr'] as const;

export type NanoAvailability = 'available' | 'downloadable' | 'downloading' | 'unavailable';

interface NanoSession {
  prompt(input: unknown, options?: unknown): Promise<string>;
  promptStreaming?(input: unknown, options?: unknown): ReadableStream<string> | AsyncIterable<string>;
  destroy?(): void;
}

interface NanoApi {
  availability?(options?: unknown): Promise<string>;
  capabilities?(): Promise<{ available: string }>;
  params?(): Promise<{ defaultTopK?: number; defaultTemperature?: number }>;
  create(options?: unknown): Promise<NanoSession>;
}

export interface NanoDownloadProgress {
  loaded: number;
}

type Globals = typeof globalThis & {
  LanguageModel?: NanoApi;
  ai?: { languageModel?: NanoApi };
  Summarizer?: {
    availability?(options?: unknown): Promise<string>;
    create(options?: unknown): Promise<{ summarize(input: string): Promise<string>; destroy?(): void }>;
  };
  Rewriter?: {
    availability?(options?: unknown): Promise<string>;
    create(options?: unknown): Promise<{ rewrite(input: string): Promise<string>; destroy?(): void }>;
  };
  Writer?: {
    availability?(options?: unknown): Promise<string>;
    create(options?: unknown): Promise<{ write(input: string): Promise<string>; destroy?(): void }>;
  };
  Proofreader?: {
    availability?(options?: unknown): Promise<string>;
    create(options?: unknown): Promise<{ proofread?(input: string): Promise<string>; correct?(input: string): Promise<string>; destroy?(): void }>;
  };
  LanguageDetector?: {
    availability?(options?: unknown): Promise<string>;
    create(options?: unknown): Promise<{ detect(input: string): Promise<Array<{ detectedLanguage?: string; language?: string; confidence?: number }>>; destroy?(): void }>;
  };
  Translator?: {
    availability?(options?: unknown): Promise<string>;
    create(options?: unknown): Promise<{ translate(input: string): Promise<string>; destroy?(): void }>;
  };
};

type TranslatorSession = { translate(input: string): Promise<string>; destroy?(): void };
const translatorSessions: Partial<Record<TranslationDirection, TranslatorSession>> = {};

/** Возвращает Prompt API в той форме, в какой его отдаёт этот браузер. */
export function getApi(): NanoApi | null {
  const g = globalThis as Globals;
  if (g.LanguageModel && typeof g.LanguageModel.create === 'function') return g.LanguageModel;
  if (g.ai?.languageModel && typeof g.ai.languageModel.create === 'function') return g.ai.languageModel;
  return null;
}

/** Приводит ответы обеих версий API к единому набору значений. */
export async function checkAvailability(withImage = false): Promise<NanoAvailability> {
  const api = getApi();
  if (!api) return 'unavailable';

  const expectedInputs: Record<string, unknown>[] = [{ type: 'text', languages: ['en'] }];
  if (withImage) expectedInputs.push({ type: 'image' });

  try {
    if (typeof api.availability === 'function') {
      let value: string;
      try {
        value = await api.availability({
          expectedInputs,
          expectedOutputs: [{ type: 'text', languages: ['en'] }],
        });
      } catch {
        // Ранние сборки не принимали аргументов у availability()
        value = await api.availability();
      }
      if (value === 'available' || value === 'readily') return 'available';
      if (value === 'downloadable' || value === 'after-download') return 'downloadable';
      if (value === 'downloading') return 'downloading';
      return 'unavailable';
    }
    if (typeof api.capabilities === 'function') {
      const caps = await api.capabilities();
      if (caps.available === 'readily') return 'available';
      if (caps.available === 'after-download') return 'downloadable';
      return 'unavailable';
    }
  } catch {
    return 'unavailable';
  }
  return 'unavailable';
}

/** Запускает загрузку модели из пользовательского действия. */
export async function downloadModel(
  onProgress?: (progress: NanoDownloadProgress) => void,
  signal?: AbortSignal,
): Promise<NanoAvailability> {
  const api = getApi();
  if (!api) return 'unavailable';

  const session = await api.create({
      signal,
      expectedInputs: [{ type: 'text', languages: ['en'] }],
      expectedOutputs: [{ type: 'text', languages: ['en'] }],
      monitor(monitor: { addEventListener?: (type: string, listener: (event: { loaded?: number }) => void) => void }) {
        monitor.addEventListener?.('downloadprogress', (event) => {
          if (!signal?.aborted && Number.isFinite(event.loaded)) {
            onProgress?.({ loaded: Math.max(0, Math.min(1, event.loaded!)) });
          }
        });
      },
    });
  session.destroy?.();
  signal?.throwIfAborted();
  return checkAvailability();
}

/** Человеческое объяснение статуса — выводится прямо в карточке эксперимента. */
export function availabilityHint(state: NanoAvailability): string {
  switch (state) {
    case 'available':
      return 'Модель готова к работе';
    case 'downloadable':
      return 'Модель ещё не скачана. Загрузка начнётся автоматически после взаимодействия со страницей';
    case 'downloading':
      return 'Chrome сейчас качает веса модели, дождитесь окончания';
    default:
      return (
        'Prompt API недоступен. Нужен Chrome 148 или новее, 22 ГБ свободного диска и ' +
        'либо видеокарта с более чем 4 ГБ видеопамяти, либо 16 ГБ оперативной памяти при четырёх и более ядрах'
      );
  }
}

/** Текст содержит кириллицу — значит, встроенная модель его не примет. */
export const hasCyrillic = (text: string): boolean => /[Ѐ-ӿ]/.test(text);

interface CreateOptions {
  systemPrompt: string;
  expectImage?: boolean;
}

async function createSession(api: NanoApi, options: CreateOptions): Promise<NanoSession> {
  const expectedInputs: Record<string, unknown>[] = [{ type: 'text', languages: ['en'] }];
  if (options.expectImage) expectedInputs.push({ type: 'image' });

  const config: Record<string, unknown> = {
    expectedInputs,
    expectedOutputs: [{ type: 'text', languages: ['en'] }],
    initialPrompts: [{ role: 'system', content: options.systemPrompt }],
  };

  try {
    return await api.create(config);
  } catch {
    // Старая форма: systemPrompt отдельным полем, expectedInputs не понимает
    return api.create({ systemPrompt: options.systemPrompt });
  }
}

/** Время до первого фрагмента ответа — прямой аналог метрики
 *  «время до первого предсказания» из теоретической части.
 *  promptStreaming() отдаёт ReadableStream, который в Chrome работает
 *  как асинхронный итератор. */
async function streamWithFirstChunk(
  session: NanoSession,
  input: unknown,
): Promise<{ text: string; firstChunkMs: number; totalMs: number }> {
  const started = now();

  if (typeof session.promptStreaming === 'function') {
    const stream = session.promptStreaming(input);
    const iterable = stream as AsyncIterable<string>;
    if (typeof iterable[Symbol.asyncIterator] === 'function') {
      let firstChunkMs = 0;
      let text = '';
      for await (const chunk of iterable) {
        if (!firstChunkMs) firstChunkMs = elapsed(started);
        text += chunk;
      }
      return { text, firstChunkMs, totalMs: elapsed(started) };
    }
  }

  const text = await session.prompt(input);
  const totalMs = elapsed(started);
  return { text, firstChunkMs: totalMs, totalMs };
}

/** На вебе параметры модели закрыты, поэтому пишем в настройки прогона то,
 *  что есть на самом деле: значения по умолчанию. */
const WEB_SETTINGS = {
  parameters: 'по умолчанию, temperature и topK на вебе недоступны',
  streaming: true,
  language: 'en',
};

async function runPromptTask(
  text: string,
  systemPrompt: string,
  userPrompt: string,
  task: string,
): Promise<RunOutcome> {
  const settings = { ...WEB_SETTINGS, task, api: 'LanguageModel', input_language: hasCyrillic(text) ? 'ru' : 'en' };
  const api = getApi();
  if (!api) return unsupported(settings, availabilityHint('unavailable'));

  const state = await checkAvailability();
  if (state === 'unavailable') return unsupported(settings, availabilityHint(state));
  if (state === 'downloading') return unsupported(settings, availabilityHint(state));

  const heapBefore = heapUsedMb();
  let session: NanoSession | null = null;

  try {
    const createStarted = now();
    session = await createSession(api, { systemPrompt });
    const loadMs = elapsed(createStarted);

    const { text: answer, firstChunkMs, totalMs } = await streamWithFirstChunk(session, userPrompt);

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: firstChunkMs,
        inference_ms: totalMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: answer.trim().slice(0, 220),
      model_name: NANO_MODEL_NAME,
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(settings, error);
  } finally {
    session?.destroy?.();
  }
}

const unsupported = (settings: Record<string, unknown>, message: string): RunOutcome => ({
  metrics: {},
  output_summary: '',
  model_name: NANO_MODEL_NAME,
  settings,
  status: 'unsupported',
  error_message: message,
});

const failure = (settings: Record<string, unknown>, error: unknown): RunOutcome => {
  const message = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.name : '';
  // NotSupportedError — штатный ответ на неподдерживаемый язык или модальность,
  // это результат эксперимента, а не сбой стенда.
  if (
    name === 'NotSupportedError' ||
    /not ?supported|on-device model is not available|only available in chrome/i.test(message)
  ) {
    return unsupported(settings, message);
  }
  return {
    metrics: {},
    output_summary: '',
    model_name: NANO_MODEL_NAME,
    settings,
    status: 'error',
    error_message: message,
  };
};

/** Эксперимент 1: классификация тональности текста.
 *  Вход тот же, что получает TensorFlow.js. */
export async function runTextClassification(text: string): Promise<RunOutcome> {
  const settings = { ...WEB_SETTINGS, input_language: hasCyrillic(text) ? 'ru' : 'en' };
  const api = getApi();
  if (!api) return unsupported(settings, availabilityHint('unavailable'));

  const state = await checkAvailability();
  if (state === 'unavailable') return unsupported(settings, availabilityHint(state));
  if (state === 'downloading') return unsupported(settings, availabilityHint(state));

  const heapBefore = heapUsedMb();
  let session: NanoSession | null = null;

  try {
    const createStarted = now();
    session = await createSession(api, {
      systemPrompt:
        'You are a sentiment classifier. Reply with exactly one word: positive, negative or neutral. No explanation.',
    });
    const loadMs = elapsed(createStarted);

    const { text: answer, firstChunkMs, totalMs } = await streamWithFirstChunk(
      session,
      `Classify the sentiment of this text: ${text}`,
    );

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: firstChunkMs,
        inference_ms: totalMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: `Тональность ${answer.trim().toLowerCase().slice(0, 60)}`,
      model_name: NANO_MODEL_NAME,
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(settings, error);
  } finally {
    session?.destroy?.();
  }
}

export async function runTextModeration(text: string): Promise<RunOutcome> {
  return runPromptTask(
    text,
    'You are a content moderation classifier. Return only compact JSON with keys toxic, insult, threat, obscene, identity_attack and a final label. Use boolean values. No explanation.',
    `Classify this text for toxicity and safety categories. Return compact JSON only:

${text}`,
    'toxicity_classification_prompt',
  );
}

export async function runQuestionAnswering(text: string): Promise<RunOutcome> {
  return runPromptTask(
    text,
    'You answer questions using only the provided context. Return the shortest exact answer phrase. If the answer is absent, reply: not found.',
    `Answer the question using only the context below. Return only the answer phrase.

${text}`,
    'question_answering_prompt',
  );
}


export async function runTextSummarization(text: string): Promise<RunOutcome> {
  const globals = globalThis as Globals;
  const summarizerApi = globals.Summarizer;
  const settings = { ...WEB_SETTINGS, task: 'summarization', api: 'Summarizer', input_language: hasCyrillic(text) ? 'ru' : 'en' };

  if (summarizerApi && typeof summarizerApi.create === 'function') {
    const heapBefore = heapUsedMb();
    let summarizer: { summarize(input: string): Promise<string>; destroy?(): void } | null = null;
    let outcome: RunOutcome | null = null;
    try {
      const createStarted = now();
      summarizer = await summarizerApi.create({
        type: 'key-points',
        format: 'plain-text',
        length: 'short',
        expectedInputLanguages: ['en'],
      });
      const loadMs = elapsed(createStarted);
      const started = now();
      const answer = await summarizer.summarize(text);
      const totalMs = elapsed(started);
      outcome = {
        metrics: withTotal({
          load_ms: loadMs,
          first_token_ms: totalMs,
          inference_ms: totalMs,
          memory_mb: heapDelta(heapBefore),
        }),
        output_summary: answer.trim().slice(0, 220),
        model_name: NANO_MODEL_NAME,
        settings,
        status: 'ok',
      };
    } catch {
      outcome = null;
    } finally {
      summarizer?.destroy?.();
    }
    if (outcome) return outcome;
  }

  return runPromptTask(
    text,
    'You summarize short product and engineering texts. Return two concise bullet-like sentences. No preamble.',
    `Summarize this text in two concise sentences:\n\n${text}`,
    'summarization_prompt_fallback',
  );
}

export async function runSemanticSearch(text: string): Promise<RunOutcome> {
  return runPromptTask(
    text,
    'You are a semantic search ranker. Choose the single most relevant document. Reply with the document letter and a short reason.',
    `Given a query and candidate documents, choose the most relevant document. Reply briefly.\n\n${text}`,
    'semantic_search_prompt',
  );
}

export async function runTextRewriting(text: string): Promise<RunOutcome> {
  const globals = globalThis as Globals;
  const rewriterApi = globals.Rewriter;
  const settings = { ...WEB_SETTINGS, task: 'rewriting', api: 'Rewriter', input_language: hasCyrillic(text) ? 'ru' : 'en' };

  if (rewriterApi && typeof rewriterApi.create === 'function') {
    const heapBefore = heapUsedMb();
    let rewriter: { rewrite(input: string): Promise<string>; destroy?(): void } | null = null;
    let outcome: RunOutcome | null = null;
    try {
      const createStarted = now();
      rewriter = await rewriterApi.create({
        tone: 'more-formal',
        length: 'as-is',
        expectedInputLanguages: ['en'],
      });
      const loadMs = elapsed(createStarted);
      const started = now();
      const answer = await rewriter.rewrite(text);
      const totalMs = elapsed(started);
      outcome = {
        metrics: withTotal({
          load_ms: loadMs,
          first_token_ms: totalMs,
          inference_ms: totalMs,
          memory_mb: heapDelta(heapBefore),
        }),
        output_summary: answer.trim().slice(0, 220),
        model_name: NANO_MODEL_NAME,
        settings,
        status: 'ok',
      };
    } catch {
      outcome = null;
    } finally {
      rewriter?.destroy?.();
    }
    if (outcome) return outcome;
  }

  return runPromptTask(
    text,
    'You rewrite short text while preserving its meaning. Return only the rewritten text.',
    `Rewrite this sentence in a polished but concise way:\n\n${text}`,
    'rewriting_prompt_fallback',
  );
}

export async function runLanguageDetection(text: string): Promise<RunOutcome> {
  const globals = globalThis as Globals;
  const languageDetectorApi = globals.LanguageDetector;
  const settings = { task: 'language_detection', api: 'LanguageDetector' };

  if (!languageDetectorApi || typeof languageDetectorApi.create !== 'function') {
    return unsupported(settings, 'LanguageDetector API не объявлен в этом браузере');
  }

  const heapBefore = heapUsedMb();
  let detector: { detect(input: string): Promise<Array<{ detectedLanguage?: string; language?: string; confidence?: number }>>; destroy?(): void } | null = null;

  try {
    const createStarted = now();
    detector = await languageDetectorApi.create();
    const loadMs = elapsed(createStarted);
    const started = now();
    const results = await detector.detect(text);
    const totalMs = elapsed(started);
    const best = results[0];
    const language = best?.detectedLanguage ?? best?.language ?? 'unknown';
    const confidence = Number.isFinite(best?.confidence) ? `, confidence=${best!.confidence!.toFixed(2)}` : '';

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: totalMs,
        inference_ms: totalMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: `${language}${confidence}`,
      model_name: 'LanguageDetector API (Chrome Built-in AI)',
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(settings, error);
  } finally {
    detector?.destroy?.();
  }
}

export async function runProofreading(text: string): Promise<RunOutcome> {
  const globals = globalThis as Globals;
  const proofreaderApi = globals.Proofreader;
  const settings = { ...WEB_SETTINGS, task: 'proofreading', api: 'Proofreader', input_language: hasCyrillic(text) ? 'ru' : 'en' };

  if (proofreaderApi && typeof proofreaderApi.create === 'function') {
    const heapBefore = heapUsedMb();
    let proofreader: { proofread?(input: string): Promise<string>; correct?(input: string): Promise<string>; destroy?(): void } | null = null;
    let outcome: RunOutcome | null = null;
    try {
      const createStarted = now();
      proofreader = await proofreaderApi.create({ expectedInputLanguages: ['en'] });
      const loadMs = elapsed(createStarted);
      const started = now();
      const answer = typeof proofreader.proofread === 'function'
        ? await proofreader.proofread(text)
        : await proofreader.correct!(text);
      const totalMs = elapsed(started);
      outcome = {
        metrics: withTotal({
          load_ms: loadMs,
          first_token_ms: totalMs,
          inference_ms: totalMs,
          memory_mb: heapDelta(heapBefore),
        }),
        output_summary: answer.trim().slice(0, 220),
        model_name: NANO_MODEL_NAME,
        settings,
        status: 'ok',
      };
    } catch {
      outcome = null;
    } finally {
      proofreader?.destroy?.();
    }
    if (outcome) return outcome;
  }

  return runPromptTask(
    text,
    'You are a careful proofreader. Correct grammar and spelling. Return only the corrected text.',
    `Correct grammar and spelling in this text:\n\n${text}`,
    'proofreading_prompt_fallback',
  );
}

export async function runTextGeneration(text: string): Promise<RunOutcome> {
  const globals = globalThis as Globals;
  const writerApi = globals.Writer;
  const settings = { ...WEB_SETTINGS, task: 'text_generation', api: 'Writer', input_language: hasCyrillic(text) ? 'ru' : 'en' };

  if (writerApi && typeof writerApi.create === 'function') {
    const heapBefore = heapUsedMb();
    let writer: { write(input: string): Promise<string>; destroy?(): void } | null = null;
    let outcome: RunOutcome | null = null;
    try {
      const createStarted = now();
      writer = await writerApi.create({
        tone: 'neutral',
        format: 'plain-text',
        length: 'short',
        expectedInputLanguages: ['en'],
        expectedOutputLanguages: ['en'],
      });
      const loadMs = elapsed(createStarted);
      const started = now();
      const answer = await writer.write(text);
      const totalMs = elapsed(started);
      outcome = {
        metrics: withTotal({
          load_ms: loadMs,
          first_token_ms: totalMs,
          inference_ms: totalMs,
          memory_mb: heapDelta(heapBefore),
        }),
        output_summary: answer.trim().slice(0, 220),
        model_name: NANO_MODEL_NAME,
        settings,
        status: 'ok',
      };
    } catch {
      outcome = null;
    } finally {
      writer?.destroy?.();
    }
    if (outcome) return outcome;
  }

  return runPromptTask(
    text,
    'You write concise benchmark notes for browser machine learning experiments. Return one short paragraph.',
    `Write a short benchmark note from this instruction:\n\n${text}`,
    'writing_prompt_fallback',
  );
}

function parseTranslationText(text: string): string {
  return (
    text.match(/(?:^|\n)\s*(?:Text|Source):\s*(.+?)(?:\n\s*\n|$)/is)?.[1]?.trim() ||
    text.split(/\n+/)[0]?.replace(/^(Text|Source):\s*/i, '').trim() ||
    text.trim()
  );
}

function languagesFromDirection(direction: TranslationDirection): { sourceLanguage: 'en' | 'ru'; targetLanguage: 'en' | 'ru' } {
  return direction === 'ru_en'
    ? { sourceLanguage: 'ru', targetLanguage: 'en' }
    : { sourceLanguage: 'en', targetLanguage: 'ru' };
}

export async function runTextTranslation(
  text: string,
  direction: TranslationDirection = 'en_ru',
): Promise<RunOutcome> {
  const globals = globalThis as Globals;
  const translatorApi = globals.Translator;
  const source = parseTranslationText(text);
  const { sourceLanguage, targetLanguage } = languagesFromDirection(direction);
  const settings = { task: 'translation', api: 'Translator', source: sourceLanguage, target: targetLanguage, direction };

  if (!translatorApi || typeof translatorApi.create !== 'function') {
    return unsupported(settings, 'Translator API не объявлен в этом браузере');
  }

  const heapBefore = heapUsedMb();
  let translator: TranslatorSession | null = null;

  try {
    const createStarted = now();
    translator = translatorSessions[direction] ?? await translatorApi.create({ sourceLanguage, targetLanguage });
    translatorSessions[direction] ??= translator;
    const loadMs = elapsed(createStarted);
    const started = now();
    const answer = await translator.translate(source);
    const totalMs = elapsed(started);

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: totalMs,
        inference_ms: totalMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: answer.trim().slice(0, 220),
      model_name: 'Translator API (Chrome Built-in AI)',
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(settings, error);
  } finally {
    // Translator may require a user gesture to create while the language pack is
    // downloadable. Keep the session for repeated benchmark runs.
  }
}

export async function prepareTranslator(
  direction: TranslationDirection = 'en_ru',
  onProgress?: (progress: number) => void,
): Promise<void> {
  if (translatorSessions[direction]) return;
  const globals = globalThis as Globals;
  const translatorApi = globals.Translator;
  if (!translatorApi || typeof translatorApi.create !== 'function') return;
  const { sourceLanguage, targetLanguage } = languagesFromDirection(direction);
  translatorSessions[direction] = await translatorApi.create({
    sourceLanguage,
    targetLanguage,
    monitor(monitor: { addEventListener?: (type: string, listener: (event: { loaded?: number }) => void) => void }) {
      monitor.addEventListener?.('downloadprogress', (event) => {
        if (Number.isFinite(event.loaded)) onProgress?.(Math.max(0, Math.min(1, event.loaded!)));
      });
    },
  });
}

export const prepareTranslatorEnRu = (onProgress?: (progress: number) => void): Promise<void> =>
  prepareTranslator('en_ru', onProgress);

/** Эксперимент 2: распознавание изображения.
 *  Мультимодальный вход объявляется через expectedInputs. Если сборка Chrome
 *  его не принимает, прогон получает статус «не поддерживается» — для
 *  экспериментальной главы это такой же результат, как число. */
export async function runImageClassification(image: HTMLImageElement): Promise<RunOutcome> {
  const settings = { ...WEB_SETTINGS, multimodal: 'image' };
  const api = getApi();
  if (!api) return unsupported(settings, availabilityHint('unavailable'));

  const state = await checkAvailability(true);
  if (state === 'unavailable') {
    return unsupported(settings, 'Мультимодальный вход недоступен: ' + availabilityHint(state));
  }
  if (state === 'downloading') return unsupported(settings, availabilityHint(state));

  const heapBefore = heapUsedMb();
  let session: NanoSession | null = null;
  let bitmap: ImageBitmap | null = null;

  try {
    const createStarted = now();
    session = await createSession(api, {
      systemPrompt: 'You name the main object in an image. Reply with one word or a short phrase.',
      expectImage: true,
    });
    const loadMs = elapsed(createStarted);

    // ImageBitmap снимает зависимость от того, дорисован ли элемент на странице.
    bitmap = await createImageBitmap(image);
    const { text: answer, firstChunkMs, totalMs } = await streamWithFirstChunk(session, [
      {
        role: 'user',
        content: [
          { type: 'text', value: 'What is the main object in this image? Answer briefly.' },
          { type: 'image', value: bitmap },
        ],
      },
    ]);

    return {
      metrics: withTotal({
        load_ms: loadMs,
        first_token_ms: firstChunkMs,
        inference_ms: totalMs,
        memory_mb: heapDelta(heapBefore),
      }),
      output_summary: answer.trim().slice(0, 120),
      model_name: NANO_MODEL_NAME,
      settings,
      status: 'ok',
    };
  } catch (error) {
    return failure(settings, error);
  } finally {
    bitmap?.close();
    session?.destroy?.();
  }
}
