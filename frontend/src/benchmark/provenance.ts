import type { ExperimentInput, RunOutcome } from './types';
import type { RunnerOptions } from './runner';

declare const __BENCHMARK_BUILD__: Record<string, unknown>;

export async function digest(value: string | ArrayBuffer): Promise<string | null> {
  if (!globalThis.crypto?.subtle) return null;
  const bytes = typeof value === 'string' ? new TextEncoder().encode(value) : value;
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), x => x.toString(16).padStart(2, '0')).join('');
}

const safe = (fn: () => unknown) => { try { return fn(); } catch { return null; } };

export function browserSnapshot() {
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: {effectiveType?: string; downlink?: number; rtt?: number; saveData?: boolean; type?: string};
  };
  const memory = (performance as Performance & {memory?: {usedJSHeapSize: number; totalJSHeapSize: number; jsHeapSizeLimit: number}}).memory;
  const connection = nav.connection;
  return {
    wall_time: new Date().toISOString(), monotonic_ms: performance.now(), time_origin: performance.timeOrigin,
    visibility: document.visibilityState, focused: document.hasFocus(), online: nav.onLine,
    secure_context: globalThis.isSecureContext, cross_origin_isolated: globalThis.crossOriginIsolated,
    languages: [...navigator.languages], language: navigator.language, platform: navigator.platform,
    user_agent: navigator.userAgent, vendor: navigator.vendor, logical_cpus: navigator.hardwareConcurrency,
    device_memory_gb_approximate: nav.deviceMemory ?? null, touch_points: navigator.maxTouchPoints,
    webdriver: navigator.webdriver, cookie_enabled: navigator.cookieEnabled,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone, utc_offset_minutes: new Date().getTimezoneOffset(),
    screen: {width: screen.width, height: screen.height, available_width: screen.availWidth,
      available_height: screen.availHeight, color_depth: screen.colorDepth, pixel_depth: screen.pixelDepth,
      orientation: screen.orientation?.type ?? null, device_pixel_ratio: devicePixelRatio},
    viewport: {width: innerWidth, height: innerHeight, scale: visualViewport?.scale ?? null},
    network: connection ? {effective_type: connection.effectiveType ?? null, downlink_mbps: connection.downlink ?? null,
      rtt_ms: connection.rtt ?? null, save_data: connection.saveData ?? null, type: connection.type ?? null} : null,
    js_heap_bytes: memory ? {used: memory.usedJSHeapSize, allocated: memory.totalJSHeapSize, limit: memory.jsHeapSizeLimit} : null,
    page: {origin: location.origin, path: location.pathname, protocol: location.protocol},
    capabilities: {webassembly: typeof WebAssembly !== 'undefined', shared_array_buffer: typeof SharedArrayBuffer !== 'undefined',
      webgpu: 'gpu' in navigator, worker: typeof Worker !== 'undefined', offscreen_canvas: typeof OffscreenCanvas !== 'undefined'},
  };
}

async function hardwareDetails() {
  const result: Record<string, unknown> = {};
  const nav = navigator as Navigator & {
    userAgentData?: { getHighEntropyValues: (hints: string[]) => Promise<unknown> };
    gpu?: {requestAdapter: () => Promise<{info?: unknown; features: Iterable<string>; limits: object} | null>};
  };
  try { result.client_hints = await nav.userAgentData?.getHighEntropyValues(['architecture', 'bitness', 'model', 'platformVersion', 'fullVersionList']) ?? null; } catch { result.client_hints = null; }
  try {
    const adapter = await nav.gpu?.requestAdapter();
    const info = adapter?.info as Record<string, unknown> | undefined;
    result.webgpu = adapter ? {info: info ? Object.fromEntries(['vendor', 'architecture', 'device', 'description', 'subgroupMinSize', 'subgroupMaxSize'].map(k => [k, safe(() => info[k]) ?? null])) : null,
      features: Array.from(adapter.features), limits: Object.fromEntries(Object.keys(Object.getPrototypeOf(adapter.limits))
        .map(k => [k, safe(() => (adapter.limits as unknown as Record<string, unknown>)[k])])
        .filter(([, value]) => typeof value === 'number'))} : null;
  } catch { result.webgpu = null; }
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
  if (gl) {
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    result.webgl = {version: gl.getParameter(gl.VERSION), shading_language: gl.getParameter(gl.SHADING_LANGUAGE_VERSION),
      vendor: info ? gl.getParameter(info.UNMASKED_VENDOR_WEBGL) : null,
      renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : null,
      max_texture_size: gl.getParameter(gl.MAX_TEXTURE_SIZE), max_renderbuffer_size: gl.getParameter(gl.MAX_RENDERBUFFER_SIZE),
      extensions: gl.getSupportedExtensions()};
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
  return result;
}

async function inputDetails(input: ExperimentInput) {
  if (input.kind === 'text') return {kind: 'text', name: 'manual-text', source: 'experiment input field',
    version: null, version_note: 'exact input identified by sha256', text: input.text, encoding: 'UTF-8',
    characters: input.text.length, code_points: Array.from(input.text).length,
    words: input.text.trim() ? input.text.trim().split(/\s+/).length : 0,
    lines: input.text.split(/\r?\n/).length, bytes: new TextEncoder().encode(input.text).byteLength,
    sha256: await digest(input.text), hash_scope: 'exact UTF-8 text, no normalization'};
  const result: Record<string, unknown> = {kind: 'image', label: input.label, width: input.element.naturalWidth,
    height: input.element.naturalHeight, source: input.file ? 'uploaded_file' : safe(() => new URL(input.element.currentSrc).pathname),
    file_name: input.file?.name ?? null, last_modified: input.file?.lastModified ?? null};
  try {
    const blob = input.file ?? await (await fetch(input.element.currentSrc)).blob();
    result.bytes = blob.size; result.mime_type = blob.type; result.sha256 = await digest(await blob.arrayBuffer());
    result.hash_scope = 'original file bytes';
  } catch { result.sha256 = null; result.hash_unavailable_reason = 'source bytes unavailable, possibly CORS'; }
  return result;
}

export async function prepareProvenance(input: ExperimentInput, options: RunnerOptions) {
  const {onProgress: _progress, ...parameters} = options;
  const context = {schema_version: 1, run_id: globalThis.crypto?.randomUUID?.() ?? `client-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`, created_at: new Date().toISOString(),
    code: typeof __BENCHMARK_BUILD__ === 'undefined' ? null : __BENCHMARK_BUILD__,
    data: await inputDetails(input), parameters,
    protocol: {order: 'sequential', warmup_excluded: options.discardFirst, warmup_calls_per_configuration: options.discardFirst ? 1 : 0,
      requested_repeats: options.repeats, timer: 'performance.now()', time_unit: 'ms', memory_unit: 'MiB',
      seed: null, seed_reason: 'adapters do not expose one common seed control'},
    browser: browserSnapshot(), hardware: await hardwareDetails()};
  let visibilityChanges = 0;
  const changed = () => { visibilityChanges += 1; };
  document.addEventListener('visibilitychange', changed);
  return {
    stop: () => document.removeEventListener('visibilitychange', changed),
    async invoke<T extends RunOutcome>(attempt: number, call: () => Promise<T>): Promise<T> {
      const before = browserSnapshot();
      const resourcesStart = performance.now();
      const visibilityBefore = visibilityChanges;
      const outcome = await call();
      const after = browserSnapshot();
      const resources = performance.getEntriesByType('resource').filter(entry => entry.startTime >= resourcesStart)
        .slice(-100).map(entry => {
          const r = entry as PerformanceResourceTiming;
          return {source: safe(() => { const u = new URL(r.name); return u.origin + u.pathname; }),
            initiator: r.initiatorType, duration_ms: r.duration, transfer_bytes: r.transferSize,
            encoded_bytes: r.encodedBodySize, decoded_bytes: r.decodedBodySize,
            protocol: r.nextHopProtocol, start_ms: r.startTime};
        });
      return {...outcome, metadata: {...context, execution: {attempt: attempt + 1,
        before, after, visibility_changes: visibilityChanges - visibilityBefore,
        resources, resources_limit: 100, resource_sizes_may_be_hidden_by_cors: true,
        adapter_wall_ms: after.monotonic_ms - before.monotonic_ms},
        adapter_metadata: outcome.metadata ?? null}};
    },
  };
}
