import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from '../frontend/node_modules/vite/dist/node/index.js';

async function load(file) {
  const source = (await readFile(new URL(file, import.meta.url), 'utf8')).replace('import.meta.env.VITE_API_BASE_URL', '"http://test"');
  const { code } = await transformWithOxc(source, file);
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
  removeItem: (key) => storage.delete(key),
};
const turn = { question: 'Вопрос', answer: 'Ответ 😀', thinking: 'Отдельно', model: 'test', sources: [] };

const { askAgent, fetchAgentHistory, deleteAgentHistory } = await load('../frontend/src/api/agentApi.ts');
const events = [{ type: 'thinking', text: 'Отдельно' }, { type: 'token', text: 'Ответ 😀' }, { type: 'done', result: turn }];
const bytes = new TextEncoder().encode(events.map(JSON.stringify).join('\n'));
globalThis.fetch = async (url, options) => {
  assert.equal(JSON.parse(options.body).thinking, true);
  assert.equal(JSON.parse(options.body).history, undefined);
  assert.ok(options.headers['X-Agent-Chat']);
  return new Response(new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } }));
};
const received = [];
assert.deepEqual(await askAgent('Вопрос', e => received.push(e), undefined,
  { thinking: true }), turn);
assert.deepEqual(received, events);
globalThis.fetch = async () => new Response('{"type":"token","text":"incomplete"}\n');
await assert.rejects(() => askAgent('Question', () => {}), /не полностью/);
let id;
globalThis.fetch = async (url, options) => {
  assert.ok(url.endsWith('/api/agent/history'));
  id ??= options.headers['X-Agent-Chat'];
  assert.equal(options.headers['X-Agent-Chat'], id);
  return Response.json({ turns: options.method === 'DELETE' ? [] : [turn], limit: 30 });
};
assert.deepEqual((await fetchAgentHistory()).turns, [turn]);
assert.deepEqual((await deleteAgentHistory()).turns, []);
storage.set('benchmark.rag.history.v1', JSON.stringify([turn]));
let imports = 0;
globalThis.fetch = async (url, options) => {
  if (url.endsWith('/history/import')) {
    imports++;
    assert.deepEqual(JSON.parse(options.body).turns, [turn]);
  }
  return Response.json({ turns: [turn], limit: 30 });
};
await fetchAgentHistory();
await fetchAgentHistory();
assert.equal(imports, 1);
assert.equal(storage.has('benchmark.rag.history.v1'), false);
globalThis.fetch = async () => Response.json({ detail: 'History limit reached' }, { status: 409 });
await assert.rejects(() => askAgent('Question', () => {}), /History limit reached/);
console.log('Server history API, stable chat ID, limit error, fragmented UTF-8 stream: OK');
