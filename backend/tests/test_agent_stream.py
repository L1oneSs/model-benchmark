import json
import unittest
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import httpx

from app.config import Settings
from app.agent.service import AgentService, answer_prefix
from app.schemas import AgentHistoryTurn, AgentSource


class AgentStreamTests(unittest.IsolatedAsyncioTestCase):
    async def run_stream(self, responses, thinking=False, history=None):
        service = AgentService.__new__(AgentService)
        service.settings = Settings(ollama_keep_alive="0")
        async def collect(question, history):
            self.planner_history = history
            yield {"type": "context", "sources": [AgentSource(
                source_type="recommendation", source_key="text", content="Use local models.", score=1)]}
        service.planner = SimpleNamespace(collect=collect)
        self.payloads = []

        def handler(request):
            payload = json.loads(request.content)
            self.payloads.append(payload)
            self.assertEqual(request.url.path, "/api/chat")
            self.assertEqual(payload["format"]["required"], ["answer"])
            self.assertEqual(payload["keep_alive"], "0")
            return httpx.Response(200, text="\n".join(json.dumps(c) for c in responses[len(self.payloads)-1]))

        original_client = httpx.AsyncClient
        with patch("app.agent.service.httpx.AsyncClient", side_effect=lambda **kw: original_client(transport=httpx.MockTransport(handler))):
            return [event async for event in service.stream_answer("Which approach?", thinking, history)]

    async def test_tokens_sources_and_done(self):
        events = await self.run_stream([[
            {"message": {"thinking": "hidden", "content": '{"answer":"Hello '}},
            {"message": {"content": 'world"}'}},
            {"done": True, "done_reason": "stop"},
        ]])
        self.assertEqual(events[1]["sources"][0]["source_key"], "text")
        self.assertEqual([e["text"] for e in events if e["type"] == "token"], ["Hello ", "world"])
        self.assertEqual(events[-1]["result"]["answer"], "Hello world")
        self.assertNotIn("hidden", json.dumps(events))
        self.assertFalse(self.payloads[0]["think"])

    async def test_thinking_separate_and_history_only_used_by_planner(self):
        events = await self.run_stream([[
            {"message": {"thinking": "Consider context"}},
            {"message": {"content": '{"answer":"Result"}'}, "done": True},
        ]], True, [AgentHistoryTurn(question="Previous?", answer="Earlier answer")])
        self.assertEqual(events[-1]["result"]["thinking"], "Consider context")
        self.assertEqual(events[-1]["result"]["answer"], "Result")
        self.assertEqual(self.planner_history[0].question, "Previous?")
        self.assertNotIn("Earlier answer", json.dumps(self.payloads[0]["messages"]))
        self.assertTrue(self.payloads[0]["think"])

    async def test_thinking_budget_falls_back_to_answer(self):
        events = await self.run_stream([
            [{"message": {"thinking": "Thought"}, "done": True, "done_reason": "length"}],
            [{"message": {"content": '{"answer":"Final"}'}, "done": True}],
        ], True)
        self.assertEqual(events[-1]["result"]["answer"], "Final")
        self.assertFalse(self.payloads[1]["think"])

    async def test_incomplete_stream_is_error(self):
        with self.assertRaises(RuntimeError):
            await self.run_stream([[{"message": {"content": '{"answer":"Partial'}}]])

    async def test_ollama_error_is_error(self):
        with self.assertRaisesRegex(RuntimeError, "busy"):
            await self.run_stream([[{"error": "busy"}]])

    async def test_invalid_json_is_error(self):
        with self.assertRaises(RuntimeError):
            await self.run_stream([[{"message": {"content": "Analysis instead"}, "done": True}]])

    async def test_truncation_is_disclosed(self):
        events = await self.run_stream([[
            {"message": {"content": '{"answer":"Partial'}},
            {"done": True, "done_reason": "length"},
        ]])
        self.assertIn("ограничения длины", events[-1]["result"]["answer"])

    async def test_missing_tool_evidence_skips_generation(self):
        service = AgentService.__new__(AgentService)
        service.settings = Settings()
        async def collect(question, history):
            yield {"type": "context", "sources": []}
        service.planner = SimpleNamespace(collect=collect)
        with patch.object(service, "_chat_stream") as chat:
            with self.assertRaises(RuntimeError):
                await service.answer("Question")
        chat.assert_not_called()

    def test_json_string_split_at_every_character(self):
        answer = 'Ответ "quoted" \\ line\nEmoji: 😀'
        raw = json.dumps({"answer": answer})
        previous = ""
        for i in range(len(raw) + 1):
            current = answer_prefix(raw[:i])
            self.assertTrue(answer.startswith(current), repr(current))
            self.assertTrue(current.startswith(previous), repr(current))
            previous = current
        self.assertEqual(previous, answer)


if __name__ == "__main__":
    unittest.main()
