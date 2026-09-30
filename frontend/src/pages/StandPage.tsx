import { useEffect, useRef, useState } from 'react';

import { BenchmarkPanel, type BenchmarkHandle } from '../components/BenchmarkPanel';
import { EnvironmentPanel } from '../components/EnvironmentPanel';
import { EXPERIMENTS } from '../benchmark/experiments';
import { useNanoModel } from '../models/useNanoModel';
import { availableBackends, type TfBackend } from '../models/tensorflow';
import { Icon } from '../components/Icon';

interface Props {
  onMeasurementsSaved: () => void;
}

const SAMPLE_IMAGE = '/samples/test-pattern.png';

export function StandPage({ onMeasurementsSaved }: Props) {
  const panels = useRef<Record<string, BenchmarkHandle | null>>({});
  const busy = useRef(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState('');
  const nano = useNanoModel();
  const [availableTfBackends, setAvailableTfBackends] = useState<TfBackend[]>([]);
  const [backendsLoading, setBackendsLoading] = useState(true);

  const run = async (keys: string[]) => {
    if (busy.current || backendsLoading) return;
    busy.current = true;
    setRunning(true);
    let succeeded = 0;
    try {
      for (const [index, key] of keys.entries()) {
        setProgress(`Эксперимент ${index + 1} из ${keys.length}: ${EXPERIMENTS.find(e => e.key === key)?.title}`);
        if (await panels.current[key]?.start()) succeeded += 1;
      }
      setProgress(`Завершено: ${succeeded} из ${keys.length}. ${succeeded < keys.length ? 'Подробности ошибок — в карточках экспериментов.' : ''}`);
    } finally {
      busy.current = false;
      setRunning(false);
    }
  };

  useEffect(() => {
    void availableBackends().then(setAvailableTfBackends).catch(() => setAvailableTfBackends([]))
      .finally(() => setBackendsLoading(false));
  }, []);

  return (
    <>
      <header className="page-header">
        <h1>Стенд</h1>
      </header>

      <EnvironmentPanel onSaved={onMeasurementsSaved} backends={availableTfBackends}
        backendsLoading={backendsLoading} disabled={running}
        nanoStatus={nano.status} nanoDownloading={nano.downloading}
        nanoProgress={nano.progress} nanoAvailable={nano.available}
        onNanoDownload={nano.start} />

      <div className="stand-actions">
        <div><h2>Эксперименты</h2></div>
        <button type="button" className="panel__run" disabled={running || backendsLoading}
          onClick={() => void run(EXPERIMENTS.map(experiment => experiment.key))}>
          <Icon name="play" size={16} />{running ? 'Идёт прогон' : 'Запустить все'}
        </button>
        <p role="status">{progress}</p>
      </div>

      {EXPERIMENTS.map((experiment) => (
        <BenchmarkPanel
          key={experiment.key}
          experiment={experiment}
          ref={handle => { panels.current[experiment.key] = handle; }}
          disabled={running || backendsLoading}
          onRun={() => void run([experiment.key])}
          selector={{ availableBackends: availableTfBackends, nanoAvailable: nano.available }}
          sampleImageUrl={SAMPLE_IMAGE}
          onSaved={onMeasurementsSaved}
        />
      ))}
    </>
  );
}
