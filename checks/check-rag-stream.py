"""Run inside the backend container to measure the public streaming endpoint."""
import json
import time
from uuid import uuid4

import httpx


started = time.perf_counter()
first = None
completed = False
with httpx.Client(timeout=180, headers={"X-Rag-Chat": str(uuid4())}) as client:
    with client.stream(
        "POST", "http://localhost:8000/api/rag/ask?stream=true",
        json={"question": "Когда выбрать TensorFlow.js вместо Gemini Nano?"},
    ) as response:
        response.raise_for_status()
        print("headers_seconds", round(time.perf_counter() - started, 2), flush=True)
        for line in response.iter_lines():
            if not line:
                continue
            event = json.loads(line)
            if event["type"] == "token" and first is None:
                first = time.perf_counter() - started
                print("first_token_seconds", round(first, 2), flush=True)
            if event["type"] == "done":
                completed = True
                print("total_seconds", round(time.perf_counter() - started, 2), flush=True)
                print("answer:", event["result"]["answer"], flush=True)
                print("sources:", len(event["result"]["sources"]), flush=True)
            if event["type"] == "error":
                raise RuntimeError(event["message"])
if not completed:
    raise RuntimeError("Stream ended without a final answer")
