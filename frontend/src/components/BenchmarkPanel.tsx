import { useCallback, useEffect, useImperativeHandle, useRef, useState, type Ref } from 'react';
import { ModelSelector, type ModelSelectorProps } from './ModelSelector';
import { SearchDocumentsInput, initialSearchInput, serializeSearchInput } from './SearchDocumentsInput';

import { saveMeasurements, fetchLatest } from '../api/benchmarkApi';
import { hasCyrillic, prepareTranslator } from '../models/geminiNano';
import { approachBadgeClass, approachLabel, type ExperimentDefinition } from '../benchmark/experiments';
import { formatMs } from '../benchmark/metrics';
import { formatExperimentOutput } from '../benchmark/objectDetection';
import { DEFAULT_OPTIONS, runExperiment, type RunnerOptions } from '../benchmark/runner';
import { type Approach, type ExperimentInput, type Measurement, type TranslationDirection } from '../benchmark/types';
import './BenchmarkPanel.scss';

interface Props {
  experiment: ExperimentDefinition;
  ref?: Ref<BenchmarkHandle>;
  selector: Omit<ModelSelectorProps, 'options' | 'onChange' | 'disabled' | 'approaches'>;
  disabled: boolean;
  onRun: () => void;
  sampleImageUrl: string;
  onSaved: () => void;
}

export interface BenchmarkHandle { start: () => Promise<boolean> }

const TRANSLATION_SAMPLES: Record<TranslationDirection, string> = {
  en_ru: 'The interface is fast, the model loaded instantly, and the application is convenient to use.',
  ru_en: 'Интерфейс работает быстро, модель загрузилась мгновенно, а приложением удобно пользоваться.',
};

const TRANSLATION_DIRECTION_LABEL: Record<TranslationDirection, string> = {
  en_ru: 'английский → русский',
  ru_en: 'русский → английский',
};

function maskTranslationInput(value: string, direction: TranslationDirection): string {
  const allowed = direction === 'en_ru'
    ? /[^A-Za-z\s.,!?;:'"()[\]{}«»\-–—]/g
    : /[^А-Яа-яЁё\s.,!?;:'"()[\]{}«»\-–—]/g;
  return value.replace(allowed, '');
}

function maskEnglishInput(value: string): string {
  return value.replace(/[^A-Za-z\s.,!?;:'"()[\]{}«»\-–—]/g, '');
}

/** Карточка одного эксперимента: вход, кнопка запуска и свёрнутый блок
 *  с результатом последнего измерения — как в макете заказчика. */
export function BenchmarkPanel({ ref, experiment, selector, disabled, onRun, sampleImageUrl, onSaved }: Props) {
  const [options, setOptions] = useState<RunnerOptions>(() => ({ ...DEFAULT_OPTIONS, selectedBackends: [] }));
  useEffect(() => {
    setOptions(previous => previous.allBackends ? {
      ...previous,
      selectedBackends: experiment.approaches.includes('tensorflow_js') ? [...selector.availableBackends] : [],
      includeGeminiNano: experiment.approaches.includes('gemini_nano') && selector.nanoAvailable,
      includeLibraryModel: experiment.approaches.includes('tensorflow_js') && experiment.usesTensorFlowBackends === false,
    } : previous);
  }, [experiment, selector.availableBackends, selector.nanoAvailable]);
  const [text, setText] = useState(experiment.defaultText ?? '');
  const [searchInput, setSearchInput] = useState(() => initialSearchInput(experiment.defaultText ?? ''));
  const [question, setQuestion] = useState(() => experiment.defaultText?.match(/^Question:\s*([\s\S]*?)(?:\n\s*\nContext:|$)/)?.[1]?.trim() ?? '');
  const [context, setContext] = useState(() => experiment.defaultText?.match(/(?:^|\n)Context:\s*([\s\S]*)/)?.[1]?.trim() ?? '');
  const [imageUrl, setImageUrl] = useState(experiment.defaultImageUrl ?? sampleImageUrl);
  const [imageLabel, setImageLabel] = useState(experiment.defaultImageLabel ?? 'тестовое изображение стенда');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [latest, setLatest] = useState<Partial<Record<Approach, Measurement>>>({});
  const [expanded, setExpanded] = useState(false);

  const imageRef = useRef<HTMLImageElement>(null);

  const loadLatest = useCallback(async () => {
    try {
      setLatest(await fetchLatest(experiment.key));
    } catch {
      // Отсутствие связи с бэкендом не должно мешать прогонять эксперименты.
    }
  }, [experiment.key]);

  useEffect(() => {
    void loadLatest();
  }, [loadLatest]);

  const handleFile = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setImageUrl(URL.createObjectURL(file));
    setImageLabel(file.name);
  };

  const buildInput = (): ExperimentInput => {
    if (experiment.inputKind === 'text') {
      if (experiment.key === 'question_answering') {
        if (!question.trim()) throw new Error('Введите вопрос');
        if (!context.trim()) throw new Error('Введите контекст');
        return { kind: 'text', text: `Question: ${question.trim().replace(/\s+/g, ' ')}\n\nContext: ${context.trim()}` };
      }
      return { kind: 'text', text: experiment.key === 'semantic_search' ? serializeSearchInput(searchInput) : text };
    }
    const element = imageRef.current;
    if (!element || !element.complete || element.naturalWidth === 0) {
      throw new Error('Изображение ещё не загрузилось, подождите секунду и повторите');
    }
    return { kind: 'image', element, label: imageLabel };
  };

  const start = async () => {
    setRunning(true);
    setError(null);
    setProgress('Подготовка');

    try {
      const input = buildInput();
      const runs = await runExperiment(experiment, input, { ...options, onProgress: setProgress });
      if (runs.length === 0) throw new Error('Прогоны не дали ни одного результата');

      setProgress('Сохранение результатов');
      await saveMeasurements(runs);
      await loadLatest();
      setExpanded(true);
      onSaved();
      setProgress(`Готово: записано ${runs.length} прогонов`);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : String(caught));
      setProgress('');
      return false;
    } finally {
      setRunning(false);
    }
  };
  useImperativeHandle(ref, () => ({ start }));

  const handleRun = async () => {
    if (experiment.key === 'text_translation' && options.includeGeminiNano) {
      setRunning(true);
      setError(null);
      setProgress(`Подготовка Translator API: ${TRANSLATION_DIRECTION_LABEL[options.translationDirection]}`);
      try {
        await prepareTranslator(
          options.translationDirection,
          (value) => setProgress(`Загрузка языкового пакета: ${(value * 100).toFixed(1)}%`),
        );
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : String(caught));
        setProgress('');
        setRunning(false);
        return;
      }
      setRunning(false);
    }
    onRun();
  };

  const participating = experiment.approaches;
  const isTranslationExperiment = experiment.key === 'text_translation';
  const isEnglishOnlyExperiment = experiment.key === 'text_generation';
  const usesPromptForGemini =
    experiment.approaches.includes('gemini_nano') &&
    experiment.key !== 'text_translation' &&
    experiment.key !== 'language_detection';
  const handleTextChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
    const value = event.target.value;
    if (isTranslationExperiment) {
      setText(maskTranslationInput(value, options.translationDirection));
      return;
    }
    setText(isEnglishOnlyExperiment ? maskEnglishInput(value) : value);
  };
  const handleTranslationDirectionChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
    const direction = event.target.value as TranslationDirection;
    setOptions((previous) => ({ ...previous, translationDirection: direction }));
    setText(TRANSLATION_SAMPLES[direction]);
  };

  return (
    <article className={`panel${running ? ' panel--running' : ''}`}>
      <header className="panel__header">
        <div className="panel__heading">
          <h3 className="panel__title">{experiment.title}</h3>
          <p className="panel__description">{experiment.description}</p>
        </div>
        <div className="panel__tags" aria-label="Парадигмы эксперимента">
          {participating.map((approach) => (
            <span
              key={approach}
              className={`badge badge--${approachBadgeClass(experiment, approach)}`}
            >
              {approachLabel(experiment, approach)}
            </span>
          ))}
        </div>
      </header>

      <div className="panel__config">
        <ModelSelector {...selector} approaches={experiment.approaches} options={options}
          onChange={setOptions} disabled={disabled || running}
          usesTensorFlowBackends={experiment.usesTensorFlowBackends !== false}
          libraryLabel={experiment.libraryLabel} />
      </div>

      <section className="panel__workspace">
        <div className="panel__workspace-head">
          <h4>{experiment.inputKind === 'text' ? 'Входные данные' : 'Изображение для прогона'}</h4>
          {isTranslationExperiment && (
            <label className="panel__translation-direction">
              <span>Направление перевода</span>
              <select
                value={options.translationDirection}
                onChange={handleTranslationDirectionChange}
                disabled={disabled || running}
              >
                <option value="en_ru">Английский → русский</option>
                <option value="ru_en">Русский → английский</option>
              </select>
            </label>
          )}
        </div>

        <div className="panel__body">
          <div className="panel__input">
            {experiment.key === 'semantic_search' ? (
              <>
                <SearchDocumentsInput value={searchInput} onChange={setSearchInput} disabled={disabled || running} />
                {usesPromptForGemini && hasCyrillic([searchInput.query, ...searchInput.documents.flatMap(document => [document.title, document.text])].join(' ')) && (
                  <p className="panel__lang-warning">Prompt API не поддерживает кириллицу. Для сравнения с Gemini Nano используйте английский текст.</p>
                )}
              </>
            ) : experiment.key === 'question_answering' ? (
              <div className="panel__qna">
                <label>
                  <span>Вопрос</span>
                  <textarea value={question} onChange={event => setQuestion(event.target.value)}
                    disabled={disabled || running} rows={2} placeholder="Введите вопрос по контексту" />
                </label>
                <label>
                  <span>Контекст</span>
                  <textarea value={context} onChange={event => setContext(event.target.value)}
                    disabled={disabled || running} rows={5} placeholder="Введите текст, в котором нужно найти ответ" />
                </label>
                {usesPromptForGemini && hasCyrillic(`${question} ${context}`) && (
                  <p className="panel__lang-warning">Prompt API не поддерживает кириллицу. Для сравнения с Gemini Nano используйте английский текст.</p>
                )}
              </div>
            ) : experiment.inputKind === 'text' ? (
              <>
                <textarea
                  value={text}
                  onChange={handleTextChange}
                  disabled={disabled || running}
                  rows={4}
                  placeholder={isTranslationExperiment
                    ? `Введите текст: ${TRANSLATION_DIRECTION_LABEL[options.translationDirection]}`
                    : 'Текст для классификации'}
                  aria-label="Входной текст"
                />
                {isTranslationExperiment && (
                  <p className="panel__input-hint">
                    Маска ввода оставляет только буквы исходного языка, пробелы и знаки пунктуации.
                  </p>
                )}
                {isEnglishOnlyExperiment && (
                  <p className="panel__input-hint">
                    Маска ввода оставляет только английские буквы, пробелы и знаки пунктуации.
                  </p>
                )}
                {hasCyrillic(text) && usesPromptForGemini && (
                  <p className="panel__lang-warning">
                    В тексте кириллица. Prompt API её не принимает, прогон Gemini Nano
                    запишется со статусом «не поддерживается» — это ожидаемый результат,
                    а не сбой стенда.
                  </p>
                )}
              </>
            ) : (
              <div className={`panel__image${['object_detection', 'face_counting'].includes(experiment.key) ? ' panel__image--objects' : ''}`}>
                <img ref={imageRef} src={imageUrl} alt={imageLabel} crossOrigin="anonymous" />
                <label className="panel__file">
                  <input type="file" accept="image/*" onChange={handleFile} disabled={disabled || running} />
                  Выбрать своё изображение
                </label>
              </div>
            )}
          </div>

          <div className="panel__actions">
            <button type="button" className="panel__run" onClick={() => void handleRun()} disabled={disabled || running}>
              {running ? 'Идёт прогон' : 'Запуск'}
            </button>
            {(progress || error) && (
              <p className={`panel__progress${error ? ' panel__progress--error' : ''}`} role="status">
                {error ?? progress}
              </p>
            )}
          </div>
        </div>
      </section>

      <button
        type="button"
        className="panel__dropdown"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
      >
        <span>Результат последнего измерения</span>
        <span className="panel__chevron">{expanded ? '▴' : '▾'}</span>
      </button>

      {expanded && (
        <div className="panel__latest">
          {participating.map((approach) => {
            const row = latest[approach];
            return (
              <div key={approach} className="panel__latest-row">
                <span className="panel__latest-name">{approachLabel(experiment, approach)}</span>
                {row ? (
                  <span className="panel__latest-value">
                    {formatMs(row.metrics.inference_ms)}
                    <span className="panel__latest-extra">
                      {' '}
                      {experiment.sweepsBackends
                        ? `· ${row.model_name} · ${String(row.settings.backend ?? '—')} · ${new Date(row.created_at).toLocaleString('ru-RU')}`
                        : `· до первого предсказания ${formatMs(row.metrics.first_token_ms)} · ${formatExperimentOutput(experiment.key, row.output_summary)}`}
                    </span>
                  </span>
                ) : (
                  <span className="panel__latest-empty">измерений ещё нет</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </article>
  );
}
