"""Check the reported table question through the real API using an isolated chat."""
from uuid import uuid4
import time
import httpx

key = str(uuid4())
with httpx.Client(base_url="http://localhost:8000", timeout=180, headers={"X-Agent-Chat": key}) as client:
    started = time.perf_counter()
    try:
        response = client.post("/api/agent/ask", json={
            "question": "Что в таблице рекомендаций сказано про скорость обработки текста?",
            "thinking": False,
        })
        response.raise_for_status()
        result = response.json()
        assert result["sources"] and all(s["source_type"] == "recommendation" for s in result["sources"])
        print("sources:", [s["source_key"] for s in result["sources"]], flush=True)
        print("answer:", result["answer"], flush=True)
        print("seconds:", round(time.perf_counter() - started, 2), flush=True)
    finally:
        client.delete("/api/agent/history").raise_for_status()
