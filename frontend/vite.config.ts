import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(fileURLToPath(import.meta.url));

const hash = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const read = (path: string) => { try { return readFileSync(join(ROOT, path)); } catch { return null; } };
const git = (...args: string[]) => { try { return execFileSync('git', args, {encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore']}).trim(); } catch { return null; } };
const files: Record<string, string> = {};
function collect(directory: string) {
  for (const entry of readdirSync(directory, {withFileTypes: true})) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) collect(path);
    else files[relative(ROOT, path).replaceAll('\\', '/')] = hash(readFileSync(path));
  }
}
collect(join(ROOT, 'src'));
for (const path of ['package.json', 'package-lock.json', 'vite.config.ts', 'tsconfig.json']) {
  const bytes = read(path); if (bytes) files[path] = hash(bytes);
}
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));
const versions = Object.fromEntries([...new Set([...Object.keys({...pkg.dependencies, ...pkg.devDependencies}),
  'onnxruntime-web', 'onnxruntime-common', '@tensorflow/tfjs-core', '@tensorflow/tfjs-backend-cpu', '@tensorflow/tfjs-backend-webgl'])].map(name => {
  const bytes = read(join('node_modules', name, 'package.json'));
  return [name, bytes ? JSON.parse(bytes.toString()).version : null];
}));
const repository = process.env.STAND_REPOSITORY || git('config', '--get', 'remote.origin.url');
const cleanRepository = repository?.replace(/(https?:\/\/)[^/@]+@/, '$1') ?? null;
const buildInfo = {component: 'frontend', built_at: new Date().toISOString(),
  commit: process.env.STAND_GIT_COMMIT || git('rev-parse', 'HEAD'),
  dirty: process.env.STAND_GIT_DIRTY || (git('status', '--porcelain') ? 'true' : null),
  repository: cleanRepository, source_sha256: hash(JSON.stringify(Object.entries(files).sort())), files_sha256: files,
  source_hash_encoding: 'SHA-256 of JSON.stringify(sorted [path, file_sha256] pairs)',
  package_json_sha256: files['package.json'], lock_sha256: files['package-lock.json'] ?? null,
  installed_packages: versions, dependency_installation: 'Docker: npm ci --legacy-peer-deps, package-lock.json enforced'};

export default defineConfig({
  define: {__BENCHMARK_BUILD__: JSON.stringify(buildInfo)},
  plugins: [react(), tailwindcss()],
  resolve: {alias: {'@': join(ROOT, 'src')}},
  css: {
    // Современный компилятор Sass: без него dart-sass ругается на устаревший JS API
    preprocessorOptions: { scss: { api: 'modern-compiler' } },
  },
  server: {
    host: true,
    port: 5173,
    proxy: {'/api': {target: process.env.DEV_API_PROXY || 'http://localhost:8000', changeOrigin: true}},
  },
  build: {
    outDir: 'dist',
    rollupOptions: {
      output: {
        // TensorFlow.js весит заметно больше остального кода, поэтому выносим
        // его в отдельные чанки: загрузка интерфейса не ждёт библиотеку.
        // Начиная с Vite 8 (сборщик Rolldown) manualChunks принимается
        // только функцией — объектная форма больше не поддерживается.
        manualChunks(id: string) {
          if (id.includes('@tensorflow-models')) return 'tfjs-models';
          if (id.includes('tfjs-backend-wasm')) return 'tfjs-wasm';
          if (id.includes('@tensorflow')) return 'tfjs';
          return undefined;
        },
      },
    },
    chunkSizeWarningLimit: 4096,
  },
});
