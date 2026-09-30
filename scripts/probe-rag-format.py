import httpx
import time
import sys

thinking = "--thinking" in sys.argv

started = time.perf_counter()
data = httpx.post("http://llm:11434/api/chat", json={
    "model": "qwen3:4b", "stream": False, "think": thinking,
    "format": {"type": "object", "properties": {"answer": {"type": "string"}}, "required": ["answer"], "additionalProperties": False},
    "messages": [
        {"role": "system", "content": "Ответь по-русски в JSON с полем answer. В answer помести только готовый ответ пользователю, 2 предложения. Не описывай свои действия и процесс анализа."},
        {"role": "user", "content": "Когда выбрать TensorFlow.js вместо Gemini Nano? Контекст: TensorFlow.js позволяет выбрать ускоритель, Gemini Nano не позволяет."},
    ], "keep_alive": 0, "options": {"num_predict": 128, "num_ctx": 4096, "num_thread": 4, "temperature": 0.2},
}, timeout=180)
data.raise_for_status()
result = data.json()
print(round(time.perf_counter() - started, 2), "content:", result["message"]["content"],
      "thinking_chars:", len(result["message"].get("thinking", "")), "done_reason:", result.get("done_reason"), flush=True)
