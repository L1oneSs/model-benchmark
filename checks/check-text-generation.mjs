import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { transformWithOxc } from '../frontend/node_modules/vite/dist/node/index.js';

// Exercise the adapter without downloading model weights or running expensive inference.
const source = await readFile(new URL('../frontend/src/models/tensorflow.ts', import.meta.url), 'utf8');
const functionSource = source.slice(source.indexOf('export async function runTextGeneration('), source.indexOf('type TranslationPipelineResult'));
let observedPrompt, observedOptions, calls = 0, answer = 'A short answer.';
globalThis.generationCheckPipeline = async (prompt, options) => {
  observedPrompt = prompt;
  observedOptions = options;
  calls++;
  return [{ generated_text: [...prompt, { role: 'assistant', content: answer }] }];
};
const { code } = await transformWithOxc(`
const TEXT_GENERATION_MODEL = 'HuggingFaceTB/SmolLM2-360M-Instruct';
const TEXT_GENERATION_MODEL_NAME = 'SmolLM2 360M Instruct (Transformers.js / ONNX)';
const now = () => performance.now();
const elapsed = started => performance.now() - started;
const heapUsedMb = () => 0;
const heapDelta = () => 0;
const withTotal = metrics => metrics;
const loadTextGenerationPipeline = async () => ({ generator: globalThis.generationCheckPipeline, loadMs: 0 });
${source.slice(source.indexOf('function readChatGeneratedText('), source.indexOf('function readGeneratedText('))}
const failure = (model_name, settings, error) => ({ status: 'error', model_name, settings, error: error.message });
${functionSource}`, 'generation-adapter.ts');
const { runTextGeneration } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const instruction = 'Explain how browser machine learning preserves privacy.';
const result = await runTextGeneration(`  ${instruction}  `);
assert.equal(result.status, 'ok');
assert.equal(observedPrompt.at(-1).content, instruction);
assert.equal(observedPrompt.at(-1).role, 'user');
assert.equal(result.output_summary, answer);
assert.equal(observedOptions.do_sample, false);
assert.equal(observedOptions.return_full_text, false);
assert.equal(observedOptions.repetition_penalty, 1.1);
assert.equal(observedOptions.no_repeat_ngram_size, 4);
assert.equal(result.settings.model, 'HuggingFaceTB/SmolLM2-360M-Instruct');
assert.equal((await runTextGeneration('   ')).status, 'error');
assert.equal(calls, 1);
answer = '   ';
assert.equal((await runTextGeneration(instruction)).status, 'error');
delete globalThis.generationCheckPipeline;
console.log('PASS: chat instruction, assistant-only output, decoding settings and empty input/output');

if (process.argv.includes('--live')) {
  const { pipeline, env } = await import('../frontend/node_modules/@huggingface/transformers/dist/transformers.node.mjs');
  env.cacheDir = fileURLToPath(new URL('../artifacts/generation-model-cache/', import.meta.url));
  const generator = await pipeline('text-generation', result.settings.model, {
    dtype: 'q8', device: 'cpu', session_options: { intraOpNumThreads: 2, interOpNumThreads: 1 },
    progress_callback: event => {
      if (event.status === 'done') console.log('Downloaded:', event.file);
    },
  });
  try {
    for (const instruction of [
      'What is the capital of France? Answer in one sentence.',
      'Write two sentences explaining why processing data locally in the browser can improve privacy.',
      'Write a short benchmark note explaining when Gemini Nano is preferable for browser machine learning.',
    ]) {
      const output = await generator([
        { role: 'system', content: 'You are a helpful assistant. Answer in English in two or three concise sentences.' },
        { role: 'user', content: instruction },
      ], observedOptions);
      const response = output[0].generated_text.at(-1).content.trim();
      assert.ok(response.length > 0, 'Real model returned an empty response');
      if (instruction.includes('France')) assert.match(response, /Paris/i);
      const words = response.toLowerCase().match(/[a-z]+/g) ?? [];
      const phrases = new Map();
      for (let i = 0; i + 6 <= words.length; i++) {
        const phrase = words.slice(i, i + 6).join(' ');
        const count = (phrases.get(phrase) ?? 0) + 1;
        assert.ok(count < 3, `Repeated phrase loop: ${phrase}`);
        phrases.set(phrase, count);
      }
      console.log(JSON.stringify({ instruction, response }));
    }
  } finally {
    await generator.dispose();
  }
}
