/** Диагностика встроенных ИИ-API браузера.
 *
 *  Chrome 2026 года предоставляет семейство встроенных API поверх Gemini Nano:
 *  LanguageModel (Prompt API), Summarizer, Writer, Rewriter, Proofreader,
 *  а также Translator и LanguageDetector на отдельных, более лёгких моделях.
 *
 *  Проверка нужна не для отладки. На машине, не проходящей аппаратный порог,
 *  Chrome вообще не объявляет часть этих объектов — и это первый
 *  экспериментальный результат: применимость встроенной парадигмы упирается
 *  не в скорость, а в наличие модели на конкретном устройстве.
 */

import { elapsed, now } from '../benchmark/metrics';

export interface ApiProbe {
  /** Имя глобального объекта */
  api: string;
  /** Человеческое название */
  title: string;
  /** Объявлен ли объект в этом браузере */
  declared: boolean;
  /** Ответ availability(): available, downloadable, downloading, unavailable */
  availability: string;
  /** Сколько заняла сама проверка */
  probe_ms: number;
  /** На какой модели работает API */
  backing: 'gemini-nano' | 'отдельная модель';
}

type Probeable = {
  availability?: (options?: unknown) => Promise<string>;
  capabilities?: () => Promise<{ available: string }>;
};

const DEFINITIONS: {
  api: string;
  title: string;
  backing: ApiProbe['backing'];
  options?: unknown;
}[] = [
  { api: 'LanguageModel', title: 'Prompt API', backing: 'gemini-nano',
    options: { expectedInputs: [{ type: 'text', languages: ['en'] }], expectedOutputs: [{ type: 'text', languages: ['en'] }] } },
  { api: 'Summarizer', title: 'Суммаризация', backing: 'gemini-nano',
    options: { type: 'key-points', format: 'plain-text', length: 'short', expectedInputLanguages: ['en'] } },
  { api: 'Writer', title: 'Генерация текста', backing: 'gemini-nano',
    options: { expectedInputLanguages: ['en'] } },
  { api: 'Rewriter', title: 'Переписывание текста', backing: 'gemini-nano',
    options: { expectedInputLanguages: ['en'] } },
  { api: 'Proofreader', title: 'Проверка грамматики', backing: 'gemini-nano',
    options: { expectedInputLanguages: ['en'] } },
  { api: 'Translator', title: 'Перевод', backing: 'отдельная модель',
    options: { sourceLanguage: 'en', targetLanguage: 'ru' } },
  { api: 'LanguageDetector', title: 'Определение языка', backing: 'отдельная модель' },
];

/** Нормализует ответы старой и новой формы API к одному словарю значений. */
function normalize(value: string): string {
  if (value === 'readily') return 'available';
  if (value === 'after-download') return 'downloadable';
  if (value === 'no') return 'unavailable';
  return value;
}

export async function probeBuiltinApis(): Promise<ApiProbe[]> {
  const globals = globalThis as unknown as Record<string, Probeable | undefined>;
  const probes: ApiProbe[] = [];

  for (const definition of DEFINITIONS) {
    const api = globals[definition.api];
    const started = now();

    if (!api) {
      probes.push({
        api: definition.api,
        title: definition.title,
        declared: false,
        availability: 'не объявлен',
        probe_ms: elapsed(started),
        backing: definition.backing,
      });
      continue;
    }

    let availability = 'неизвестно';
    try {
      if (typeof api.availability === 'function') {
        try {
          availability = normalize(await api.availability(definition.options));
        } catch {
          // Ранние сборки не принимали аргументов
          availability = normalize(await api.availability());
        }
      } else if (typeof api.capabilities === 'function') {
        availability = normalize((await api.capabilities()).available);
      }
    } catch (error) {
      availability = 'ошибка: ' + (error instanceof Error ? error.message : String(error));
    }

    probes.push({
      api: definition.api,
      title: definition.title,
      declared: true,
      availability,
      probe_ms: elapsed(started),
      backing: definition.backing,
    });
  }

  return probes;
}

/** Короткий вывод для интерфейса: работает ли встроенная парадигма вообще. */
export function summarizeProbes(probes: ApiProbe[]): string {
  const nano = probes.filter((p) => p.backing === 'gemini-nano');
  const ready = nano.filter((p) => p.availability === 'available');
  const downloadable = nano.filter((p) => p.availability === 'downloadable');
  const declared = nano.filter((p) => p.declared);

  if (ready.length > 0) {
    return `Встроенная парадигма доступна: ${ready.map((p) => p.title).join(', ')}`;
  }
  if (downloadable.length > 0) {
    return `Модель не скачана, но устройство её потянет: ${downloadable.map((p) => p.title).join(', ')}`;
  }
  if (declared.length === 0) {
    return 'Встроенная парадигма недоступна: браузер не объявил ни одного API на Gemini Nano. Устройство не проходит аппаратный порог';
  }
  return 'Встроенная парадигма недоступна: API объявлены, но модель на этом устройстве не запускается';
}
