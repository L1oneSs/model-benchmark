/** Обращения к бэкенду стенда: измерения и таблица рекомендаций. */

import type {
  ApproachSummary,
  Approach,
  Measurement,
  MeasurementPage,
  MeasurementPayload,
  Recommendation,
  ExperimentStatistics,
} from '../benchmark/types';

const BASE_URL = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${BASE_URL}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => '');
    throw new Error(`${response.status} ${response.statusText}. ${detail}`.trim());
  }
  return response.json() as Promise<T>;
}

export const saveMeasurements = (runs: MeasurementPayload[]): Promise<Measurement[]> =>
  request<Measurement[]>('/api/measurements', {
    method: 'POST',
    body: JSON.stringify({ runs }),
  });

export const fetchMeasurements = (params: {
  experimentKey?: string;
  approach?: Approach;
  backend?: string;
  sortBy?: 'inference_ms' | 'first_token_ms' | 'memory_mb' | 'created_at';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}): Promise<MeasurementPage> => {
  const query = new URLSearchParams();
  if (params.experimentKey) query.set('experiment_key', params.experimentKey);
  if (params.approach) query.set('approach', params.approach);
  if (params.backend) query.set('backend', params.backend);
  if (params.sortBy) query.set('sort_by', params.sortBy);
  if (params.sortOrder) query.set('sort_order', params.sortOrder);
  query.set('limit', String(params.limit ?? 20));
  query.set('offset', String(params.offset ?? 0));
  return request<MeasurementPage>(`/api/measurements?${query.toString()}`);
};

export const fetchLatest = (experimentKey: string): Promise<Partial<Record<Approach, Measurement>>> =>
  request(`/api/measurements/latest?experiment_key=${encodeURIComponent(experimentKey)}`);

export const fetchSummary = (
  experimentKey: string,
  window = 10,
  backend?: string,
): Promise<Record<Approach, ApproachSummary | null>> =>
  request(`/api/measurements/summary?experiment_key=${encodeURIComponent(experimentKey)}&window=${window}${backend ? `&backend=${encodeURIComponent(backend)}` : ''}`);

export const fetchExperimentStatistics = (experimentKey: string, window = 10): Promise<ExperimentStatistics> =>
  request(`/api/measurements/statistics?experiment_key=${encodeURIComponent(experimentKey)}&window=${window}`);

export interface PlotObservation {
  id: number; approach: Approach; model: string; backend: string | null;
  metrics: Record<string, number>; created_at: string;
}
export const fetchPlotData = (key: string, window = 30): Promise<{experiment: string; window: number; observations: PlotObservation[]}> =>
  request(`/api/measurements/plot-data?experiment_key=${encodeURIComponent(key)}&window=${window}`);

export const fetchRecommendations = (): Promise<Recommendation[]> =>
  request<Recommendation[]>('/api/recommendations');

export const csvExportUrl = (experimentKey?: string): string => {
  const query = new URLSearchParams();
  if (experimentKey) query.set('experiment_key', experimentKey);
  const suffix = query.toString();
  return `${BASE_URL}/api/measurements/export.csv${suffix ? `?${suffix}` : ''}`;
};
