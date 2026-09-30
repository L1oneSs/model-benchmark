import { useCallback, useEffect, useState } from 'react';

import { collectEnvironment } from '../benchmark/metrics';
import { saveMeasurements } from '../api/benchmarkApi';
import { probeEnvironment } from '../benchmark/runner';
import type { Environment } from '../benchmark/types';
import type { TfBackend } from '../models/tensorflow';
import { probeBuiltinApis, type ApiProbe } from '../models/builtinAi';
import './EnvironmentPanel.scss';

const VERDICT_CLASS: Record<string, string> = {
  available: 'ok',
  downloadable: 'warn',
  downloading: 'warn',
  unavailable: 'error',
  'не объявлен': 'error',
};

/** Диагностика оборудования, браузера и доступных встроенных ИИ-API. */
export function EnvironmentPanel({
  onSaved,
  backends,
  backendsLoading,
  nanoStatus,
  nanoDownloading,
  nanoProgress,
  nanoAvailable,
  onNanoDownload,
  disabled = false,
}: {
  onSaved: () => void;
  backends: TfBackend[];
  backendsLoading: boolean;
  nanoStatus: string;
  nanoDownloading: boolean;
  nanoProgress: number | null;
  nanoAvailable: boolean;
  onNanoDownload: () => void;
  disabled?: boolean;
}) {
  const [environment, setEnvironment] = useState<Environment | null>(null);
  const [probes, setProbes] = useState<ApiProbe[]>([]);
  const [open, setOpen] = useState(true);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const [env, found] = await Promise.all([collectEnvironment(), probeBuiltinApis()]);
    setEnvironment(env);
    setProbes(found);
  }, []);

  useEffect(() => {
    void refresh().catch(() => setNote('Не удалось обновить сведения о среде.'));
  }, [refresh]);

  const saveProbe = async () => {
    setBusy(true);
    setNote(null);
    try {
      const rows = await probeEnvironment();
      await saveMeasurements(rows);
      onSaved();
      setNote(`Диагностика сохранена: ${rows.length} строк.`);
      await refresh();
    } catch (error) {
      setNote(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="env">
      <header className="env__header">
        <button
          type="button"
          className="env__toggle"
          onClick={() => setOpen((value) => !value)}
          aria-expanded={open}
        >
          <span className="env__chevron">{open ? '▾' : '▸'}</span>
          Среда прогона
        </button>
        <button type="button" className="env__save" onClick={() => void saveProbe()}
          disabled={busy || disabled} title="Сохранить диагностику встроенных ИИ-API и сведения об устройстве">
          {busy ? 'Записываю…' : 'Записать в датасет'}
        </button>
      </header>

      {open && (
        <div className="env__body">
          <div className="env__overview">
          <section className="env__section">
            <h3 className="env__heading">Устройство и браузер</h3>
            {!environment && <p className="env__hint" role="status">Получаю сведения об устройстве…</p>}
          {environment && (
            <dl className="env__facts">
              <dt>Браузер</dt>
              <dd>Chrome {environment.chrome_version ?? 'неизвестно'}, {environment.platform}</dd>
              <dt>Ядер процессора</dt>
              <dd>{environment.hardware_concurrency}</dd>
              <dt>Видеоадаптер</dt>
              <dd>{environment.gpu_renderer ?? 'не определён'}</dd>
              <dt>Адаптер WebGPU</dt>
              <dd>{environment.gpu_adapter ?? (environment.webgpu_available ? 'есть' : 'нет')}</dd>
              <dt>Вкладка</dt>
              <dd>
                {environment.visibility === 'visible' ? (
                  'активна'
                ) : (
                  <span className="env__warn">
                    в фоне — запуск экспериментов заблокирован, браузер душит рендеринг
                  </span>
                )}
              </dd>
            </dl>
          )}
          </section>
          <section className="env__section env__section--backends">
            <h3 className="env__heading">Бэкенды TensorFlow.js</h3>
            <p className="env__hint">Доступны для выбора в экспериментах</p>
            <div className="env__backends" role="status">
              {backendsLoading ? <span>Проверяю доступность…</span> : backends.length
                ? backends.map(backend => <span className="env__backend" key={backend}>
                    <span className="env__dot" aria-hidden="true" />
                    {{ webgpu: 'WebGPU', webgl: 'WebGL', wasm: 'WebAssembly', cpu: 'CPU' }[backend]}
                  </span>)
                : <span>Доступные бэкенды не найдены.</span>}
            </div>
          </section>
          <section className="env__section env__section--nano">
            <div className="env__nano-head">
              <h3 className="env__heading">Gemini Nano</h3>
              <span className={`badge badge--${nanoAvailable ? 'ok' : nanoDownloading ? 'warn' : 'error'}`}>
                {nanoAvailable ? 'готова' : nanoDownloading ? 'загрузка' : 'нужна загрузка'}
              </span>
            </div>
            <p className="env__nano-status" role="status">{nanoStatus}</p>
            {nanoDownloading && (
              <progress
                className="env__nano-progress"
                aria-label="Загрузка Gemini Nano"
                max={100}
                value={nanoProgress === null || nanoProgress >= 100 ? undefined : nanoProgress}
              />
            )}
            {!nanoAvailable && !nanoDownloading && (
              <button type="button" className="env__nano-action" onClick={onNanoDownload} disabled={disabled}>
                Загрузить модель
              </button>
            )}
          </section>
          </div>

          <div className="env__api-section">
          <table className="env__apis">
            <caption>Встроенные ИИ-API в этом браузере</caption>
            <thead>
              <tr>
                <th scope="col">API</th>
                <th scope="col">Назначение</th>
                <th scope="col">Модель</th>
                <th scope="col">Состояние</th>
              </tr>
            </thead>
            <tbody>
              {probes.length === 0 && <tr><td colSpan={4}>Проверяю доступность API…</td></tr>}
              {probes.map((probe) => (
                <tr key={probe.api}>
                  <th scope="row" className="mono">{probe.api}</th>
                  <td>{probe.title}</td>
                  <td className="env__backing">{probe.backing}</td>
                  <td>
                    <span className={`badge badge--${VERDICT_CLASS[probe.availability] ?? 'warn'}`}>
                      {probe.availability}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
      {note && <p className="env__note" role="status">{note}</p>}
    </section>
  );
}
