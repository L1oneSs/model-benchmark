// Start Vite with VITE_MODEL_SOURCE=local and isolated Chrome on port 9334.
// Exercise all six real TF.js models with all external HTTP requests blocked.
import assert from 'node:assert/strict';
const targets = await (await fetch('http://localhost:9334/json/list')).json();
const target = targets.find(item => item.type === 'page');
const socket = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
let id = 0;
const pending = new Map();
const blocked = [];
const local = new Set();
function call(method, params = {}) {
  return new Promise((resolve, reject) => {
    const requestId = ++id;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Timeout: ${method}`)); }, 180000);
    pending.set(requestId, { resolve, reject, timer });
    socket.send(JSON.stringify({ id: requestId, method, params }));
  });
}
socket.onmessage = async event => {
  const message = JSON.parse(event.data);
  if (message.method === 'Fetch.requestPaused') {
    const { requestId, request } = message.params;
    const url = new URL(request.url);
    if (url.protocol.startsWith('http') && !['localhost', '127.0.0.1'].includes(url.hostname)) {
      blocked.push(request.url);
      await call('Fetch.failRequest', { requestId, errorReason: 'BlockedByClient' });
    } else {
      if (url.pathname.startsWith('/models/')) local.add(url.pathname);
      await call('Fetch.continueRequest', { requestId });
    }
  }
  if (message.id) {
    const request = pending.get(message.id);
    if (request) {
      pending.delete(message.id);
      clearTimeout(request.timer);
      message.error ? request.reject(message.error) : request.resolve(message.result);
    }
  }
};
try {
  await call('Fetch.enable', { patterns: [{ urlPattern: '*' }] });
  await call('Network.enable');
  await call('Network.setCacheDisabled', { cacheDisabled: true });
  await call('Page.navigate', { url: 'http://127.0.0.1:5174' });
  for (const [name, expression] of [
    ['USE', "model.runTextClassification('This is a great product.', 'webgl')"],
    ['Toxicity', "model.runTextModeration('You are an idiot.', 'webgl')"],
    ['MobileBERT', "model.runQuestionAnswering('Question: Where does Alice live?\\n\\nContext: Alice lives in London.', 'webgl')"],
    ['MobileNet', "model.runImageClassification(await image('/samples/object-detection.jpg'), 'webgl')"],
    ['COCO-SSD', "model.runObjectDetection(await image('/samples/object-detection.jpg'), 'webgl')"],
    ['Face Detector', "model.runFaceCounting(await image('/samples/face-counting.jpg'), 'webgl')"],
  ]) {
    const result = await call('Runtime.evaluate', {
      expression: `(async () => { const model = await import('/src/models/tensorflow.ts');
        async function image(url) { const value = new Image(); value.src = url; await value.decode(); return value; }
        return await ${expression}; })()`,
      awaitPromise: true, returnByValue: true,
    });
    assert.ok(!result.exceptionDetails, JSON.stringify(result.exceptionDetails));
    const outcome = result.result.value;
    assert.equal(outcome.status, 'ok', JSON.stringify(outcome));
    assert.equal(outcome.settings.model_source, 'local');
    console.log(name, outcome.output_summary);
  }
  assert.deepEqual(blocked, [], `External requests attempted: ${blocked.join(', ')}`);
  for (const folder of ['model-a', 'model-b', 'toxicity', 'qna', 'coco-ssd', 'face-detector']) {
    assert.ok([...local].some(path => path.startsWith(`/models/${folder}/`)), `Not requested: ${folder}`);
  }
  assert.ok(local.has('/models/model-b/vocab.json'));
  assert.ok(local.has('/models/qna/processed_vocab.json'));
  console.log('All six models OK; weights and vocabularies local; no external HTTP requests.');
} finally {
  await call('Browser.close').catch(() => {});
  socket.close();
}
