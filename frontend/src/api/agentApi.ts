/** Совместимый API чата агента. Локальная Ollama выбирает инструменты и формирует ответ. */

import type { AgentAnswer, AgentSource } from '../benchmark/types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export interface Turn extends AgentAnswer { question: string }
export interface AgentHistory { turns: Turn[]; limit: number }

function chatHeaders(): Record<string, string> {
  const key = 'benchmark.rag.chat-id.v1';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return { 'Content-Type': 'application/json', 'X-Agent-Chat': id };
}

async function responseError(response: Response): Promise<Error> {
  const data = await response.json().catch(() => null);
  return new Error(typeof data?.detail === 'string' ? data.detail : `Ошибка сервера: ${response.status}`);
}

export async function fetchAgentHistory(): Promise<AgentHistory> {
  const legacyKey = 'benchmark.rag.history.v1';
  const legacy = localStorage.getItem(legacyKey);
  if (legacy) {
    let turns: unknown;
    try { turns = JSON.parse(legacy); } catch { /* Invalid old history is left untouched. */ }
    if (Array.isArray(turns) && turns.length) {
      const migrated = await fetch(`${BASE_URL}/api/agent/history/import`, {
        method: 'POST', headers: chatHeaders(), body: JSON.stringify({ turns: turns.slice(-30) }),
      });
      if (!migrated.ok) throw await responseError(migrated);
      localStorage.removeItem(legacyKey);
    }
  }
  const response = await fetch(`${BASE_URL}/api/agent/history`, { headers: chatHeaders(), cache: 'no-store' });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function deleteAgentHistory(): Promise<AgentHistory> {
  const response = await fetch(`${BASE_URL}/api/agent/history`, { method: 'DELETE', headers: chatHeaders() });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'sources'; sources: AgentSource[]; model: string }
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done'; result: AgentAnswer }
  | { type: 'error'; message: string };

export async function askAgent(question: string, onEvent: (event: AgentEvent) => void, signal?: AbortSignal,
  options: { thinking: boolean } = { thinking: false },
): Promise<AgentAnswer> {
  const response = await fetch(`${BASE_URL}/api/agent/ask?stream=true`, {
    method: 'POST',
    headers: chatHeaders(),
    body: JSON.stringify({ question, ...options }),
    signal,
  });
  if (!response.ok) {
    throw await responseError(response);
  }
  if (!response.body) throw new Error('Браузер не получил поток ответа');
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: AgentAnswer | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as AgentEvent;
    if (event.type === 'error') throw new Error(event.message);
    onEvent(event);
    if (event.type === 'done') result = event.result;
  };
  try {
    while (true) {
      const { value, done } = await reader.read();
      buffer += decoder.decode(value, { stream: !done });
      let newline: number;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        consume(buffer.slice(0, newline));
        buffer = buffer.slice(newline + 1);
      }
      if (done) break;
    }
    consume(buffer);
    if (!result) throw new Error('Соединение прервано: ответ получен не полностью');
    return result;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
