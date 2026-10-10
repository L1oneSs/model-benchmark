import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from app.agent.service import AgentService
from app.agent.skills import planning_instructions, read_skill, planning_skill
from app.agent.tools import AgentTools
from app.config import Settings
from app.schemas import AgentSource, AgentChart
from app.agent.chart_rendering import requested_chart_options
from tempfile import TemporaryDirectory
from pathlib import Path
from unittest.mock import patch


class ChartTests(unittest.IsolatedAsyncioTestCase):
    def test_mean_and_median_diverge_on_outlier(self):
        tools = self.tools()
        rows = tools.rows.return_value[0]
        rows.append(SimpleNamespace(approach='tensorflow_js', model_name='A', settings={'backend': 'wasm'}, metrics={'inference_ms': 200}))
        median = tools.execute('build_chart', {'experiment_key': 'x'})['chart']
        mean = tools.execute('build_chart', {'experiment_key': 'x', 'statistic': 'mean'})['chart']
        self.assertEqual(median['points'][0]['value'], 30)
        self.assertEqual(mean['points'][0]['value'], 80)

    def test_format_and_statistic_follow_explicit_request(self):
        self.assertEqual(requested_chart_options('Среднее инференса Python статичный PNG'),
                         {'renderer': 'python_static', 'statistic': 'mean', 'metric': 'inference_ms'})
        self.assertEqual(requested_chart_options('Python динамический график'),
                         {'renderer': 'python_interactive', 'statistic': 'median'})
        self.assertEqual(requested_chart_options('График HTML'),
                         {'renderer': 'html', 'statistic': 'median'})

    def test_python_renderers_create_real_files_with_same_data(self):
        with TemporaryDirectory() as directory, patch('app.agent.chart_rendering.DIRECTORY', Path(directory)):
            for renderer, suffix in [('python_static', 'png'), ('python_interactive', 'html')]:
                data = self.tools().execute('build_chart', {'experiment_key': 'x', 'renderer': renderer, 'statistic': 'mean'})
                self.assertNotIn('error', data)
                chart = AgentChart.model_validate(data['chart'])
                self.assertEqual(chart.points[0].value, 20)
                path = Path(directory) / chart.artifact_url.rsplit('/', 1)[-1]
                self.assertTrue(path.is_file())
                if suffix == 'png':
                    self.assertEqual(path.read_bytes()[:8], b'\x89PNG\r\n\x1a\n')
                else:
                    self.assertIn('Plotly.newPlot', path.read_text(encoding='utf-8'))

    def tools(self):
        tools = AgentTools(Mock())
        tools.rows = Mock(return_value=([
            SimpleNamespace(approach="tensorflow_js", model_name="A", settings={"backend": "wasm"}, metrics={"inference_ms": 10}),
            SimpleNamespace(approach="tensorflow_js", model_name="A", settings={"backend": "wasm"}, metrics={"inference_ms": 30}),
            SimpleNamespace(approach="gemini_nano", model_name="B", settings={}, metrics={}),
        ], True))
        return tools

    def test_chart_uses_real_median_and_samples_and_discloses_limit(self):
        tools = self.tools()
        data = tools.execute("build_chart", {"experiment_key": "x"})
        self.assertEqual(data["chart"]["points"], [{"label": "A · wasm", "value": 20, "samples": 2}])
        self.assertTrue(data["truncated"])
        self.assertEqual(data["chart"]["unit"], "мс")
        self.assertTrue(tools.rows.call_args.kwargs["successful"])

    def test_missing_metric_does_not_generate_zero_and_unknown_metric_rejected(self):
        tools = self.tools()
        self.assertEqual(tools.execute("build_chart", {"experiment_key": "x", "metric": "load_ms"})["chart"]["points"], [])
        self.assertIn("error", tools.execute("build_chart", {"experiment_key": "x", "metric": "invented"}))

    def test_all_metrics_are_built_in_one_call_with_separate_units(self):
        tools = self.tools()
        rows = tools.rows.return_value[0]
        rows[0].metrics.update(first_token_ms=11, load_ms=0, total_ms=12, memory_mb=0.5)
        data = tools.execute("build_chart", {"experiment_key": "x", "metric": "all"})
        self.assertEqual(len(data["charts"]), 5)
        self.assertEqual(data["charts"][-1]["unit"], "МБ")
        self.assertEqual(data["missing_metrics"], [])
        self.assertEqual(data["charts"][2]["points"][0]["value"], 0)
        tools.rows.assert_called_once()

    def test_all_metrics_disclose_missing_values_without_inventing_zero(self):
        data = self.tools().execute("build_chart", {"experiment_key": "x", "metric": "all"})
        self.assertEqual(len(data["charts"]), 1)
        self.assertIn("load_ms", data["missing_metrics"])

    async def test_all_charts_are_in_final_answer(self):
        service = AgentService.__new__(AgentService)
        service.settings = Settings()
        tools = self.tools()
        tools.rows.return_value[0][0].metrics["memory_mb"] = 0.5
        data = tools.execute("build_chart", {"experiment_key": "x", "metric": "all"})
        async def collect(question, history):
            yield {"type": "context", "sources": [AgentSource(source_type="agent_tool", source_key="build_chart:1", content=json.dumps(data), score=1)]}
        service.planner = SimpleNamespace(collect=collect)
        result = await service.answer("Графики по всем метрикам")
        self.assertEqual(len(result.charts), 2)
        self.assertIn("Нет измерений", result.answer)

    def test_scenario_instructions_are_loaded_from_files(self):
        instructions = planning_instructions(["build_chart"])
        self.assertIn("Measurement charts", instructions)
        self.assertNotIn("# Recommendation table", instructions)

    def test_full_skills_have_metadata_and_runtime_protocol_preserves_rules(self):
        for name in ('core', 'measurements', 'charts', 'comparisons', 'recommendations', 'answer'):
            text = read_skill(name)
            self.assertTrue(text.startswith('---\nname:'))
            self.assertIn('description:', text)
            self.assertIn('Финальный контроль', text)
            if name != 'answer':
                self.assertEqual(text.count('<!-- runtime:start -->'), 1)
                self.assertEqual(text.count('<!-- runtime:end -->'), 1)
                protocol = text.split('<!-- runtime:start -->')[1].split('<!-- runtime:end -->')[0].strip()
                self.assertIn(protocol, planning_skill(name))
        instructions = planning_instructions(['build_chart'])
        self.assertIn('python_interactive', instructions)
        self.assertIn('metric=all', instructions)
        self.assertNotIn('Учебный пример', instructions)
        self.assertNotIn('gost-bibliography', instructions)

    def test_signed_memory_delta_is_a_valid_chart_value(self):
        chart = AgentChart.model_validate({"kind": "bar", "title": "Memory", "metric": "memory_mb", "unit": "МБ",
            "points": [{"label": "A", "value": -0.1, "samples": 2}]})
        self.assertEqual(chart.points[0].value, -0.1)

    async def test_chart_is_returned_in_done_without_second_llm_request(self):
        service = AgentService.__new__(AgentService)
        service.settings = Settings()
        data = self.tools().execute("build_chart", {"experiment_key": "x"})
        async def collect(question, history):
            yield {"type": "context", "sources": [AgentSource(source_type="agent_tool", source_key="build_chart:1", content=json.dumps(data), score=1)]}
        service.planner = SimpleNamespace(collect=collect)
        result = await service.answer("Построй график x")
        self.assertEqual(result.charts[0].points[0].value, 20)
        self.assertIn("Выборка ограничена", result.answer)
