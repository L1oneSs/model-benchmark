"""Integration checks against the configured PostgreSQL, using isolated chat IDs and no inference."""
import unittest
from uuid import uuid4
from unittest.mock import patch

import httpx
from fastapi import HTTPException
from sqlalchemy import delete

from app.main import app
from app.db.database import SessionLocal
from app.db.models import AgentChat
from app.agent.history import reserve, finish, release, read_history, clear_history, HISTORY_LIMIT


ANSWER = {"answer": "Final answer", "thinking": "", "sources": [], "model": "test"}


class HistoryTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self):
        self.key = str(uuid4())
        self.other = str(uuid4())

    def tearDown(self):
        with SessionLocal.begin() as session:
            session.execute(delete(AgentChat).where(AgentChat.id.in_([self.key, self.other])))

    def test_limit_persistence_and_deletion_race(self):
        token, _ = reserve(self.key)
        with self.assertRaises(HTTPException):
            reserve(self.key)
        clear_history(self.key)
        newer, _ = reserve(self.key)
        with self.assertRaises(RuntimeError):
            finish(self.key, token, "Late", ANSWER)
        release(self.key, token)
        finish(self.key, newer, "First", ANSWER)
        for i in range(HISTORY_LIMIT - 1):
            token, history = reserve(self.key)
            self.assertLessEqual(len(history), 3)
            finish(self.key, token, str(i), ANSWER)
        self.assertEqual(len(read_history(self.key)["turns"]), HISTORY_LIMIT)
        with self.assertRaises(HTTPException) as caught:
            reserve(self.key)
        self.assertEqual(caught.exception.status_code, 409)
        self.assertEqual(read_history(self.other)["turns"], [])
        clear_history(self.key)
        token, history = reserve(self.key)
        self.assertEqual(history, [])
        release(self.key, token)

    async def test_http_stream_saved_before_done_and_server_context(self):
        histories = []

        async def fake_stream(service, question, thinking=False, history=None):
            histories.append(history)
            yield {"type": "token", "text": ANSWER["answer"]}
            yield {"type": "done", "result": ANSWER}

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test",
                                     headers={"X-Rag-Chat": self.key}) as client:
            with patch("app.agent.service.AgentService.stream_answer", fake_stream):
                for i in range(2):
                    response = await client.post("/api/agent/ask?stream=true", json={"question": f"Question {i}"})
                    self.assertEqual(response.status_code, 200)
                    self.assertIn('"type": "done"', response.text)
            self.assertEqual(histories[0], [])
            self.assertEqual(histories[1][0].question, "Question 0")
            result = (await client.get("/api/agent/history")).json()
            self.assertEqual(len(result["turns"]), 2)
            self.assertEqual(result["limit"], HISTORY_LIMIT)
            for i in range(HISTORY_LIMIT - 2):
                token, _ = reserve(self.key)
                finish(self.key, token, str(i), ANSWER)
            response = await client.post("/api/agent/ask?stream=true", json={"question": "Blocked"})
            self.assertEqual(response.status_code, 409)
            self.assertEqual((await client.delete("/api/agent/history")).json()["turns"], [])
            self.assertEqual((await client.get("/api/agent/history")).json()["turns"], [])
            legacy = {"turns": [{"question": "Old question", **ANSWER}]}
            for _ in range(2):
                result = await client.post("/api/agent/history/import", json=legacy)
                self.assertEqual(len(result.json()["turns"]), 1)
            too_many = {"turns": legacy["turns"] * (HISTORY_LIMIT + 1)}
            self.assertEqual((await client.post("/api/agent/history/import", json=too_many)).status_code, 422)


if __name__ == "__main__":
    unittest.main()
