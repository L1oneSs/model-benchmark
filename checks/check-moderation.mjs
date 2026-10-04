import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { transformWithOxc } from '../frontend/node_modules/vite/dist/node/index.js';

async function moduleUrl(path, rewrite = source => source) {
  const { code } = await transformWithOxc(rewrite(await readFile(new URL(path, import.meta.url), 'utf8')), path);
  return `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
}
const moderationUrl = await moduleUrl('../frontend/src/benchmark/moderation.ts');
const { parseModerationReply, formatModerationFlags, formatSavedModeration, formatModerationScores } = await import(moderationUrl);
const json = '```json\n{"toxic":true,"insult":true,"threat":false,"obscene":false,"identity_attack":false,"label":"toxic_insult"}\n```';
assert.equal(formatSavedModeration(json), 'Выявлено: Оскорбления, Токсичность');
assert.equal(formatModerationFlags(parseModerationReply('{"toxic":false,"insult":false}')), 'Нарушения не отмечены');
assert.equal(formatSavedModeration('not flagged ? identity_attack: 0.1%; insult: 65.2%; obscene: 0.0%; toxicity: 68.6%'),
  'Порог 75% не достигнут · Токсичность: 68,6% · Оскорбления: 65,2%');
assert.match(formatSavedModeration('flagged: insult, toxicity ? insult: 90.0%; toxicity: 95.0%'), /^Выявлено: Оскорбления, Токсичность/);
assert.equal(formatModerationScores({ toxicity: 0.01 }, []), 'Порог 75% не достигнут');
for (const invalid of ['{"toxic":"true"}', '[]', '{"label":"toxic"}', '{"toxic":']) assert.throws(() => parseModerationReply(invalid));
const objectUrl = await moduleUrl('../frontend/src/benchmark/objectDetection.ts', source => source.replace("'./moderation'", JSON.stringify(moderationUrl)));
const faceUrl = await moduleUrl('../frontend/src/benchmark/faceCounting.ts');
const nanoUrl = await moduleUrl('../frontend/src/models/geminiNano.ts', source => source
  .replace("'../benchmark/objectDetection'", JSON.stringify(objectUrl))
  .replace("'../benchmark/faceCounting'", JSON.stringify(faceUrl))
  .replace("'../benchmark/moderation'", JSON.stringify(moderationUrl))
  .replace(/import \{ elapsed, heapDelta, heapUsedMb, now, withTotal \} from '[^']+';/,
    'const now = () => performance.now(); const elapsed = started => performance.now() - started; const heapUsedMb = () => 0; const heapDelta = () => 0; const withTotal = metrics => ({...metrics, total_ms: metrics.load_ms + metrics.inference_ms});'));
const nano = await import(nanoUrl);
let answer = json, destroyed = 0;
globalThis.LanguageModel = {
  availability: async () => 'available',
  create: async () => ({ prompt: async () => answer, destroy() { destroyed++; } }),
};
const outcome = await nano.runTextModeration('Test');
assert.equal(outcome.status, 'ok');
assert.equal(outcome.output_summary, 'Выявлено: Оскорбления, Токсичность');
assert.equal(outcome.settings.category_flags.insult, true);
answer = '{"toxic":"true"}';
assert.equal((await nano.runTextModeration('Test')).status, 'error');
assert.equal(destroyed, 2);
console.log('PASS: saved JSON, legacy probabilities, threshold, flags, invalid replies and adapter cleanup');
