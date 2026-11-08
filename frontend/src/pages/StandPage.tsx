import { Button } from '../components/ui/button';
import { useEffect, useRef, useState } from 'react';

import { BenchmarkPanel, type BenchmarkHandle } from '../components/BenchmarkPanel';
import { EnvironmentPanel } from '../components/EnvironmentPanel';
import { EXPERIMENTS } from '../benchmark/experiments';
import { useNanoModel } from '../models/useNanoModel';
import { availableBackends, type TfBackend } from '../models/tensorflow';
import { Icon } from '../components/Icon';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Search } from 'lucide-react';

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
  const [search,setSearch]=useState('');
  const experiments=EXPERIMENTS.filter(e=>`${e.title} ${e.description}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));

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
        <p className="page-header__hint">Настройте входные данные и сравните модели в одинаковых условиях.</p>
      </header>

      <EnvironmentPanel onSaved={onMeasurementsSaved} backends={availableTfBackends}
        backendsLoading={backendsLoading} disabled={running}
        nanoStatus={nano.status} nanoDownloading={nano.downloading}
        nanoProgress={nano.progress} nanoAvailable={nano.available}
        onNanoDownload={nano.start} />

      <div className="stand-actions">
        <div className="flex items-center gap-3"><h2>Эксперименты</h2><Badge variant="secondary">{experiments.length}</Badge></div>
        <label className="relative ml-auto min-w-52"><Search size={15} className="absolute left-3 top-3 text-muted-foreground"/><Input className="pl-9" aria-label="Найти эксперимент" placeholder="Найти эксперимент…" value={search} onChange={e=>setSearch(e.target.value)} disabled={running}/></label>
        <Button variant="outline" type="button" className="panel__run" disabled={running || backendsLoading || !experiments.length}
          onClick={() => void run(experiments.map(experiment => experiment.key))}>
          <Icon name="play" size={16} />{running ? 'Идёт прогон' : search.trim()?'Запустить показанные':'Запустить все'}
        </Button>
        <p role="status">{progress}</p>
      </div>

      {!experiments.length&&<div className="notice">По этому запросу экспериментов не найдено.</div>}
      {experiments.map((experiment) => (
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
