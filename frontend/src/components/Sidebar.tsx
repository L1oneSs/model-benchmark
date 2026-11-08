import './Sidebar.scss';
import { Icon, type IconName } from './Icon';
import { FlaskConical, ArrowUpRight } from 'lucide-react';
import { Button } from './ui/button';

export type TabKey = 'stand' | 'measurements' | 'recommendations';

const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'stand', label: 'Стенд', icon: 'grid' },
  { key: 'measurements', label: 'Измерения', icon: 'chart' },
  { key: 'recommendations', label: 'Рекомендации', icon: 'book' },
];

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
  collapsed?: boolean;
}

export function Sidebar({ active, onChange, collapsed }: Props) {
  return (
    <nav className={`sidebar${collapsed?' sidebar--collapsed':''}`} aria-label="Разделы стенда">
      <a className="sidebar__brand" href="#stand" onClick={()=>onChange('stand')} aria-label="Benchmark Lab - стенд"><span className="sidebar__logo"><FlaskConical size={22}/></span><span className="sidebar__brand-text">Benchmark<span>AI research workspace</span></span></a>
      <p className="sidebar__caption">Рабочее пространство</p>
      <ul className="sidebar__list">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <Button variant="ghost"
              type="button"
              className={`sidebar__item${active === tab.key ? ' sidebar__item--active' : ''}`}
              onClick={() => onChange(tab.key)}
              aria-current={active === tab.key ? 'page' : undefined}
              title={collapsed?tab.label:undefined}
            >
              <Icon name={tab.icon} /><span>{tab.label}</span>
            </Button>
          </li>
        ))}
      </ul>
      <div className="sidebar__footer"><span className="sidebar__status"/><span>Локальный стенд</span><ArrowUpRight size={14}/></div>
    </nav>
  );
}
