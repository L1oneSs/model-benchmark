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
  metadata?: Record<string, unknown>;
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
  p95: number;
  iqr: number;
  ci95: [number, number] | null;
  mean_ci95: [number, number] | null;
  p5: number; p10: number; q1: number; q3: number; p90: number; p99: number;
  range: number; variance: number | null; sem: number | null; cv_percent: number | null;
  mad: number; robust_sigma: number; trimmed_mean: number;
  geometric_mean: number | null; harmonic_mean: number | null;
  skewness: number | null; excess_kurtosis: number | null;
  outlier_low: number; outlier_high: number; outliers: number; outlier_percent: number;
  zeros: number; unique: number; tail_ratio: number | null; missing?: number;
  normality: {statistic: number | null; p_value: number | null} | null;
}

export interface StatisticsGroup {
  approach: Approach;
  model: string;
  backend: string | null;
  runs: number;
  metrics: Partial<Record<'load_ms' | 'first_token_ms' | 'inference_ms' | 'total_ms' | 'memory_mb', MetricSummary>>;
}

export interface StatisticalComparison {
  a: Pick<StatisticsGroup, 'approach' | 'model' | 'backend'>;
  b: Pick<StatisticsGroup, 'approach' | 'model' | 'backend'>;
  metric: keyof StatisticsGroup['metrics'];
  n_a: number;
  n_b: number;
  cliffs_delta: number | null;
  p_value: number | null;
  p_value_adjusted?: number;
  median_difference: number | null; mean_difference: number | null;
  median_ratio: number | null; median_change_percent: number | null;
  probability_a_lower: number | null; hedges_g: number | null; wasserstein: number | null;
  welch_t: number | null; welch_p: number | null; welch_df: number | null; welch_p_adjusted?: number;
  variance_p: number | null; variance_p_adjusted?: number;
  method?: string;
}

export type StatisticsMetric = keyof StatisticsGroup['metrics'];
export interface MetricTrend {
  samples: number; spearman_r: number | null; slope: number; lag1: number | null;
  first_half_median: number; last_half_median: number; median_change_percent: number | null;
}
export interface MetricCorrelation {
  a: StatisticsMetric; b: StatisticsMetric; samples: number;
  spearman_r: number | null; spearman_p: number | null; spearman_p_adjusted?: number;
  pearson_r: number | null; pearson_p: number | null; pearson_p_adjusted?: number;
}
export interface StatisticsDiagnostics {
  approach: Approach; model: string; backend: string | null;
  distributions: Partial<Record<StatisticsMetric, number[]>>;
  chronology: Partial<Record<StatisticsMetric, number[]>>;
  correlations: MetricCorrelation[];
  trends: Partial<Record<StatisticsMetric, MetricTrend>>;
}
export interface OmnibusStatistic {
  metric: StatisticsMetric; groups: number; samples: number; kruskal_h: number;
  p_value: number; p_value_adjusted?: number; eta_squared_h: number; epsilon_squared: number;
  variance_p: number | null; variance_p_adjusted?: number; small_groups: boolean;
}

export interface ExperimentStatistics {
  groups: StatisticsGroup[];
  comparisons: StatisticalComparison[];
  window: number;
  diagnostics: StatisticsDiagnostics[];
  omnibus: OmnibusStatistic[];
  measurement_ids: number[];
  note?: string;
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
  onnx_verdict: string;
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
    kind: 'bar' | 'line' | 'scatter';
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
  metadata?: Record<string, unknown>;
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
  | { kind: 'image'; element: HTMLImageElement; label: string; file?: File };

export const APPROACH_LABEL: Record<Approach, string> = {
  tensorflow_js: 'TensorFlow.js',
  gemini_nano: 'Gemini Nano',
};

export const METRIC_LABEL: Record<keyof RunMetrics, string> = {
  load_ms: 'Загрузка модели',
  first_token_ms: 'До первого предсказания',
  inference_ms: 'Латентность инференса',
  total_ms: 'Полное время',
  memory_mb: 'Память (изменение JS-кучи)',
};
