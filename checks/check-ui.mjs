// UI smoke check: run an isolated headless Chrome on port 9333 first.
import { mkdir, writeFile } from 'node:fs/promises';
import assert from 'node:assert/strict';

const targets = await (await fetch('http://localhost:9333/json/list')).json();
const target = targets.find(target => target.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let sequence = 0;
const calls = new Map();
const errors = [];
socket.onmessage = event => {
  const data = JSON.parse(event.data);
  if (data.method === 'Runtime.exceptionThrown') errors.push(data.params.exceptionDetails.text);
  if (data.id) {
    const call = calls.get(data.id);
    if (call) { calls.delete(data.id); clearTimeout(call.timer); data.error ? call.reject(data.error) : call.resolve(data.result); }
  }
};
function send(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { calls.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    calls.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params }));
  });
}
async function evaluate(expression) {
  const result = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
  return result.result.value;
}
async function waitFor(expression) {
  for (let i = 0; i < 50; i++) {
    if (await evaluate(expression)) return;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`UI condition failed: ${expression}`);
}
async function click(text) {
  await evaluate(`Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === ${JSON.stringify(text)}).click()`);
}
async function screenshot(name) {
  await new Promise(resolve => setTimeout(resolve, 200));
  const result = await send('Page.captureScreenshot', { format: 'png' });
  await writeFile(`artifacts/ui-${name}.png`, Buffer.from(result.data, 'base64'));
}
await mkdir('artifacts', { recursive: true });
try {
  await send('Runtime.enable');
  await send('Page.enable');
  // Read-only fixture avoids creating chat rows or invoking inference during visual checks.
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `
    const originalFetch = window.fetch;
    window.fetch = (input, init) => String(input).endsWith('/api/rag/history')
      ? Promise.resolve(Response.json({turns: window.fixtureTurns || [], limit: 30}))
      : originalFetch(input, init);
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: 'http://localhost:8080' });
  await waitFor(`!!document.querySelector('.sidebar__item')`);
  await screenshot('stand-desktop');
  await click('Рекомендации');
  await waitFor(`document.querySelectorAll('.recommendations tbody tr').length > 1`);
  await screenshot('recommendations-desktop');
  await evaluate(`const field = document.querySelector('.recommendations-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'not-a-matching-criterion-987'); field.dispatchEvent(new Event('input', {bubbles:true}));`);
  await waitFor(`document.body.textContent.includes('По этому запросу ничего не найдено')`);
  await click('RAG-бот');
  await waitFor(`document.body.textContent.includes('0 / 30 ответов')`);
  assert.equal(await evaluate(`document.body.textContent.includes('сохранена на сервере')`), false);
  await click('Thinking: выключен');
  await waitFor(`!!document.querySelector('.rag__composer-actions button[aria-pressed=true]')`);
  assert.equal(await evaluate(`!!document.querySelector('.rag__form .rag__delete')`), true);
  assert.equal(await evaluate(`/Browser ML|Лаборатория моделей|Рабочее пространство|Две парадигмы. Один стенд./.test(document.body.textContent)`), false);
  await screenshot('chat-desktop');
  await send('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
  await screenshot('chat-mobile');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Chat has horizontal overflow');
  await click('Сравнение подходов');
  await waitFor(`!!document.querySelector('.recommendations')`);
  await screenshot('recommendations-mobile');
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Recommendations have horizontal overflow');
  await evaluate(`window.fixtureTurns = Array.from({length:30}, () => ({question:'Тестовый вопрос',answer:'Тестовый ответ',thinking:'',sources:[],model:'fixture'}))`);
  await click('RAG-бот');
  await waitFor(`document.body.textContent.includes('Достигнут лимит истории')`);
  assert.equal(await evaluate(`document.querySelector('.rag__send').disabled`), true);
  await click('Измерения');
  await waitFor(`!!document.querySelector('.results__table')`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Measurements have horizontal overflow');
  assert.deepEqual(errors, []);
  console.log('UI checks OK: navigation, search, thinking, history limit, mobile overflow. Screenshots: artifacts/ui-*.png');
} finally {
  await send('Browser.close').catch(() => {});
  socket.close();
}
