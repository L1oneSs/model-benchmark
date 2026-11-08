import json
import math
import unittest
import httpx
from types import SimpleNamespace
from unittest.mock import Mock

from app.experiment_statistics import describe, compare_values, comparisons, summarize_groups
from app.agent.tools import AgentTools
from app.agent.reports import render_numeric_answer
from app.schemas import AgentSource
from app.db.repositories import MeasurementRepository
from sqlalchemy.dialects import postgresql
from app.main import app
from app.db.database import get_session
from unittest.mock import patch


def row(value, series=1, approach='tensorflow_js', backend='wasm', model='USE'):
    return SimpleNamespace(approach=approach, model_name=model, settings={'backend': backend},
                           metrics={'inference_ms': value}, run_index=series)


class StatisticsTests(unittest.TestCase):
    def test_quantiles_ci_and_invalid_values(self):
        data = describe([1, 2, 3, 4, None, True, math.nan, math.inf])
        self.assertEqual(data['samples'], 4)
        self.assertEqual(data['median'], 2.5)
        self.assertEqual(data['iqr'], 1.5)
        self.assertAlmostEqual(data['p95'], 3.85)
        self.assertEqual(data['ci95'], describe([4, 3, 2, 1])['ci95'])
        self.assertEqual(describe([0, 0])['ci95'], [0, 0])
        self.assertIsNone(describe([1])['ci95'])
        self.assertIsNone(describe([None]))

    def test_exact_mann_whitney_and_effect_orientation(self):
        result = compare_values([1, 2, 3], [4, 5, 6])
        self.assertEqual(result['cliffs_delta'], -1)
        self.assertEqual(result['u_statistic'], 0)
        self.assertAlmostEqual(result['p_value'], .1)
        self.assertEqual(compare_values([4, 5, 6], [1, 2, 3])['cliffs_delta'], 1)
        tied = compare_values([2, 2, 2], [2, 2, 2])
        self.assertEqual(tied['cliffs_delta'], 0)
        self.assertEqual(tied['p_value'], 1)
        self.assertIsNone(compare_values([1], [2])['p_value'])
        self.assertIsNone(compare_values([], [2])['cliffs_delta'])

    def test_individual_measurements_are_used_and_holm_is_applied(self):
        rows = [row(10, 1) for _ in range(10)] + [row(20, 2)]
        rows += [row(30, 1, backend='cpu'), row(40, 2, backend='cpu')]
        rows += [row(100, 1, approach='gemini_nano', backend=None, model='Nano'),
                 row(110, 2, approach='gemini_nano', backend=None, model='Nano')]
        groups = summarize_groups(rows)
        self.assertNotIn('series', groups[0])
        self.assertEqual(groups[0]['runs'], 11)
        items = comparisons(rows)
        self.assertEqual(len(items), 3)
        for item in items:
            self.assertIn((item['n_a'], item['n_b']), [(11, 2), (2, 2)])
            self.assertGreaterEqual(item['p_value_adjusted'], item['p_value'])

    def test_comparison_uses_all_measurements_regardless_of_run_index(self):
        rows = [row(i) for i in range(20)] + [row(100+i, backend='cpu') for i in range(20)]
        item = comparisons(rows)[0]
        self.assertEqual(item['n_a'], 20)
        self.assertIsNotNone(item['p_value'])
        self.assertEqual(item['cliffs_delta'], -1)

    def test_ties_have_the_expected_pairwise_effect(self):
        result = compare_values([1, 2], [2, 3])
        self.assertEqual(result['cliffs_delta'], -.75)
        self.assertTrue(math.isfinite(result['p_value']))

    def test_agent_uses_shared_calculations_and_renders_effect_without_llm(self):
        rows = [row(1, 1), row(2, 2), row(3, 3), row(4, 1, backend='cpu'),
                row(5, 2, backend='cpu'), row(6, 3, backend='cpu')]
        session = Mock()
        session.scalars.return_value = rows
        data = AgentTools(session).execute('calculate_statistics', {'experiment_key': 'text'})
        self.assertEqual(data['comparisons'][0]['cliffs_delta'], -1)
        text = render_numeric_answer('Дельта Клиффа и p-value инференса', [AgentSource(
            source_type='agent_tool', source_key='calculate_statistics:1', score=1, content=json.dumps(data))])
        self.assertIn('δ Клиффа=-1', text)
        self.assertIn('p-value=0.1000', text)
        self.assertIn('p95', text)
        self.assertIn('95% ДИ', text)

    def test_repository_limits_each_model_backend_in_sql(self):
        session = Mock()
        session.scalars.return_value = []
        self.assertEqual(MeasurementRepository(session).statistics_rows('text', 30), [])
        compiled = session.scalars.call_args.args[0].compile(dialect=postgresql.dialect())
        sql = str(compiled)
        self.assertIn('PARTITION BY measurements.approach, measurements.model_name', sql)
        self.assertIn('row_number()', sql)
        self.assertIn('ok', compiled.params.values())
        self.assertIn(30, compiled.params.values())


class StatisticsApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_summary_keeps_builtin_when_library_backend_is_selected(self):
        app.dependency_overrides[get_session] = lambda: Mock()
        try:
            with patch.object(MeasurementRepository, 'aggregate', return_value={'runs': 5}) as aggregate:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                    response = await client.get('/api/measurements/summary?experiment_key=text&window=5&backend=wasm')
                    self.assertEqual(response.status_code, 200)
                    self.assertEqual(set(response.json()), {'tensorflow_js', 'gemini_nano'})
                    self.assertEqual(aggregate.call_args_list[0].args, ('text', 'tensorflow_js', 5, 'wasm'))
                    self.assertEqual(aggregate.call_args_list[1].args, ('text', 'gemini_nano', 5, None))
        finally:
            app.dependency_overrides.pop(get_session, None)

    async def test_statistics_endpoint_and_window_validation(self):
        rows = [row(10, 1), row(20, 2), row(30, 1, backend='cpu'), row(40, 2, backend='cpu')]
        for i, item in enumerate(rows):
            item.id = i + 1
        app.dependency_overrides[get_session] = lambda: Mock()
        try:
            with patch.object(MeasurementRepository, 'statistics_rows', return_value=rows) as load:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='http://test') as client:
                    response = await client.get('/api/measurements/statistics?experiment_key=text&window=30')
                    self.assertEqual(response.status_code, 200)
                    data = response.json()
                    self.assertEqual(len(data['groups']), 2)
                    self.assertEqual(data['comparisons'][0]['n_a'], 2)
                    self.assertEqual(data['measurement_ids'], [1, 2, 3, 4])
                    load.assert_called_once_with('text', 30)
                    self.assertEqual((await client.get('/api/measurements/statistics?experiment_key=text&window=0')).status_code, 422)
        finally:
            app.dependency_overrides.pop(get_session, None)
