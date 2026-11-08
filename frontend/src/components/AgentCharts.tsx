import type { AgentChart } from '../benchmark/types';
import { AgentEChart } from './charts/AgentEChart';

const labels: Record<AgentChart['metric'], string> = {
  inference_ms: 'Инференс', first_token_ms: 'Первое предсказание',
  load_ms: 'Загрузка модели', total_ms: 'Полное время', memory_mb: 'Память (изменение JS-кучи)',
};

export function AgentCharts({ charts = [] }: { charts?: AgentChart[] }) {
  return <>{charts.filter(chart => chart.points.length).map((chart, index) => {
    const base = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:8000').replace(/\/$/, '');
    const safeArtifact = chart.artifact_url && /^\/api\/agent\/charts\/[a-f0-9]{32}\.(png|html)$/.test(chart.artifact_url);
    if (safeArtifact && chart.renderer !== 'html') {
      const url = base + chart.artifact_url;
      return <figure className="agent-chart" key={index}>
        <figcaption>{chart.title} · {labels[chart.metric]} ({chart.unit})</figcaption>
        {chart.renderer === 'python_static'
          ? <img src={url} alt={chart.title} style={{ width: '100%', height: 'auto' }} />
          : <iframe src={url} title={chart.title} sandbox="allow-scripts" style={{ width: '100%', height: 550, border: 0 }} />}
        <a href={url} target="_blank" rel="noopener noreferrer">Открыть график / сохранить файл</a>
      </figure>;
    }
    return <figure className="agent-chart" key={index}>
      <figcaption>{chart.title} · {labels[chart.metric]} ({chart.unit})</figcaption>
      <AgentEChart chart={chart}/>
    </figure>;
  })}</>;
}
