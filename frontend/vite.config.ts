import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  css: {
    // Современный компилятор Sass: без него dart-sass ругается на устаревший JS API
    preprocessorOptions: { scss: { api: 'modern-compiler' } },
  },
  server: {
    host: true,
    port: 5173,
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
