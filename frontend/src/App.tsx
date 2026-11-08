import { useEffect, useState } from 'react';
import { ChevronRight, PanelLeft } from 'lucide-react';
import { Button } from './components/ui/button';
import { ThemeMenu } from './components/ThemeMenu';

import { Sidebar, type TabKey } from './components/Sidebar';
import { MeasurementsPage } from './pages/MeasurementsPage';
import { RecommendationsPage } from './pages/RecommendationsPage';
import { StandPage } from './pages/StandPage';

export default function App() {
  const readTab=():TabKey=>{const value=location.hash.slice(1);return value==='measurements'||value==='recommendations'?value:'stand';};
  const [tab, setTab] = useState<TabKey>(readTab);
  useEffect(()=>{window.scrollTo(0,0);},[tab]);
  const [collapsed,setCollapsed]=useState(()=>{try{return localStorage.getItem('benchmark-sidebar')==='collapsed';}catch{return false;}});
  useEffect(()=>{const change=()=>setTab(readTab());window.addEventListener('hashchange',change);return()=>window.removeEventListener('hashchange',change);},[]);
  const navigate=(next:TabKey)=>{location.hash=next;setTab(next);};
  const toggleSidebar=()=>setCollapsed(current=>{try{localStorage.setItem('benchmark-sidebar',current?'expanded':'collapsed');}catch{/* Keep navigation usable without storage. */}return !current;});
  const title={stand:'Стенд',measurements:'Измерения',recommendations:'Рекомендации'}[tab];
  // Счётчик растёт после каждой записи измерений и заставляет вкладку
  // «Измерения» перечитать данные без ручного обновления страницы.
  const [reloadToken, setReloadToken] = useState(0);

  return (
    <div className={`app${collapsed?' app--collapsed':''}`}>
      <a className="skip-link" href="#main-content">Перейти к содержимому</a>
      <Sidebar active={tab} onChange={navigate} collapsed={collapsed}/>
      <main className="app__content" id="main-content" tabIndex={-1}>
        <div className="workspace-header"><div className="workspace-header__path">
          <Button variant="ghost" size="icon" className="workspace-collapse" onClick={toggleSidebar} aria-label={collapsed?'Развернуть меню':'Свернуть меню'} aria-expanded={!collapsed}><PanelLeft/></Button>
          <span>Рабочее пространство</span><ChevronRight size={14}/><strong>{title}</strong>
        </div><div className="workspace-header__actions"><span className="workspace-tag">Исследование интеграции ИИ</span><ThemeMenu/></div></div>
        {tab === 'stand' && <StandPage onMeasurementsSaved={() => setReloadToken((value) => value + 1)} />}
        {tab === 'measurements' && <MeasurementsPage reloadToken={reloadToken} />}
        {tab === 'recommendations' && <RecommendationsPage />}
      </main>
    </div>
  );
}
