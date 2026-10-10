import json
import unittest
from types import SimpleNamespace
from unittest.mock import patch

from app.config import Settings
from app.agent.reports import render_numeric_answer
from app.agent.service import AgentService
from app.schemas import AgentSource


def source(tool, data):
    return AgentSource(source_type="agent_tool", source_key=tool + ":1", content=json.dumps(data), score=1)


class ReportTests(unittest.IsolatedAsyncioTestCase):
    def test_comparison_direction_before_after_and_series_are_exact(self):
        changes = [dict(model="Nano", backend=None, inference_before_ms=100, inference_after_ms=120,
                        delta_ms=20, delta_percent=20, first_samples=5, second_samples=5),
                   dict(model="ONNX", backend="wasm", inference_before_ms=100, inference_after_ms=80,
                        delta_ms=-20, delta_percent=-20, first_samples=4, second_samples=5)]
        text = render_numeric_answer("Сравни две последние серии", [source("compare_series",
            dict(first_run=4, second_run=5, changes=changes, truncated=False))])
        self.assertIn("Серия 4: 100 мс → серия 5: 120 мс", text)
        self.assertIn("+20 мс (+20%); латентность выросла", text)
        self.assertIn("-20 мс (-20%); латентность снизилась", text)
        self.assertIn("Прогонов: 4 → 5", text)

    def stats_source(self):
        return source("calculate_statistics", {"experiment": "text", "limit": 100, "truncated": False,
            "groups": [{"model": "Model", "backend": "wasm", "metrics": {
                "inference_ms": {"median": 1445.8, "samples": 2},
                "memory_mb": {"median": 0.5, "samples": 1}}}]})

    def test_statistics_use_actual_samples_and_requested_metric(self):
        text = render_numeric_answer("Медиана инференса по последним 100 прогонам", [self.stats_source()])
        self.assertIn("1 445,8 мс, n=2", text)
        self.assertNotIn("100", text)
        memory = render_numeric_answer("Медиана памяти", [self.stats_source()])
        self.assertIn("Память JS heap: медиана 0,5 МБ, n=1", memory)
        self.assertNotIn("Инференс", memory)

    def test_table_comparison_keeps_model_explanation(self):
        self.assertIsNone(render_numeric_answer("Сравни таблицу рекомендаций с медианами", [self.stats_source()]))

    def test_missing_series_gives_actionable_answer(self):
        text = render_numeric_answer("Сравни серии", [source("compare_series",
            dict(first_run=None, second_run=1, available_series=[1], changes=[]))])
        self.assertIn("нужны две разные", text)
        self.assertIn("Доступные серии: 1", text)

    async def test_numeric_report_is_streamed_without_llm_reinterpretation(self):
        service = AgentService.__new__(AgentService)
        service.settings = Settings()
        async def collect(question, history):
            yield {"type": "context", "sources": [self.stats_source()]}
        service.planner = SimpleNamespace(collect=collect)
        with patch.object(service, "_chat_stream") as chat:
            events = [event async for event in service.stream_answer("Медиана инференса", thinking=True)]
        chat.assert_not_called()
        self.assertEqual(events[-1]["type"], "done")
        self.assertEqual(events[-1]["result"]["answer"], next(e["text"] for e in events if e["type"] == "token"))
        self.assertEqual(events[-1]["result"]["thinking"], "")
