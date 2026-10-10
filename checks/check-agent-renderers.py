"""Real DB/tool/file/API check; no Ollama call or chat/measurement mutation."""
import json
import sys
sys.path.insert(0, '/srv')
from pathlib import Path
import httpx
from app.agent.tools import AgentTools
from app.db.database import engine
from sqlalchemy.orm import Session
from app.schemas import AgentChart

with Session(engine) as session:
    tools = AgentTools(session)
    catalog = tools.execute('list_experiments', {})['experiments']
    assert catalog, 'Record at least one successful benchmark before checking renderers'
    key = next((item['key'] for item in catalog if item['key'] == 'text_classification'), catalog[0]['key'])
    charts = []
    for renderer in ('html', 'python_static', 'python_interactive'):
        result = tools.execute('build_chart', {'experiment_key': key, 'renderer': renderer, 'statistic': 'mean'})
        chart = AgentChart.model_validate(result['chart'])
        assert chart.points, 'No successful inference measurements'
        charts.append(chart.model_dump())
        if chart.artifact_url:
            response = httpx.get('http://backend:8000' + chart.artifact_url)
            response.raise_for_status()
            if renderer == 'python_static':
                assert response.content.startswith(b'\x89PNG\r\n\x1a\n')
            else:
                assert 'Plotly.newPlot' in response.text
    assert charts[0]['points'] == charts[1]['points'] == charts[2]['points']
    assert httpx.get('http://backend:8000/api/agent/charts/not-a-chart.png').status_code == 404
    path = Path('artifacts/agent-charts/ui-fixture.json')
    path.write_text(json.dumps(charts, ensure_ascii=False), encoding='utf-8')
    print('All renderers OK: real measurements, equal points, PNG/HTML fetched, invalid path rejected')
