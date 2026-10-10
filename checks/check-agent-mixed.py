"""Regression for recommendations based on BOTH the table and measurements."""
import os
import json
from uuid import uuid4
import httpx

question = "А теперь дай мне рекомендации по выбору парадигмы для скорости обработки текста, основываясь на таблице рекомендаций и последних измерениях"
with httpx.Client(base_url=os.getenv("AGENT_API_URL", "http://localhost:8000"), timeout=600,
                  headers={"X-Agent-Chat": str(uuid4())}) as client:
    try:
        response = client.post("/api/agent/ask", json={"question": question, "thinking": False})
        response.raise_for_status()
        result = response.json()
        tools = {s["source_key"].split(":")[0] for s in result["sources"]}
        assert {"read_recommendations", "calculate_statistics"} <= tools, result
        stats = [json.loads(s["content"]) for s in result["sources"] if s["source_key"].startswith("calculate_statistics:")]
        assert all(s["experiment"] == "text_classification" and s["groups"] for s in stats), stats
        print(json.dumps({"tools": sorted(tools), "answer": result["answer"]}, ensure_ascii=False))
    finally:
        client.delete("/api/agent/history").raise_for_status()
