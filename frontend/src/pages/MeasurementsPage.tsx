import { ResultsTable } from '../components/ResultsTable';
import { EXPERIMENTS } from '../benchmark/experiments';
import { csvExportUrl } from '../api/benchmarkApi';

interface Props {
  reloadToken: number;
}

export function MeasurementsPage({ reloadToken }: Props) {
  return (
    <>
      <header className="page-header">
        <div className="page-header__row">
          <h1>Измерения</h1>
          <a className="results__export results__export--primary" href={csvExportUrl()}>
            Выгрузить общий CSV
          </a>
        </div>
        <p className="page-header__hint">
          Результаты по каждому эксперименту. Дополнительные показатели и сравнения
          открываются отдельной кнопкой. Полный датасет выгружается в CSV.
        </p>
      </header>

      {EXPERIMENTS.map((experiment) => (
        <ResultsTable key={experiment.key} experiment={experiment} reloadToken={reloadToken} />
      ))}

    </>
  );
}
