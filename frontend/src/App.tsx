import { useState } from 'react';

import { Sidebar, type TabKey } from './components/Sidebar';
import { MeasurementsPage } from './pages/MeasurementsPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { StandPage } from './pages/StandPage';

export default function App() {
  const [tab, setTab] = useState<TabKey>('stand');
  // Счётчик растёт после каждой записи измерений и заставляет вкладку
  // «Измерения» перечитать данные без ручного обновления страницы.
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <div className="app">
      <Sidebar active={tab} onChange={setTab} />
      <main className="app__content">
        {tab === 'stand' && <StandPage onMeasurementsSaved={() => setReloadToken((value) => value + 1)} />}
        {tab === 'measurements' && <MeasurementsPage reloadToken={reloadToken} />}
        {tab === 'recommendations' && <RecommendationsPage />}
      </main>
    </div>
  );
}
