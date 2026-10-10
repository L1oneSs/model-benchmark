/** Общие типы стенда. Повторяют схему бэкенда: то, что здесь собрано,
 *  уходит в POST /api/measurements без преобразований. */

/** Парадигма интеграции: библиотечная или встроенная. */
export type Approach = 'tensorflow_js' | 'gemini_nano';

export type RunStatus = 'ok' | 'error' | 'unsupported';

export type TranslationDirection = 'en_ru' | 'ru_en';

/** Метрики одного прогона. Все времена в миллисекундах, память в мегабайтах. */
export interface RunMetrics {
  /** Загрузка и инициализация модели. Для встроенной парадигмы — создание сессии. */
  load_ms?: number;
  /** Время до первого предсказания: от вызова до появления первого результата. */
  first_token_ms?: number;
  /** Чистая латентность инференса без загрузки модели. */
  inference_ms?: number;
  /** Полное время сценария: загрузка плюс инференс. */
  total_ms?: number;
  /** Прирост занятой JS-кучи за прогон. */
  memory_mb?: number;
}

/** Характеристики машины и браузера — без них числа несопоставимы между запусками. */
export interface Environment {
  user_agent: string;
  chrome_version: string | null;
  platform: string;
  hardware_concurrency: number;
  /** Спецификация ограничивает значение восемью гигабайтами, поэтому 8 означает «8 и больше». */
  device_memory_gb: number | null;
  webgpu_available: boolean;
  /** Видеоадаптер по данным WEBGL_debug_renderer_info — определяет, потянет ли машина встроенную модель. */
  gpu_renderer: string | null;
  /** Поставщик и архитектура адаптера WebGPU. */
  gpu_adapter: string | null;
  /** Активна ли вкладка. В фоновой вкладке браузер душит рендеринг, и замеры WebGL становятся бессмысленными. */
  visibility: string;
  screen: string;
  language: string;
  measured_at: string;
}

/** Один прогон одного подхода. */
export interface MeasurementPayload {
  experiment_key: string;
  experiment_title: string;
  approach: Approach;
  model_name: string;
  settings: Record<string, unknown>;
  metrics: RunMetrics;
  environment: Environment;
  input_summary: string;
  output_summary: string;
  status: RunStatus;
  error_message?: string | null;
}

/** То же, но как его возвращает бэкенд. */
export interface Measurement extends MeasurementPayload {
  id: number;
  run_index: number;
  created_at: string;
}

export interface MeasurementPage {
  total: number;
  items: Measurement[];
}

/** Сводка по последним прогонам: медиана, среднее, разброс. */
export interface MetricSummary {
  median: number;
  mean: number;
  min: number;
  max: number;
  stdev: number;
  samples: number;
}

export interface ApproachSummary {
  experiment_key: string;
  approach: Approach;
  runs: number;
  model_name: string;
  load_ms?: MetricSummary;
  first_token_ms?: MetricSummary;
  inference_ms?: MetricSummary;
  total_ms?: MetricSummary;
  memory_mb?: MetricSummary;
}

export interface Recommendation {
  id: number;
  rec_key: string;
  title: string;
  task_type: string;
  tfjs_verdict: string;
  gemini_verdict: string;
  comment: string;
  sort_order: number;
  updated_at: string;
}

export interface AgentSource {
  source_type: string;
  source_key: string;
  content: string;
  score: number;
}

export interface AgentAnswer {
  answer: string;
  thinking: string;
  sources: AgentSource[];
  charts?: AgentChart[];
  model: string;
}

export interface AgentChart {
  kind: 'bar';
  renderer?: 'html' | 'python_static' | 'python_interactive';
  statistic?: 'median' | 'mean';
  artifact_url?: string | null;
  title: string;
  metric: 'inference_ms' | 'first_token_ms' | 'load_ms' | 'total_ms' | 'memory_mb';
  unit: 'мс' | 'МБ';
  points: { label: string; value: number; samples: number }[];
}

/** Результат работы адаптера конкретной парадигмы. */
export interface RunOutcome {
  metrics: RunMetrics;
  output_summary: string;
  model_name: string;
  settings: Record<string, unknown>;
  status: RunStatus;
  error_message?: string;
}

/** Вход эксперимента: текст либо изображение. */
export type ExperimentInput =
  | { kind: 'text'; text: string }
  | { kind: 'image'; element: HTMLImageElement; label: string };

export const APPROACH_LABEL: Record<Approach, string> = {
  tensorflow_js: 'TensorFlow.js',
  gemini_nano: 'Gemini Nano',
};

export const METRIC_LABEL: Record<keyof RunMetrics, string> = {
  load_ms: 'Загрузка модели',
  first_token_ms: 'До первого предсказания',
  inference_ms: 'Латентность инференса',
  total_ms: 'Полное время',
  memory_mb: 'Память',
};
