"""Real Ollama agent smoke check; isolated chat is removed afterwards."""
import json
import os
import time
from uuid import uuid4

import httpx

base = os.getenv("AGENT_API_URL", "http://localhost:8000")
questions = [
    ("Что в таблице рекомендаций сказано про скорость обработки текста?", "read_recommendations"),
    ("Посчитай медиану инференса для text_generation отдельно по моделям по последним 100 успешным прогонам.", "calculate_statistics"),
    ("Сравни две последние серии text_generation отдельно по одинаковым моделям и бэкендам.", "compare_series"),
    ("Построй график медианы инференса для text_generation отдельно по моделям и бэкендам по последним 100 успешным прогонам.", "build_chart"),
]
selected = os.getenv("AGENT_CHECK_TOOLS", "").split(",")
if selected != [""]:
    questions = [(question, tool) for question, tool in questions if tool in selected]
assert questions, "No checks selected"
with httpx.Client(base_url=base, timeout=600, headers={"X-Agent-Chat": str(uuid4())}) as client:
    try:
        for question, expected in questions:
            started = time.perf_counter()
            with client.stream("POST", "/api/agent/ask?stream=true", json={"question": question, "thinking": False}) as response:
                response.raise_for_status()
                result = None
                for line in response.iter_lines():
                    if not line:
                        continue
                    event = json.loads(line)
                    if event["type"] == "status":
                        print(event["message"], flush=True)
                    if event["type"] == "error":
                        raise AssertionError(event)
                    if event["type"] == "done":
                        result = event["result"]
            assert result and result["answer"].strip(), result
            sources = result["sources"]
            assert any(s["source_key"].startswith(expected + ":") for s in sources), sources
            if expected == "read_recommendations":
                assert all(s["source_type"] == "recommendation" for s in sources)
                recommendations = [r for s in sources for r in json.loads(s["content"])["recommendations"]]
                assert any(r["key"] == "text_speed" for r in recommendations), recommendations
            tool_data = [json.loads(s["content"]) for s in sources if s["source_key"].startswith(expected + ":")]
            if expected == "calculate_statistics":
                assert all(d["experiment"] == "text_generation" and d["limit"] == 100 for d in tool_data)
                assert any(d["groups"] for d in tool_data), tool_data
            if expected == "compare_series":
                records = client.get("/api/measurements", params={"experiment_key": "text_generation", "limit": 200}).json()["items"]
                latest = sorted({r["run_index"] for r in records}, reverse=True)[:2]
                assert all((d["first_run"], d["second_run"]) == (latest[1], latest[0]) for d in tool_data), tool_data
                print("comparison_data:", json.dumps([{"first_run": d["first_run"], "second_run": d["second_run"],
                    "changes": d["changes"]} for d in tool_data], ensure_ascii=False), flush=True)
            if expected == "build_chart":
                assert result["charts"] and result["charts"][0]["points"], result
                assert all(d["experiment"] == "text_generation" and d["metric"] == "inference_ms" for d in tool_data), tool_data
                stats = client.get("/api/agent/history").json()["turns"][-1]
                assert stats["charts"] == result["charts"]
            print(json.dumps({"tool": expected, "answer": result["answer"],
                              "seconds": round(time.perf_counter() - started, 1)}, ensure_ascii=False), flush=True)
        history = client.get("/api/agent/history").json()
        assert len(history["turns"]) == len(questions), history
    finally:
        client.delete("/api/agent/history").raise_for_status()
