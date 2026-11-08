"""Trusted Python renderers: only validated labels/numbers, never model-generated code."""
from pathlib import Path
from uuid import uuid4
from threading import Lock
from html import escape

DIRECTORY = Path('artifacts/agent-charts')
RENDER_LOCK = Lock()


def render_artifact(chart):
    if chart['renderer'] == 'html' or not chart['points']:
        return None
    DIRECTORY.mkdir(parents=True, exist_ok=True)
    suffix = 'png' if chart['renderer'] == 'python_static' else 'html'
    filename = f'{uuid4().hex}.{suffix}'
    path = DIRECTORY / filename
    labels = [p['label'] for p in chart['points']]
    values = [p['value'] for p in chart['points']]
    metric_labels = {'inference_ms': 'Инференс', 'first_token_ms': 'Первое предсказание',
                     'load_ms': 'Загрузка модели', 'total_ms': 'Полное время', 'memory_mb': 'Память JS heap'}
    title = f"{chart['title']} · {metric_labels[chart['metric']]} ({chart['unit']})"
    with RENDER_LOCK:
        if suffix == 'png':
            from matplotlib.figure import Figure
            from matplotlib.backends.backend_agg import FigureCanvasAgg
            fig = Figure(figsize=(12, min(24, max(4, len(labels) * .55))), layout='constrained')
            FigureCanvasAgg(fig)
            ax = fig.subplots()
            kind = chart.get('kind', 'bar')
            if kind == 'line':
                ax.plot(values, range(len(values)), marker='o', color='#6366f1')
            elif kind == 'scatter':
                ax.scatter(values, range(len(values)), color='#6366f1')
            else:
                ax.barh(range(len(values)), values, color='#6366f1')
            ax.set_yticks(range(len(labels)), labels, fontsize=9)
            ax.invert_yaxis()
            ax.axvline(0, color='#94a3b8', linewidth=.7)
            ax.set_xlabel(chart['unit'])
            ax.set_title(title, wrap=True)
            for i, point in enumerate(chart['points']):
                ax.annotate(f"{point['value']:g}; n={point['samples']}", (point['value'], i),
                            xytext=(5 if point['value'] >= 0 else -5, 0), textcoords='offset points',
                            ha='left' if point['value'] >= 0 else 'right', va='center', fontsize=8)
            ax.margins(x=.2)
            fig.savefig(path, dpi=160)
            fig.clear()
        else:
            import plotly.graph_objects as go
            options = dict(x=values, y=[escape(s) for s in labels],
                customdata=[p['samples'] for p in chart['points']], marker_color='#6366f1',
                hovertemplate='%{y}<br>%{x} ' + chart['unit'] + '<br>n=%{customdata}<extra></extra>')
            kind = chart.get('kind', 'bar')
            trace = go.Bar(**options, orientation='h') if kind == 'bar' else go.Scatter(
                **options, mode='lines+markers' if kind == 'line' else 'markers')
            fig = go.Figure(trace)
            fig.update_layout(title=escape(title), template='plotly_white',
                              height=min(1400, max(400, len(labels) * 65)), xaxis_title=chart['unit'],
                              yaxis={'autorange': 'reversed'}, margin={'l': 30, 'r': 30})
            fig.write_html(path, include_plotlyjs=True, auto_open=False,
                           config={'responsive': True, 'displaylogo': False})
    return f'/api/agent/charts/{filename}'


def requested_chart_options(question):
    """Keep explicit format/statistic requests intact even with a small planner model."""
    import re
    text = question.lower()
    if re.search(r'echarts|javascript|\bjs\b|в браузере', text):
        renderer = 'html'
    elif re.search(r'интерактив|динамич|interactive|dynamic|plotly', text):
        renderer = 'python_interactive'
    elif re.search(r'python|питон|статич|static|matplotlib|\bpng\b', text):
        renderer = 'python_static'
    else:
        renderer = 'html'
    options = {'renderer': renderer, 'statistic': 'mean' if re.search(r'средн|\bmean\b|average', text) else 'median'}
    if re.search(r'линейн|\bline\b', text):
        options['kind'] = 'line'
    elif re.search(r'точечн|\bscatter\b', text):
        options['kind'] = 'scatter'
    elif re.search(r'столбчат|\bbar\b', text):
        options['kind'] = 'bar'
    from app.agent.intent import all_metrics_request
    if not all_metrics_request(question):
        patterns = {
            'inference_ms': r'инференс|inference',
            'first_token_ms': r'перв\w*\s+(?:предсказан|токен)|first[ _](?:token|prediction)',
            'load_ms': r'загрузк\w*\s+модел|model[ _]load|load_ms',
            'total_ms': r'полн\w*\s+врем|total[ _](?:time|ms)',
            'memory_mb': r'памят|memory|heap',
        }
        metrics = [metric for metric, pattern in patterns.items() if re.search(pattern, text)]
        if len(metrics) == 1:
            options['metric'] = metrics[0]
    return options
