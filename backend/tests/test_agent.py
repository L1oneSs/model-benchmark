import json
import math
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch

import httpx
from sqlalchemy.dialects import postgresql

from app.config import Settings
from app.agent.planner import AgentPlanner
from app.agent.tools import AgentTools, MeasurementArgs, summarize


def row(latency, model="model", backend="wasm"):
    return SimpleNamespace(approach="tensorflow_js", model_name=model,
                           settings={"backend": backend}, metrics={"inference_ms": latency})


class ToolsTests(unittest.TestCase):
    def test_statistics_separate_models_and_backends_and_ignore_missing(self):
        groups = summarize([row(10), row(30), row(None), row(math.nan), row(True),
                            row(100, backend="webgl"), row(200, model="another")])
        self.assertEqual(len(groups), 3)
        self.assertEqual(groups[0]["metrics"]["inference_ms"]["median"], 20)
        self.assertEqual(groups[0]["metrics"]["inference_ms"]["samples"], 2)
        self.assertNotIn("load_ms", groups[0]["metrics"])

    def test_unknown_tool_and_unbounded_queries_rejected_without_database(self):
        session = Mock()
        tools = AgentTools(session)
        for name, args in [("execute_sql", {}), ("read_measurements", {"experiment_key": "x", "limit": 5000}),
                           ("read_measurements", {"experiment_key": "x", "sql": "DROP TABLE measurements"})]:
            self.assertIn("error", tools.execute(name, args))
        session.scalars.assert_not_called()
        session.execute.assert_not_called()

    def test_query_binds_filters_and_excludes_failed_runs(self):
        session = Mock()
        session.scalars.return_value = []
        malicious = "x'; DELETE FROM measurements; --"
        AgentTools(session).rows(MeasurementArgs(experiment_key=malicious, backend="wasm", run_index=2), successful=True)
        query = session.scalars.call_args.args[0].compile(dialect=postgresql.dialect())
        self.assertNotIn(malicious, str(query))
        self.assertIn(malicious, query.params.values())
        self.assertIn("ok", query.params.values())
        self.assertIn(2, query.params.values())
        self.assertIn(21, query.params.values())

    def test_series_comparison_uses_latest_two_and_matching_groups(self):
        session = Mock()
        session.scalars.side_effect = [[3, 2], [row(100), row(50, model="old")], [row(80), row(200, model="new")]]
        result = AgentTools(session).execute("compare_series", {"experiment_key": "text"})
        self.assertEqual((result["first_run"], result["second_run"]), (2, 3))
        self.assertEqual(len(result["changes"]), 1)
        self.assertEqual(result["changes"][0]["delta_ms"], -20)
        self.assertEqual(result["changes"][0]["delta_percent"], -20)
        self.assertEqual(result["changes"][0]["inference_before_ms"], 100)
        self.assertEqual(result["changes"][0]["inference_after_ms"], 80)

    def test_statistics_limit_disclosed(self):
        session = Mock()
        session.scalars.return_value = [row(10), row(20), row(100)]
        result = AgentTools(session).execute("calculate_statistics", {"experiment_key": "x", "limit": 2})
        self.assertTrue(result["truncated"])
        self.assertEqual(result["groups"][0]["metrics"]["inference_ms"]["median"], 15)

    def test_unknown_recommendation_key_can_be_corrected(self):
        session = Mock()
        session.scalar.return_value = None
        result = AgentTools(session).execute("read_recommendations", {"rec_key": "invented"})
        self.assertIn("Omit rec_key", result["error"])

    def test_missing_series_is_data_absence_not_a_tool_failure(self):
        session = Mock()
        session.scalars.return_value = [1]
        result = AgentTools(session).execute("compare_series", {"experiment_key": "text"})
        self.assertNotIn("error", result)
        self.assertEqual(result["available_series"], [1])
        self.assertEqual(result["changes"], [])
        self.assertIn("Need two", result["note"])


class PlannerTests(unittest.IsolatedAsyncioTestCase):
    async def test_normalized_duplicate_charts_are_executed_once(self):
        calls = [{'function': {'name': 'build_chart', 'arguments': {
            'experiment_key': 'text', 'metric': metric}}}
            for metric in ['inference_ms', 'load_ms', 'total_ms']]
        events, planner = await self.collect([{'complete': True, 'tool_calls': calls}],
            question='Построй график медианы инференса', tool_result={'charts': []})
        chart_calls = [call for call in planner.tools.execute.call_args_list if call.args[0] == 'build_chart']
        self.assertEqual(len(chart_calls), 1)
        self.assertEqual(len(events[-1]['sources']), 1)

    async def test_explicit_chart_metric_cannot_be_changed_by_model(self):
        _, planner = await self.collect([{'complete': True, 'tool_calls': [{'function': {
            'name': 'build_chart', 'arguments': {'experiment_key': 'text', 'metric': 'load_ms'}}}]}],
            question='Построй график медианы инференса', tool_result={'charts': []})
        self.assertEqual(planner.tools.execute.call_args.args[1]['metric'], 'inference_ms')

    async def test_python_format_is_preserved_even_if_model_requests_html(self):
        _, planner = await self.collect([{'complete': True, 'tool_calls': [{'function': {
            'name': 'build_chart', 'arguments': {'experiment_key': 'text', 'renderer': 'html', 'statistic': 'median'}}}]}],
            question='Построй Python интерактивный график среднего инференса', tool_result={'charts': []})
        args = planner.tools.execute.call_args.args[1]
        self.assertEqual(args['renderer'], 'python_interactive')
        self.assertEqual(args['statistic'], 'mean')
        parameters = self.payloads[0]['format']['properties']['calls']['items']['anyOf'][0]['properties']['arguments']['properties']
        self.assertEqual(parameters['renderer'], {'const': 'python_interactive'})

    async def test_mixed_request_collects_both_sources_even_if_model_stops_after_table(self):
        events, planner = await self.collect([
            {"complete": True, "tool_calls": [{"function": {"name": "read_recommendations", "arguments": {"rec_key": "text_speed"}}}]},
            {"complete": False, "tool_calls": [{"function": {"name": "calculate_statistics", "arguments": {"experiment_key": "text_classification"}}}]},
        ], question="Дай рекомендации по скорости обработки текста на основе таблицы рекомендаций и последних измерений")
        self.assertEqual({s.source_key.split(':')[0] for s in events[-1]["sources"]}, {"read_recommendations", "calculate_statistics"})
        self.assertEqual(len(self.payloads), 2)
        next_variants = self.payloads[1]["format"]["properties"]["calls"]["items"]["anyOf"]
        self.assertEqual([t["properties"]["name"]["const"] for t in next_variants], ["calculate_statistics"])
        variants = self.payloads[0]["format"]["properties"]["calls"]["items"]["anyOf"]
        self.assertEqual({t["properties"]["name"]["const"] for t in variants}, {"read_recommendations", "calculate_statistics"})

    async def test_mixed_request_without_statistics_cannot_return_table_only(self):
        responses = [{"complete": True, "tool_calls": [{"function": {"name": "read_recommendations", "arguments": {}}}]}] * 4
        with self.assertRaisesRegex(RuntimeError, "оба источника"):
            await self.collect(responses, question="Дай рекомендации на основе таблицы и измерений")

    async def test_all_metrics_request_cannot_be_reduced_to_default_inference(self):
        _, planner = await self.collect([{"complete": True, "tool_calls": [{"function": {
            "name": "build_chart", "arguments": {"experiment_key": "language_detection", "metric": "inference_ms"}}}]}],
            question="А сделай для эксперимента Определение языка текста графики по всем метрикам измеряемым",
            tool_result={"charts": []})
        self.assertEqual(planner.tools.execute.call_args.args[1]["metric"], "all")
        schema = self.payloads[0]["format"]["properties"]["calls"]["items"]["anyOf"][0]
        self.assertEqual(schema["properties"]["arguments"]["properties"]["metric"], {"const": "all"})

    async def collect(self, responses, question="Compare latest results", tool_result=None):
        planner = AgentPlanner(Mock(), Settings())
        planner.tools.execute = Mock(return_value=tool_result or {"experiments": []})
        self.payloads = []
        def handler(request):
            self.payloads.append(json.loads(request.content))
            message = responses[len(self.payloads)-1]
            calls = [{"name": c["function"]["name"], "arguments": c["function"]["arguments"]}
                     for c in message.get("tool_calls", [])]
            return httpx.Response(200, json={"message": {"role": "assistant", "content": json.dumps({
                "calls": calls, "complete": message.get("complete", not calls)})}})
        original = httpx.AsyncClient
        with patch("app.agent.planner.httpx.AsyncClient", side_effect=lambda **kw: original(transport=httpx.MockTransport(handler))):
            events = [e async for e in planner.collect(question, [])]
        return events, planner

    async def test_structured_tool_calls_are_executed_and_returned_to_model(self):
        events, planner = await self.collect([
            {"role": "assistant", "tool_calls": [{"function": {"name": "list_experiments", "arguments": {}}}]},
            {"role": "assistant", "content": "Done"},
        ])
        planner.tools.execute.assert_called_once_with("list_experiments", {})
        self.assertIn('"experiments": []', self.payloads[1]["messages"][-1]["content"])
        self.assertEqual(self.payloads[0]["format"]["properties"]["calls"]["minItems"], 1)
        self.assertEqual(events[-1]["sources"][0].source_key, "list_experiments:1")

    async def test_table_questions_only_offer_table_tool(self):
        events, _ = await self.collect([
            {"role": "assistant", "tool_calls": [{"function": {"name": "read_recommendations", "arguments": {}}}]},
            {"role": "assistant", "content": "Done"},
        ], "Что в таблице рекомендаций сказано про скорость обработки текста?", {"recommendations": []})
        variants = self.payloads[0]["format"]["properties"]["calls"]["items"]["anyOf"]
        self.assertEqual([t["properties"]["name"]["const"] for t in variants], ["read_recommendations"])
        self.assertEqual(events[-1]["sources"][0].source_type, "recommendation")

    async def test_unsupported_tool_cannot_execute_and_loop_is_bounded(self):
        message = {"role": "assistant", "tool_calls": [{"function": {"name": "delete_database", "arguments": {}}}]}
        with self.assertRaises(RuntimeError):
            await self.collect([message] * 4)
        self.assertEqual(len(self.payloads), 4)

    async def test_model_answer_without_evidence_is_rejected(self):
        with self.assertRaises(RuntimeError):
            await self.collect([{"role": "assistant", "content": "Invented statistics"}] * 4)

    async def test_complete_plan_skips_redundant_model_step(self):
        events, _ = await self.collect([{"role": "assistant", "complete": True, "tool_calls": [
            {"function": {"name": "calculate_statistics", "arguments": {"experiment_key": "text"}}}]}],
            tool_result={"groups": []})
        self.assertEqual(len(self.payloads), 1)
        self.assertEqual(events[-1]["sources"][0].source_key, "calculate_statistics:1")

    async def test_median_request_cannot_use_raw_runs_instead_of_calculation(self):
        await self.collect([{"role": "assistant", "complete": True, "tool_calls": [
            {"function": {"name": "calculate_statistics", "arguments": {"experiment_key": "text"}}}]}],
            question="Посчитай медиану инференса для text", tool_result={"groups": []})
        variants = self.payloads[0]["format"]["properties"]["calls"]["items"]["anyOf"]
        self.assertEqual([t["properties"]["name"]["const"] for t in variants], ["calculate_statistics"])

    async def test_unrequested_filters_and_series_cannot_silently_narrow_result(self):
        _, planner = await self.collect([{"role": "assistant", "complete": True, "tool_calls": [
            {"function": {"name": "compare_series", "arguments": {"experiment_key": "text", "approach": "gemini_nano",
                "backend": "wasm", "model_name": "Nano", "first_run": 1, "second_run": 2}}}]}],
            question="Сравни две последние серии text", tool_result={"changes": []})
        arguments = planner.tools.execute.call_args.args[1]
        for field in ("approach", "backend", "model_name", "first_run", "second_run"):
            self.assertIsNone(arguments[field])

    async def test_explicit_approach_filter_is_preserved(self):
        _, planner = await self.collect([{"role": "assistant", "complete": True, "tool_calls": [
            {"function": {"name": "calculate_statistics", "arguments": {"experiment_key": "text", "approach": "gemini_nano"}}}]}],
            question="Медиана для Gemini Nano", tool_result={"groups": []})
        self.assertEqual(planner.tools.execute.call_args.args[1]["approach"], "gemini_nano")

    async def test_effect_size_request_is_routed_to_statistics(self):
        await self.collect([{'complete': True, 'tool_calls': [
            {'function': {'name': 'calculate_statistics', 'arguments': {'experiment_key': 'text'}}}]}],
            question='Дельта Клиффа и p-value для text', tool_result={'groups': [], 'comparisons': []})
        variants = self.payloads[0]['format']['properties']['calls']['items']['anyOf']
        self.assertEqual([t['properties']['name']['const'] for t in variants], ['calculate_statistics'])
