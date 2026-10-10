"""Regression for the exact all-metrics chart request; uses an isolated chat."""
import os
import json
from uuid import uuid4
import httpx

question = "А сделай для эксперимента Определение языка текста графики по всем метрикам измеряемым"
with httpx.Client(base_url=os.getenv("AGENT_API_URL", "http://localhost:8000"), timeout=600,
                  headers={"X-Agent-Chat": str(uuid4())}) as client:
    try:
        response = client.post("/api/agent/ask", json={"question": question, "thinking": False})
        response.raise_for_status()
        result = response.json()
        sources = [json.loads(s["content"]) for s in result["sources"] if s["source_key"].startswith("build_chart:")]
        assert sources and all(s["metric"] == "all" and s["experiment"] == "language_detection" for s in sources), sources
        measured = {chart["metric"] for chart in result["charts"]}
        missing = {metric for source in sources for metric in source["missing_metrics"]}
        assert measured | missing == {"inference_ms", "first_token_ms", "load_ms", "total_ms", "memory_mb"}
        assert all(chart["points"] for chart in result["charts"])
        assert client.get("/api/agent/history").json()["turns"][-1]["charts"] == result["charts"]
        print(json.dumps({"answer": result["answer"], "metrics": sorted(measured), "missing": sorted(missing)}, ensure_ascii=False))
    finally:
        client.delete("/api/agent/history").raise_for_status()
