/** Оркестратор прогонов.
 *
 *  Серия из нескольких повторов — не прихоть: первый вызов любого бэкенда
 *  компилирует шейдеры и всегда выпадает из общей картины, а разброс между
 *  повторами нужен, чтобы в главе стояли медиана и стандартное отклонение,
 *  а не одно случайное число.
 */

import { collectEnvironment, elapsed, now } from './metrics';
import type { ExperimentDefinition } from './experiments';
import { probeBuiltinApis } from '../models/builtinAi';
import * as tfjs from '../models/tensorflow';
import type { Approach, ExperimentInput, MeasurementPayload, TranslationDirection } from './types';
import type { TfBackend } from '../models/tensorflow';

/** Замер в фоновой вкладке недействителен.
 *
 *  Проверено на практике: при свёрнутой или неактивной вкладке Chrome душит
 *  рендеринг, и прогон MobileNet на бэкенде WebGL просто не завершается —
 *  ожидание уходит за минуты. WebGPU при этом считает нормально. Чтобы в
 *  датасет не попадали числа, снятые в разных условиях, стенд отказывается
 *  запускать серию, пока вкладка не на переднем плане. */
export class HiddenTabError extends Error {
  constructor() {
    super(
      'Вкладка не активна. Браузер ограничивает рендеринг в фоне, и замеры WebGL становятся ' +
        'недействительными. Переключитесь на вкладку стенда и повторите запуск.',
    );
    this.name = 'HiddenTabError';
  }
}

export const isTabVisible = (): boolean => document.visibilityState === 'visible';

export interface RunnerOptions {
  /** Сколько раз повторить прогон каждой парадигмы. */
  repeats: number;
  /** Отбросить первый прогон как прогревочный. */
  discardFirst: boolean;
  /** Backend TensorFlow.js, выбранные в селекторе. */
  selectedBackends: TfBackend[];
  /** Запускать все доступные backend вместо точечного списка. */
  allBackends: boolean;
  /** Запускать ли Gemini Nano, если эксперимент его поддерживает. */
  includeGeminiNano: boolean;
  /** Запускать ли библиотечную модель без выбора backend, например ONNX. */
  includeLibraryModel: boolean;
  /** Направление перевода для эксперимента перевода текста. */
  translationDirection: TranslationDirection;
  onProgress?: (message: string) => void;
}

export const DEFAULT_OPTIONS: RunnerOptions = {
  repeats: 5,
  discardFirst: true,
  selectedBackends: [],
  allBackends: true,
  includeGeminiNano: false,
  includeLibraryModel: true,
  translationDirection: 'en_ru',
};

/** Выполняет эксперимент и возвращает набор измерений, готовый к отправке. */
export async function runExperiment(
  experiment: ExperimentDefinition,
  input: ExperimentInput,
  options: RunnerOptions = DEFAULT_OPTIONS,
): Promise<MeasurementPayload[]> {
  if (!isTabVisible()) throw new HiddenTabError();

  const environment = await collectEnvironment();
  const payloads: MeasurementPayload[] = [];
  const inputSummary = summarizeInput(input);

  if (experiment.sweepsBackends) {
    const available = await tfjs.availableBackends();
    const backends = selectBackends(available, options);
    options.onProgress?.(`Доступные бэкенды: ${backends.join(', ') || 'не найдено'}`);

    for (const backend of backends) {
      for (let attempt = 0; attempt < totalAttempts(options); attempt += 1) {
        options.onProgress?.(`${backend}: прогон ${attempt + 1} из ${totalAttempts(options)}`);
        const outcome = await tfjs.runOnBackend(
          (input as Extract<ExperimentInput, { kind: 'image' }>).element,
          backend,
        );
        if (skip(attempt, options)) continue;
        payloads.push({
          experiment_key: experiment.key,
          experiment_title: experiment.title,
          approach: 'tensorflow_js',
          model_name: outcome.model_name,
          settings: outcome.settings,
          metrics: outcome.metrics,
          environment,
          input_summary: inputSummary,
          output_summary: outcome.output_summary,
          status: outcome.status,
          error_message: outcome.error_message ?? null,
        });
      }
    }
    return payloads;
  }

  const approaches: Approach[] = [];
  if (experiment.approaches.includes('tensorflow_js')) {
    if (experiment.usesTensorFlowBackends === false) {
      if (options.includeLibraryModel) {
        for (let attempt = 0; attempt < totalAttempts(options); attempt += 1) {
          options.onProgress?.(`${experiment.libraryLabel ?? 'library'}: прогон ${attempt + 1} из ${totalAttempts(options)}`);
          const outcome = await experiment.run('tensorflow_js', input, undefined, {
            translationDirection: options.translationDirection,
          });
          if (skip(attempt, options)) continue;
          payloads.push(toPayload(experiment, 'tensorflow_js', outcome, environment, inputSummary));
        }
      }
    } else {
      const available = await tfjs.availableBackends();
      const backends = selectBackends(available, options);
      for (const backend of backends) {
        for (let attempt = 0; attempt < totalAttempts(options); attempt += 1) {
          options.onProgress?.(`${backend}: прогон ${attempt + 1} из ${totalAttempts(options)}`);
          const outcome = await experiment.run('tensorflow_js', input, backend, {
            translationDirection: options.translationDirection,
          });
          if (skip(attempt, options)) continue;
          payloads.push(toPayload(experiment, 'tensorflow_js', outcome, environment, inputSummary));
        }
      }
    }
  }
  if (experiment.approaches.includes('gemini_nano') && options.includeGeminiNano) {
    approaches.push('gemini_nano');
  }

  for (const approach of approaches) {
    for (let attempt = 0; attempt < totalAttempts(options); attempt += 1) {
      options.onProgress?.(`${label(approach)}: прогон ${attempt + 1} из ${totalAttempts(options)}`);
      const outcome = await experiment.run(approach, input, undefined, {
        translationDirection: options.translationDirection,
      });

      // Недоступную парадигму записываем один раз: повторять нечего.
      if (outcome.status === 'unsupported') {
        if (attempt === 0) {
          payloads.push(toPayload(experiment, approach, outcome, environment, inputSummary));
        }
        break;
      }

      if (skip(attempt, options)) continue;
      payloads.push(toPayload(experiment, approach, outcome, environment, inputSummary));
    }
  }

  return payloads;
}

function selectBackends(available: TfBackend[], options: RunnerOptions): TfBackend[] {
  if (options.allBackends) return available;
  return available.filter((backend) => options.selectedBackends.includes(backend));
}

const totalAttempts = (options: RunnerOptions): number =>
  options.repeats + (options.discardFirst ? 1 : 0);

const skip = (attempt: number, options: RunnerOptions): boolean =>
  options.discardFirst && attempt === 0;

const label = (approach: Approach): string =>
  approach === 'tensorflow_js' ? 'TensorFlow.js' : 'Gemini Nano';

function toPayload(
  experiment: ExperimentDefinition,
  approach: Approach,
  outcome: Awaited<ReturnType<ExperimentDefinition['run']>>,
  environment: MeasurementPayload['environment'],
  inputSummary: string,
): MeasurementPayload {
  return {
    experiment_key: experiment.key,
    experiment_title: experiment.title,
    approach,
    model_name: outcome.model_name,
    settings: outcome.settings,
    metrics: outcome.metrics,
    environment,
    input_summary: inputSummary,
    output_summary: outcome.output_summary,
    status: outcome.status,
    error_message: outcome.error_message ?? null,
  };
}

function summarizeInput(input: ExperimentInput): string {
  if (input.kind === 'text') {
    const words = input.text.trim().split(/\s+/).length;
    return `Текст, ${input.text.length} символов, ${words} слов`;
  }
  return `Изображение ${input.label}, ${input.element.naturalWidth}x${input.element.naturalHeight}`;
}


/** Диагностика встроенных ИИ-API: какие из них браузер вообще объявил и что
 *  отвечает availability(). Результат ложится в ту же таблицу измерений,
 *  по строке на API, и выгружается вместе с остальным датасетом. */
export async function probeEnvironment(): Promise<MeasurementPayload[]> {
  const environment = await collectEnvironment();
  const started = now();
  const probes = await probeBuiltinApis();
  const totalMs = elapsed(started);

  return probes.map((probe) => ({
    experiment_key: 'builtin_availability',
    experiment_title: 'Доступность встроенных ИИ-API браузера',
    approach: 'gemini_nano' as Approach,
    model_name: `${probe.api} (${probe.title})`,
    settings: {
      api: probe.api,
      backing: probe.backing,
      declared: probe.declared,
      chrome: environment.chrome_version ?? 'неизвестно',
      gpu: environment.gpu_renderer ?? 'неизвестно',
    },
    metrics: { load_ms: probe.probe_ms, total_ms: totalMs },
    environment,
    input_summary: 'Проверка доступности API, входных данных нет',
    output_summary: probe.availability,
    status: probe.availability === 'available' ? ('ok' as const) : ('unsupported' as const),
    error_message: probe.availability === 'available' ? null : `availability = ${probe.availability}`,
  }));
}
