import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from '../frontend/node_modules/vite/dist/node/index.js';

async function moduleUrl(path, rewrite = source => source) {
  const { code } = await transformWithOxc(rewrite(await readFile(new URL(path, import.meta.url), 'utf8')), path);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const moderationUrl = await moduleUrl('../frontend/src/benchmark/moderation.ts');
const faceUrl = await moduleUrl('../frontend/src/benchmark/faceCounting.ts');
const { parseFaceCount } = await import(faceUrl);
assert.equal(parseFaceCount('0'), 0);
assert.equal(parseFaceCount(' 3 '), 3);
assert.equal(parseFaceCount('```json\n2\n```'), 2);
for (const answer of ['-1', '2.5', '21', '{}', 'Two faces', '2 faces', '']) assert.throws(() => parseFaceCount(answer));
const objectUrl = await moduleUrl('../frontend/src/benchmark/objectDetection.ts', source => source.replace("'./moderation'", JSON.stringify(moderationUrl)));
const nanoUrl = await moduleUrl('../frontend/src/models/geminiNano.ts', source => source
  .replace("'../benchmark/objectDetection'", JSON.stringify(objectUrl))
  .replace("'../benchmark/faceCounting'", JSON.stringify(faceUrl))
  .replace("'../benchmark/moderation'", JSON.stringify(moderationUrl))
  .replace(/import \{ elapsed, heapDelta, heapUsedMb, now, withTotal \} from '[^']+';/,
    'const now = () => performance.now(); const elapsed = started => performance.now() - started; const heapUsedMb = () => 0; const heapDelta = () => 0; const withTotal = metrics => ({...metrics, total_ms: metrics.load_ms + metrics.inference_ms});'));
const nano = await import(nanoUrl);
let answer = '3', closed = 0, destroyed = 0, prompt;
globalThis.createImageBitmap = async () => ({ close() { closed++; } });
globalThis.LanguageModel = {
  availability: async () => 'available',
  create: async () => ({ prompt: async value => { prompt = value; return answer; }, destroy() { destroyed++; } }),
};
const result = await nano.runFaceCounting({});
assert.equal(result.status, 'ok');
assert.equal(result.output_summary, 'Лиц: 3');
assert.equal(result.settings.faces_count, 3);
assert.equal(prompt[0].content[1].type, 'image');
answer = '0';
assert.equal((await nano.runFaceCounting({})).settings.faces_count, 0);
answer = 'There are 3 faces';
assert.equal((await nano.runFaceCounting({})).status, 'error');
assert.equal(closed, 3); assert.equal(destroyed, 3);
globalThis.LanguageModel.availability = async () => 'unavailable';
assert.equal((await nano.runFaceCounting({})).status, 'unsupported');
console.log('PASS: face counts, zero faces, invalid replies, image input and cleanup');
