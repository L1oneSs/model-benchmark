import './Sidebar.scss';
import { Icon, type IconName } from './Icon';

export type TabKey = 'stand' | 'measurements' | 'recommendations';

const TABS: { key: TabKey; label: string; icon: IconName }[] = [
  { key: 'stand', label: 'Стенд', icon: 'grid' },
  { key: 'measurements', label: 'Измерения', icon: 'chart' },
  { key: 'recommendations', label: 'Рекомендации', icon: 'book' },
];

interface Props {
  active: TabKey;
  onChange: (tab: TabKey) => void;
}

export function Sidebar({ active, onChange }: Props) {
  return (
    <nav className="sidebar" aria-label="Разделы стенда">
      <ul className="sidebar__list">
        {TABS.map((tab) => (
          <li key={tab.key}>
            <button
              type="button"
              className={`sidebar__item${active === tab.key ? ' sidebar__item--active' : ''}`}
              onClick={() => onChange(tab.key)}
              aria-current={active === tab.key ? 'page' : undefined}
            >
              <Icon name={tab.icon} />{tab.label}
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
