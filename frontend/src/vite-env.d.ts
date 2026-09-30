/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL: string;
  /** local — веса из public/models, cdn — из официальных хранилищ Google */
  readonly VITE_MODEL_SOURCE: 'local' | 'cdn';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
