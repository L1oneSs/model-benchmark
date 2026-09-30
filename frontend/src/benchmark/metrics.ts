/** Снятие метрик. Всё измеряется в браузере: и TensorFlow.js, и Gemini Nano
 *  исполняются на стороне клиента, сервер получает уже готовые числа. */

import type { Environment, RunMetrics } from './types';

/** Монотонные часы страницы. performance.now() не зависит от перевода
 *  системного времени и даёт доли миллисекунды. */
export const now = (): number => performance.now();

export const elapsed = (from: number): number => Math.round((performance.now() - from) * 100) / 100;

interface PerformanceWithMemory extends Performance {
  memory?: { usedJSHeapSize: number };
}

/** Занятая JS-куча в мегабайтах. Доступно только в Chrome и браузерах на его
 *  основе — ровно там, где живёт Gemini Nano, так что для стенда этого хватает. */
export function heapUsedMb(): number | null {
  const memory = (performance as PerformanceWithMemory).memory;
  if (!memory || typeof memory.usedJSHeapSize !== 'number') return null;
  return Math.round((memory.usedJSHeapSize / 1024 / 1024) * 100) / 100;
}

/** Прирост кучи за прогон. Отрицательные значения отбрасываем: между замерами
 *  мог отработать сборщик мусора, и такое число ничего не говорит о модели. */
export function heapDelta(before: number | null): number | undefined {
  if (before === null) return undefined;
  const after = heapUsedMb();
  if (after === null) return undefined;
  const delta = Math.round((after - before) * 100) / 100;
  return delta >= 0 ? delta : undefined;
}

interface GpuAdapterInfo {
  vendor?: string;
  architecture?: string;
  device?: string;
}

/** Модель видеоадаптера. Именно она решает, доступна ли встроенная парадигма:
 *  порог — более 4 ГБ видеопамяти, встроенная графика его обычно не берёт. */
function readGpuRenderer(): string | null {
  try {
    const canvas = document.createElement('canvas');
    const gl = (canvas.getContext('webgl2') ?? canvas.getContext('webgl')) as WebGLRenderingContext | null;
    if (!gl) return null;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (!info) return null;
    return String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL));
  } catch {
    return null;
  }
}

export async function collectEnvironment(): Promise<Environment> {
  const nav = navigator as Navigator & { deviceMemory?: number };

  let webgpu = false;
  let adapterLabel: string | null = null;
  try {
    const gpu = (navigator as Navigator & {
      gpu?: { requestAdapter(): Promise<{ info?: GpuAdapterInfo } | null> };
    }).gpu;
    const adapter = gpu ? await gpu.requestAdapter() : null;
    webgpu = Boolean(adapter);
    if (adapter?.info) {
      const { vendor, architecture, device } = adapter.info;
      adapterLabel = [vendor, architecture, device].filter(Boolean).join(' / ') || null;
    }
  } catch {
    webgpu = false;
  }

  const chrome = navigator.userAgent.match(/Chrome\/([\d.]+)/);

  return {
    user_agent: navigator.userAgent,
    chrome_version: chrome ? chrome[1] : null,
    platform: nav.platform ?? 'unknown',
    hardware_concurrency: navigator.hardwareConcurrency ?? 0,
    device_memory_gb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    webgpu_available: webgpu,
    gpu_renderer: readGpuRenderer(),
    gpu_adapter: adapterLabel,
    visibility: document.visibilityState,
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio}`,
    language: navigator.language,
    measured_at: new Date().toISOString(),
  };
}

/** Полное время сценария выводим из составляющих, а не меряем отдельно:
 *  так сумма всегда сходится с частями. */
export function withTotal(metrics: RunMetrics): RunMetrics {
  const load = metrics.load_ms ?? 0;
  const inference = metrics.inference_ms ?? 0;
  return { ...metrics, total_ms: Math.round((load + inference) * 100) / 100 };
}

export const formatMs = (value: number | undefined): string =>
  value === undefined ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 1 })} мс`;

export const formatMb = (value: number | undefined): string =>
  value === undefined ? '—' : `${value.toLocaleString('ru-RU', { maximumFractionDigits: 2 })} МБ`;
