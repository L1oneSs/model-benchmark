import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from '../frontend/node_modules/vite/dist/node/index.js';

async function moduleUrl(path, rewrite = source => source) {
  const source = rewrite(await readFile(new URL(path, import.meta.url), 'utf8'));
  const { code } = await transformWithOxc(source, path);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}

const moderationUrl = await moduleUrl('../frontend/src/benchmark/moderation.ts');
const formatUrl = await moduleUrl('../frontend/src/benchmark/objectDetection.ts', source => source.replace("'./moderation'", JSON.stringify(moderationUrl)));
const faceUrl = await moduleUrl('../frontend/src/benchmark/faceCounting.ts');
const { COCO_CLASSES, parseObjectCounts, formatObjectCounts, formatExperimentOutput } = await import(formatUrl);
assert.equal(COCO_CLASSES.length, 80);
assert.equal(new Set(COCO_CLASSES).size, 80);
assert.deepEqual(parseObjectCounts('```json\n{"person":2,"car":0,"kite":1}\n```'), { person: 2, kite: 1 });
const allZeros = JSON.stringify(Object.fromEntries(COCO_CLASSES.map(label => [label, 0])));
assert.equal(formatExperimentOutput('object_detection', `\`\`\`json\n${allZeros}\n\`\`\``), 'Объекты не обнаружены');
assert.equal(formatObjectCounts({ person: 2, kite: 1 }), 'Объектов: 3 · person: 2, kite: 1');
for (const invalid of ['{"person":-1}', '{"person":1.5}', '{"person":"2"}', '{"dragon":1}', '[]', 'null', '{"person":']) {
  assert.throws(() => parseObjectCounts(invalid));
}
assert.equal(formatExperimentOutput('object_detection', '{"person":'), 'Некорректный JSON в ответе модели — повторите измерение');
assert.equal(formatExperimentOutput('other', allZeros), allZeros);

const nanoUrl = await moduleUrl('../frontend/src/models/geminiNano.ts', source => source
  .replace("'../benchmark/objectDetection'", JSON.stringify(formatUrl))
  .replace("'../benchmark/faceCounting'", JSON.stringify(faceUrl))
  .replace("'../benchmark/moderation'", JSON.stringify(moderationUrl))
  .replace(/import \{ elapsed, heapDelta, heapUsedMb, now, withTotal \} from '[^']+';/,
    'const now = () => performance.now(); const elapsed = started => performance.now() - started; const heapUsedMb = () => 0; const heapDelta = () => 0; const withTotal = metrics => ({...metrics, total_ms: metrics.load_ms + metrics.inference_ms});'));
const nano = await import(nanoUrl);
let answer = `\`\`\`json\n${allZeros}\n\`\`\``;
let destroyed = 0, closed = 0, input;
globalThis.createImageBitmap = async () => ({ close() { closed++; } });
globalThis.LanguageModel = {
  availability: async () => 'available',
  create: async () => ({ prompt: async value => { input = value; return answer; }, destroy() { destroyed++; } }),
};
let result = await nano.runObjectDetection({});
assert.equal(result.status, 'ok');
assert.equal(result.output_summary, 'Объекты не обнаружены');
assert.equal(result.settings.objects_count, 0);
assert.equal(input[0].content[1].type, 'image');
answer = '{"person":2,"kite":1}';
result = await nano.runObjectDetection({});
assert.equal(result.output_summary, 'Объектов: 3 · person: 2, kite: 1');
assert.equal(result.settings.objects_count, 3);
answer = '{"person":';
result = await nano.runObjectDetection({});
assert.equal(result.status, 'error');
assert.equal(destroyed, 3);
assert.equal(closed, 3);
globalThis.LanguageModel.availability = async () => 'unavailable';
result = await nano.runObjectDetection({});
assert.equal(result.status, 'unsupported');
assert.equal(destroyed, 3);
console.log('PASS: zero counts, old records, valid counts, invalid answers, image input and resource cleanup');
