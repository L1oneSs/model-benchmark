import { useState } from 'react';

import { AgentChat } from '../components/AgentChat';
import { RecommendationsTable } from '../components/RecommendationsTable';
import './RecommendationsPage.scss';
import { Icon } from '../components/Icon';

type SubTab = 'table' | 'bot';

export function RecommendationsPage() {
  const [subTab, setSubTab] = useState<SubTab>('table');

  return (
    <>
      <header className="page-header">
        <h1>Рекомендации</h1>
        <p className="page-header__hint">
          От результатов — к выбору технологии. Сравните подходы или обсудите измерения с агентом.
        </p>
      </header>

      <div className="subtabs" aria-label="Вид рекомендаций">
        <button
          type="button"
          aria-pressed={subTab === 'table'}
          className={`subtabs__item${subTab === 'table' ? ' subtabs__item--active' : ''}`}
          onClick={() => setSubTab('table')}
        >
          <Icon name="book" /> Сравнение подходов
        </button>
        <button
          type="button"
          aria-pressed={subTab === 'bot'}
          className={`subtabs__item${subTab === 'bot' ? ' subtabs__item--active' : ''}`}
          onClick={() => setSubTab('bot')}
        >
          <Icon name="spark" /> Агент
        </button>
      </div>

      {subTab === 'table' ? <RecommendationsTable /> : <AgentChat />}
    </>
  );
}
