import json
import unittest
from types import SimpleNamespace
from unittest.mock import Mock

from app.agent.planner import AgentPlanner
from app.agent.tools import AgentTools
from app.agent.reports import render_numeric_answer
from app.config import Settings
from app.schemas import AgentHistoryTurn, AgentSource

MODEL = 'Universal Sentence Encoder lite (TensorFlow.js)'


def rows(values):
    return [SimpleNamespace(id=i+1, run_index=1, approach='tensorflow_js', model_name=MODEL,
                            settings={'backend': 'webgpu'}, metrics={'inference_ms': value})
            for i, value in enumerate(values)]


class ExplanationTests(unittest.IsolatedAsyncioTestCase):
    async def test_exact_followup_uses_previous_selection_and_returns_formula(self):
        session = Mock()
        session.execute.return_value = [('text_classification', 'Сравнение в скорости обработки текста', 5)]
        session.scalars.side_effect = [[MODEL], rows([15.3, 15.7, 15.9, 16.8, 20.1])]
        history = [AgentHistoryTurn(question='Посчитай медиану инференса', answer='15,9 мс', sources=[
            AgentSource(source_type='agent_tool', source_key='calculate_statistics:1', score=1,
                        content=json.dumps({'experiment': 'text_classification', 'measurement_ids': [1,2,3,4,5], 'filters': {}}))])]
        question = f'По какой формуле ты посчитал этот ответ? И по каким измерениям?\n{MODEL} · webgpu:\nИнференс: медиана 15,9 мс, n=5.'
        events = [e async for e in AgentPlanner(session, Settings()).collect(question, history)]
        sources = events[-1]['sources']
        data = json.loads(sources[0].content)
        self.assertEqual(data['filters']['model_name'], MODEL)
        self.assertEqual(data['filters']['backend'], 'webgpu')
        self.assertTrue(data['selection_restored'])
        answer = render_numeric_answer(question, sources)
        self.assertIn('15,3; 15,7; 15,9; 16,8; 20,1', answer)
        self.assertIn('позиции (n + 1) / 2 = 3', answer)
        self.assertIn('ID 3, серия 1: 15,9', answer)
        self.assertNotIn('Нет успешных прогонов', answer)

    def test_even_median_and_mean_use_real_observations(self):
        tools = AgentTools(Mock())
        tools.rows = Mock(return_value=(rows([10, 30]), False))
        for statistic, expression in [('median', '(10 + 30) / 2'), ('mean', '40 / 2')]:
            data = tools.execute('explain_statistic', {'experiment_key': 'x', 'statistic': statistic})
            source = AgentSource(source_type='agent_tool', source_key='explain_statistic:1', score=1, content=json.dumps(data))
            answer = render_numeric_answer('По какой формуле?', [source])
            self.assertIn(expression, answer)
            self.assertIn('Результат: 20 мс', answer)
            self.assertIn('В старом ответе не сохранены ID', answer)

    async def test_unknown_followup_does_not_guess_an_experiment(self):
        session = Mock()
        session.execute.return_value = []
        events = [e async for e in AgentPlanner(session, Settings()).collect('По какой формуле?', [])]
        answer = render_numeric_answer('По какой формуле?', events[-1]['sources'])
        self.assertIn('Укажите название эксперимента', answer)
        session.scalars.assert_not_called()
