// UI smoke check: run an isolated headless Chrome on port 9333 first.
import { mkdir, writeFile, readFile } from 'node:fs/promises';
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
function send(method, params = {}, sessionId) {
  return new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { calls.delete(id); reject(new Error(`Timed out: ${method}`)); }, 15000);
    calls.set(id, { resolve, reject, timer });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
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
    window.fetch = (input, init) => String(input).endsWith('/api/agent/history')
      ? Promise.resolve(Response.json({turns: window.fixtureTurns || [], limit: 30}))
      : originalFetch(input, init);
  ` });
  await send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1080, deviceScaleFactor: 1, mobile: false });
  await send('Page.navigate', { url: process.env.UI_URL || 'http://localhost:18080' });
  await waitFor(`!!document.querySelector('.sidebar__item')`);
  await screenshot('stand-desktop');
  await click('Рекомендации');
  await waitFor(`document.querySelectorAll('.recommendations tbody tr').length > 1`);
  await screenshot('recommendations-desktop');
  await evaluate(`const field = document.querySelector('.recommendations-search input'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, 'not-a-matching-criterion-987'); field.dispatchEvent(new Event('input', {bubbles:true}));`);
  await waitFor(`document.body.textContent.includes('По этому запросу ничего не найдено')`);
  await click('Агент');
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
  await evaluate(`window.fixtureTurns = [{question:'Построй график',answer:'График медиан',thinking:'',sources:[],model:'fixture',charts:[{kind:'bar',title:'Тестовый эксперимент',metric:'inference_ms',unit:'мс',points:[{label:'Модель A · wasm',value:20,samples:5},{label:'Модель B · встроенный API',value:40,samples:5}]}]}]`);
  await click('Агент');
  await waitFor(`document.querySelectorAll('.agent-chart li').length === 2`);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Chart has horizontal overflow');
  await screenshot('agent-chart-mobile');
  await click('Сравнение подходов');
  const markdown = '**Ключевые выводы:**\n\n* **WebGPU** — быстрый инференс.\n* Второй пункт\n\n| Модель | Инференс |\n| --- | --- |\n| TF.js | 75 мс |\n\n```python\nprint("result")\n```\n\n[Документация](https://example.com)\n\n[unsafe](javascript:alert%281%29)\n\n<script>window.__markdownExecuted = true</script>';
  await evaluate(`window.fixtureTurns = [{question:'Покажи результаты',answer:${JSON.stringify(markdown)},thinking:'**Рассуждение**',sources:[],model:'fixture'}]`);
  await click('Агент');
  await waitFor(`document.querySelector('.rag__markdown strong')?.textContent === 'Рассуждение'`);
  assert.equal(await evaluate(`document.querySelector('.rag__answer > .rag__markdown strong').textContent`), 'Ключевые выводы:');
  assert.equal(await evaluate(`document.querySelectorAll('.rag__answer > .rag__markdown ul li').length`), 2);
  assert.equal(await evaluate(`document.querySelectorAll('.rag__markdown table tbody tr').length`), 1);
  assert.equal(await evaluate(`document.querySelector('.rag__markdown pre code').textContent.trim()`), 'print("result")');
  assert.equal(await evaluate(`!!document.querySelector('.rag__markdown a[href^="javascript:"]')`), false);
  assert.equal(await evaluate(`!!document.querySelector('.rag__markdown script') || !!window.__markdownExecuted`), false);
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true, 'Markdown has horizontal overflow');
  await screenshot('agent-markdown-mobile');
  if (process.env.CHART_FIXTURE_FILE) {
    const charts = JSON.parse(await readFile(process.env.CHART_FIXTURE_FILE, 'utf8'));
    await click('Сравнение подходов');
    await evaluate(`window.fixtureTurns = [{question:'Графики в трёх форматах',answer:'Результаты',thinking:'',sources:[],model:'fixture',charts:${JSON.stringify(charts)}}]`);
    await click('Агент');
    await waitFor(`document.querySelector('.agent-chart img')?.naturalWidth > 0`);
    assert.equal(await evaluate(`document.querySelector('.agent-chart iframe').getAttribute('sandbox')`), 'allow-scripts');
    assert.equal(await evaluate(`document.querySelectorAll('.agent-chart').length`), 3);
    assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'), true);
    const interactive = charts.find(chart => chart.renderer === 'python_interactive');
    let plotReady = false;
    for (let attempt = 0; attempt < 40 && !plotReady; attempt++) {
      const targets = await send('Target.getTargets');
      const frame = targets.targetInfos.find(item => item.type === 'iframe' && item.url.endsWith(interactive.artifact_url));
      if (frame) {
        const attached = await send('Target.attachToTarget', { targetId: frame.targetId, flatten: true });
        const result = await send('Runtime.evaluate', { expression: `!!document.querySelector('.plotly-graph-div')?.data?.length`, returnByValue: true }, attached.sessionId);
        plotReady = result.result.value === true;
        await send('Target.detachFromTarget', { sessionId: attached.sessionId });
      }
      if (!plotReady) await new Promise(resolve => setTimeout(resolve, 100));
    }
    assert.equal(plotReady, true, 'Interactive Python chart did not execute Plotly inside sandbox');
    await evaluate(`document.querySelector('.agent-chart iframe').scrollIntoView({block:'center'})`);
    await screenshot('agent-python-mobile');
  }
  await click('Сравнение подходов');
  await evaluate(`window.fixtureTurns = Array.from({length:30}, () => ({question:'Тестовый вопрос',answer:'Тестовый ответ',thinking:'',sources:[],model:'fixture'}))`);
  await click('Агент');
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
