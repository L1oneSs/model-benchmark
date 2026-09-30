import { useId } from 'react';
import type { RunnerOptions } from '../benchmark/runner';
import type { Approach } from '../benchmark/types';
import type { TfBackend } from '../models/tensorflow';
import './ModelSelector.scss';

export interface ModelSelectorProps {
  approaches: Approach[];
  options: RunnerOptions;
  onChange: (options: RunnerOptions) => void;
  disabled: boolean;
  availableBackends: TfBackend[];
  nanoAvailable: boolean;
  usesTensorFlowBackends?: boolean;
  libraryLabel?: string;
}

/** Параметры серии прогонов. Повторы и отбрасывание прогревочного запуска
 *  вынесены в интерфейс, потому что от них напрямую зависит, что попадёт
 *  в таблицы экспериментальной главы. */
export function ModelSelector({
  options,
  onChange,
  disabled,
  availableBackends,
  nanoAvailable,
  approaches,
  usesTensorFlowBackends = true,
  libraryLabel = 'Библиотечная модель',
}: ModelSelectorProps) {
  const id = useId();
  availableBackends = approaches.includes('tensorflow_js') && usesTensorFlowBackends ? availableBackends : [];
  nanoAvailable = approaches.includes('gemini_nano') && nanoAvailable;
  const libraryChoices = approaches.includes('tensorflow_js') && !usesTensorFlowBackends
    ? [{ value: 'library_model', label: libraryLabel }]
    : [];
  const choices = [
    ...libraryChoices,
    ...availableBackends.map((backend) => ({ value: backend, label: `TensorFlow.js · ${backend.toUpperCase()}` })),
    ...(nanoAvailable ? [{ value: 'gemini_nano', label: 'Gemini Nano' }] : []),
  ];
  const allSelected = options.allBackends;

  const setChoice = (value: string, checked: boolean) => {
    const selected = new Set(options.allBackends ? availableBackends : options.selectedBackends);
    let includeGeminiNano = options.allBackends ? nanoAvailable : options.includeGeminiNano;
    let includeLibraryModel = options.allBackends ? libraryChoices.length > 0 : options.includeLibraryModel;
    if (value === 'gemini_nano') includeGeminiNano = checked;
    else if (value === 'library_model') includeLibraryModel = checked;
    else if (checked) selected.add(value as TfBackend);
    else selected.delete(value as TfBackend);
    const allBackends = choices.length > 0
      && (libraryChoices.length === 0 || includeLibraryModel)
      && availableBackends.every((backend) => selected.has(backend))
      && (!nanoAvailable || includeGeminiNano);
    onChange({
      ...options,
      allBackends,
      selectedBackends: [...selected],
      includeGeminiNano,
      includeLibraryModel,
    });
  };

  const setAll = (checked: boolean) => {
    onChange({
      ...options,
      allBackends: checked,
      selectedBackends: checked ? [...availableBackends] : [],
      includeGeminiNano: checked && nanoAvailable,
      includeLibraryModel: checked && libraryChoices.length > 0,
    });
  };

  return (
    <section className="run-options">
      <div className="run-options__section run-options__section--series">
        <h4 className="run-options__title">Настройки серии</h4>
        <div className="run-options__series">
          <div className="run-options__field">
            <label htmlFor={`${id}-repeats`}>Повторов</label>
            <input
              id={`${id}-repeats`}
              type="number"
              min={1}
              max={30}
              value={options.repeats}
              disabled={disabled}
              onChange={(event) =>
                onChange({ ...options, repeats: Math.max(1, Math.min(30, Number(event.target.value) || 1)) })
              }
            />
          </div>

          <div className="run-options__field run-options__field--checkbox">
            <input
              id={`${id}-discard`}
              type="checkbox"
              checked={options.discardFirst}
              disabled={disabled}
              onChange={(event) => onChange({ ...options, discardFirst: event.target.checked })}
            />
            <label htmlFor={`${id}-discard`}>
              Отбросить прогревочный прогон
              <span>Первый вызов компилирует шейдеры и обычно медленнее остальных</span>
            </label>
          </div>
        </div>
      </div>

      <div className="run-options__section run-options__section--models">
        <h4 className="run-options__title">Модели и бэкенды</h4>
        <div className="run-options__choices">
          <label>
            <input
              type="checkbox"
              checked={allSelected}
              disabled={disabled || choices.length === 0}
              onChange={(event) => setAll(event.target.checked)}
            />
            Все доступные
          </label>
          {choices.map((choice) => (
            <label key={choice.value}>
              <input
                type="checkbox"
                checked={allSelected || (choice.value === 'gemini_nano'
                  ? options.includeGeminiNano
                  : choice.value === 'library_model'
                    ? options.includeLibraryModel
                  : options.selectedBackends.includes(choice.value as TfBackend))}
                disabled={disabled}
                onChange={(event) => setChoice(choice.value, event.target.checked)}
              />
              {choice.label}
            </label>
          ))}
          {choices.length === 0 && <span>Проверяю доступные варианты...</span>}
        </div>
      </div>
    </section>
  );
}
