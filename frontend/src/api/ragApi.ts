/** Обращения к RAG-боту. Модель локальная, поэтому первый ответ после
 *  запуска стенда может занять до минуты — Ollama прогревает веса. */

import type { RagAnswer, RagSource } from '../benchmark/types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

export interface Turn extends RagAnswer { question: string }
export interface RagHistory { turns: Turn[]; limit: number }

function chatHeaders(): Record<string, string> {
  const key = 'benchmark.rag.chat-id.v1';
  let id = localStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(key, id);
  }
  return { 'Content-Type': 'application/json', 'X-Rag-Chat': id };
}

async function responseError(response: Response): Promise<Error> {
  const data = await response.json().catch(() => null);
  return new Error(typeof data?.detail === 'string' ? data.detail : `Ошибка сервера: ${response.status}`);
}

export async function fetchRagHistory(): Promise<RagHistory> {
  const legacyKey = 'benchmark.rag.history.v1';
  const legacy = localStorage.getItem(legacyKey);
  if (legacy) {
    let turns: unknown;
    try { turns = JSON.parse(legacy); } catch { /* Invalid old history is left untouched. */ }
    if (Array.isArray(turns) && turns.length) {
      const migrated = await fetch(`${BASE_URL}/api/rag/history/import`, {
        method: 'POST', headers: chatHeaders(), body: JSON.stringify({ turns: turns.slice(-30) }),
      });
      if (!migrated.ok) throw await responseError(migrated);
      localStorage.removeItem(legacyKey);
    }
  }
  const response = await fetch(`${BASE_URL}/api/rag/history`, { headers: chatHeaders(), cache: 'no-store' });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export async function deleteRagHistory(): Promise<RagHistory> {
  const response = await fetch(`${BASE_URL}/api/rag/history`, { method: 'DELETE', headers: chatHeaders() });
  if (!response.ok) throw await responseError(response);
  return response.json();
}

export type RagEvent =
  | { type: 'status'; message: string }
  | { type: 'sources'; sources: RagSource[]; model: string }
  | { type: 'token'; text: string }
  | { type: 'thinking'; text: string }
  | { type: 'done'; result: RagAnswer }
  | { type: 'error'; message: string };

export async function askRag(question: string, onEvent: (event: RagEvent) => void, signal?: AbortSignal,
  options: { thinking: boolean } = { thinking: false },
): Promise<RagAnswer> {
  const response = await fetch(`${BASE_URL}/api/rag/ask?stream=true`, {
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
  let result: RagAnswer | undefined;
  const consume = (line: string) => {
    if (!line.trim()) return;
    const event = JSON.parse(line) as RagEvent;
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

export async function reindexRag(): Promise<number> {
  const response = await fetch(`${BASE_URL}/api/rag/reindex`, { method: 'POST' });
  if (!response.ok) throw new Error(`Переиндексация не удалась: ${response.status}`);
  const data = (await response.json()) as { indexed: number };
  return data.indexed;
}
