import unittest
from uuid import uuid4
from unittest.mock import patch
import httpx
from app.main import app


class AgentApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_new_api_and_legacy_alias_share_history_and_reindex_is_gone(self):
        key = str(uuid4())
        with patch("app.api.agent.read_history", return_value={"turns": [], "limit": 30}) as history:
            async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://test") as client:
                for path, header in [("/api/agent/history", "X-Agent-Chat"), ("/api/rag/history", "X-Rag-Chat")]:
                    response = await client.get(path, headers={header: key})
                    self.assertEqual(response.status_code, 200)
                    history.assert_called_with(key)
                self.assertEqual((await client.post("/api/rag/reindex")).status_code, 404)
                self.assertEqual((await client.get("/api/agent/history")).status_code, 422)
                response = await client.get("/api/agent/history", headers={"X-Agent-Chat": key, "X-Rag-Chat": str(uuid4())})
                self.assertEqual(response.status_code, 400)
        paths = app.openapi()["paths"]
        self.assertIn("/api/agent/ask", paths)
        self.assertFalse(any(path.startswith("/api/rag") for path in paths))
