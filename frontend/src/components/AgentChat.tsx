import { useEffect, useRef, useState } from 'react';

import { askAgent, fetchAgentHistory, deleteAgentHistory, type Turn } from '../api/agentApi';
import './AgentChat.scss';
import { AgentCharts } from './AgentCharts';
import { AgentMarkdown } from './AgentMarkdown';
import { Icon } from './Icon';

const SUGGESTIONS = [
  'Что в таблице рекомендаций сказано про скорость обработки текста?',
  'Посчитай медиану инференса в эксперименте «Сравнение в скорости обработки текста», отдельно по моделям и бэкендам.',
  'Сравни две последние серии эксперимента «Сравнение в скорости обработки текста».',
  'Построй график медианы инференса в эксперименте «Сравнение в скорости обработки текста», отдельно по моделям и бэкендам.',
];

/** Чат агента: локальная модель читает данные через инструменты backend. */
export function AgentChat() {
  const [question, setQuestion] = useState('');
  const [turns, setTurns] = useState<Turn[]>([]);
  const [limit, setLimit] = useState(30);
  const [historyReady, setHistoryReady] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Turn | null>(null);
  const [stage, setStage] = useState('');
  const request = useRef<AbortController | null>(null);
  const thread = useRef<HTMLDivElement>(null);
  const followMessages = useRef(true);
  useEffect(() => {
    if (followMessages.current && thread.current) thread.current.scrollTop = thread.current.scrollHeight;
  }, [turns, pending, stage]);
  useEffect(() => () => { request.current?.abort(); request.current = null; }, []);
  useEffect(() => {
    let active = true;
    void fetchAgentHistory().then(history => {
      if (!active) return;
      setTurns(history.turns);
      setLimit(history.limit);
      setHistoryReady(true);
    }).catch(caught => { if (active) setError(`Не удалось загрузить историю. Обновите страницу. ${String(caught)}`); });
    return () => { active = false; };
  }, []);
  const historyFull = turns.length >= limit;

  const deleteChat = async () => {
    request.current?.abort();
    request.current = null;
    setBusy(true);
    setError(null);
    try {
      const history = await deleteAgentHistory();
      setTurns(history.turns);
      setLimit(history.limit);
      setPending(null);
      setQuestion('');
      setStage('');
      setHistoryReady(true);
    } catch (caught) {
      setError(`Не удалось удалить историю: ${String(caught)}`);
    } finally { setBusy(false); }
  };

  const ask = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed || busy || request.current || !historyReady || historyFull) return;

    setBusy(true);
    setError(null);
    const controller = new AbortController();
    request.current = controller;
    setStage('Подключаюсь…');
    followMessages.current = true;
    setPending({ question: trimmed, answer: '', thinking: '', sources: [], model: '' });
    try {
      const answer = await askAgent(trimmed, (event) => {
        if (request.current !== controller) return;
        if (event.type === 'status') setStage(event.message);
        if (event.type === 'sources') setPending((previous) => previous && ({ ...previous, sources: event.sources, model: event.model }));
        if (event.type === 'token') {
          setStage('Ответ формируется…');
          setPending((previous) => previous && ({ ...previous, answer: previous.answer + event.text }));
        }
        if (event.type === 'thinking') {
          setStage('Модель рассуждает…');
          setPending((previous) => previous && ({ ...previous, thinking: previous.thinking + event.text }));
        }
      }, controller.signal, {
        thinking,
      });
      if (request.current !== controller) return;
      setTurns((previous) => [
        ...previous,
        { question: trimmed, ...answer },
      ]);
      setQuestion('');
      setPending(null);
    } catch (caught) {
      if (request.current !== controller) return;
      setStage('Ответ не завершён');
      setError(controller.signal.aborted ? 'Генерация остановлена' : caught instanceof Error ? caught.message : String(caught));
      if (!controller.signal.aborted) {
        try {
          const history = await fetchAgentHistory();
          if (request.current === controller) { setTurns(history.turns); setLimit(history.limit); }
        } catch { /* Keep the original request error. */ }
      }
    } finally {
      if (request.current === controller) {
        request.current = null;
        setBusy(false);
      }
    }
  };

  return (
    <section className="rag">
      <header className="rag__header">
        <span className="rag__avatar"><Icon name="spark" size={22} /></span>
        <div><h2>Ассистент по экспериментам</h2><p>Ответы по рекомендациям и измерениям вашего стенда</p></div>
        <span className="rag__counter">{historyReady ? `${turns.length} / ${limit} ответов` : 'Загрузка истории…'}</span>
      </header>
      {thinking && <p className="rag__note rag__thinking-note">Режим Thinking включён. Рассуждения могут увеличить время ответа.</p>}
      {historyFull && <p className="rag__error" role="alert">Достигнут лимит истории: {limit} ответов. Нажмите «Удалить чат», чтобы продолжить переписку.</p>}

      <div className="rag__thread" ref={thread} onScroll={() => {
        const node = thread.current;
        if (node) followMessages.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80;
      }}>
        {turns.length === 0 && !pending && (
          <div className="rag__placeholder">
            <span className="rag__welcome-icon"><Icon name="spark" size={30} /></span>
            <span className="section-eyebrow">От измерений к решениям</span>
            <h3>Что хотите узнать о моделях?</h3>
            <p>Сравните подходы, разберитесь в результатах<br />или найдите технологию для своей задачи.</p>
            <div className="rag__suggestions">
              {SUGGESTIONS.map((item) => (
                <button key={item} type="button" onClick={() => void ask(item)} disabled={busy || !historyReady || historyFull}>
                  <span>{item}</span><Icon name="arrow" size={16} />
                </button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn, index) => (
          <div key={index} className="rag__turn">
            <p className="rag__question">{turn.question}</p>
            <div className="rag__answer">
              <span className="rag__speaker"><Icon name="spark" size={14} /> Агент</span>
              {turn.thinking && <details className="rag__thinking"><summary>Thinking</summary><AgentMarkdown text={turn.thinking} /></details>}
              <AgentMarkdown text={turn.answer} />
              <AgentCharts charts={turn.charts} />
              {turn.sources.length > 0 && (
                <details className="rag__sources">
                  <summary>Источники ответа: {turn.sources.length}</summary>
                  <ul>
                    {turn.sources.map((source) => (
                      <li key={`${source.source_type}-${source.source_key}`}>
                        <span className="rag__source-type">
                          {source.source_type === 'recommendation' ? 'таблица рекомендаций' : source.source_type === 'agent_tool' ? 'инструмент агента' : 'измерение'}
                        </span>{' '}
                        <br />
                        {source.content}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <p className="rag__model">Модель агента: {turn.model}</p>
            </div>
          </div>
        ))}
        {pending && (
          <div className="rag__turn">
            <p className="rag__question">{pending.question}</p>
            <div className="rag__answer" aria-busy={busy}>
              <span className="rag__speaker"><Icon name="spark" size={14} /> Агент</span>
              {pending.thinking && <details className="rag__thinking"><summary>Thinking</summary><AgentMarkdown text={pending.thinking} /></details>}
              {pending.answer && <AgentMarkdown text={pending.answer} />}
              <p className="rag__model" role="status">{stage}</p>
            </div>
          </div>
        )}
      </div>

      {error && <p className="rag__error">{error}</p>}

      <form
        className="rag__form"
        onSubmit={(event) => {
          event.preventDefault();
          void ask(question);
        }}
      >
        <textarea
          rows={2}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Задайте вопрос по экспериментам…"
          onKeyDown={event => {
            if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void ask(question);
            }
          }}
          disabled={busy || !historyReady || historyFull}
          maxLength={2000}
          aria-label="Вопрос боту"
        />
        <div className="rag__composer-footer">
          <div className="rag__composer-actions">
            <button type="button" className="rag__reindex" aria-pressed={thinking}
              disabled={busy} onClick={() => setThinking(value => !value)}>
              <Icon name="spark" size={15} />Thinking: {thinking ? 'включён' : 'выключен'}
            </button>
            <button type="button" className="rag__reindex rag__delete" onClick={() => void deleteChat()}
              disabled={!historyReady || (busy && !request.current)}><Icon name="trash" size={15} />Удалить чат</button>
          </div>
          {busy && pending ? <button type="button" className="rag__reindex" onClick={() => request.current?.abort()}>Остановить</button>
            : <button type="submit" className="rag__send" disabled={busy || !historyReady || historyFull || !question.trim()}>Отправить<Icon name="arrow" size={17} /></button>}
        </div>
      </form>
      <p className="rag__footnote">Проверяйте выводы по источникам. Первый ответ может занять больше времени из-за загрузки модели.</p>
    </section>
  );
}
