import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
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

      <Tabs value={subTab} onValueChange={value=>setSubTab(value as SubTab)}>
      <TabsList className="mb-5" aria-label="Вид рекомендаций">
        <TabsTrigger value="table">
          <Icon name="book" /> Сравнение подходов
        </TabsTrigger>
        <TabsTrigger value="bot">
          <Icon name="spark" /> Агент
        </TabsTrigger>
      </TabsList>
      <TabsContent value="table"><RecommendationsTable /></TabsContent>
      <TabsContent value="bot"><AgentChat /></TabsContent>
      </Tabs>
    </>
  );
}
