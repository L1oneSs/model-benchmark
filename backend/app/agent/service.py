"""Agent orchestration: tools, evidence, reports, charts and streamed answers."""
from __future__ import annotations

import json
import logging
import re
from collections.abc import AsyncIterator
from time import perf_counter

import httpx
from sqlalchemy.orm import Session

from app.config import get_settings
from app.agent.planner import AgentPlanner
from app.agent.prompts import SYSTEM_PROMPT, build_user_prompt
from app.agent.reports import render_numeric_answer
from app.agent.intent import asks_recommendation_table, asks_recommendations_with_measurements
from app.schemas import AgentAnswer, AgentHistoryTurn, AgentSource, AgentChart

logger = logging.getLogger(__name__)
ANSWER_SCHEMA = {
    "type": "object", "properties": {"answer": {"type": "string"}},
    "required": ["answer"], "additionalProperties": False,
}


def answer_prefix(text: str) -> str:
    """Read only the answer JSON string, including an incomplete streamed string."""
    match = re.match(r'^\s*\{\s*"answer"\s*:\s*', text)
    if not match:
        return ""
    value = text[match.end():]
    if not value.startswith('"'):
        return ""
    try:
        decoded, _ = json.JSONDecoder().raw_decode(value)
        return decoded if isinstance(decoded, str) else ""
    except json.JSONDecodeError:
        # Chunks can split escape sequences and Unicode surrogate pairs.
        for trim in range(min(6, len(value))):
            prefix = value if trim == 0 else value[:-trim]
            try:
                decoded = json.loads(prefix + '"')
                if decoded and 0xD800 <= ord(decoded[-1]) <= 0xDBFF:
                    decoded = decoded[:-1]
                return decoded
            except json.JSONDecodeError:
                continue
    return ""


class AgentService:
    def __init__(self, session: Session) -> None:
        self.settings = get_settings()
        self.session = session
        self.planner = AgentPlanner(session, self.settings)

    async def answer(self, question: str, thinking: bool = False,
                     history: list[AgentHistoryTurn] | None = None) -> AgentAnswer:
        async for event in self.stream_answer(question, thinking, history):
            if event["type"] == "done":
                return AgentAnswer.model_validate(event["result"])
        raise RuntimeError("Поток ответа завершился без результата")

    async def stream_answer(self, question: str, thinking: bool = False,
                            history: list[AgentHistoryTurn] | None = None) -> AsyncIterator[dict]:
        started = perf_counter()
        history = (history or [])[-3:]
        yield {"type": "status", "message": "Выбираю инструменты для ответа…"}
        table_only = asks_recommendation_table(question)
        sources = []
        async for event in self.planner.collect(question, history):
            if event["type"] == "context":
                sources = event["sources"]
            else:
                yield event
        if table_only:
            history = []
        yield {"type": "sources", "sources": [s.model_dump() for s in sources], "model": self.settings.ollama_chat_model}
        charts = []
        for source in sources:
            if source.source_key.startswith("build_chart:"):
                data = json.loads(source.content)
                for item in data.get("charts", [data["chart"]] if "chart" in data else []):
                    chart = AgentChart.model_validate(item)
                    if chart not in charts:
                        charts.append(chart)
        if len(charts) > 8:
            raise RuntimeError("Запрошено слишком много графиков. Уточните эксперимент или метрики.")
        report = render_numeric_answer(question, sources)
        if report is not None:
            yield {"type": "token", "text": report}
            result = AgentAnswer(answer=report, thinking="", sources=sources, model=self.settings.ollama_chat_model, charts=charts)
            logger.info("Agent report total_seconds=%.3f", perf_counter() - started)
            yield {"type": "done", "result": result.model_dump()}
            return
        answer_text = ""
        thinking_text = ""
        if sources:
            context = "\n\n".join(f"[{i}] {source.source_key}:\n{source.content}"
                                    for i, source in enumerate(sources, 1))
            prompt = build_user_prompt(context, question)
            if table_only:
                prompt += '\nОтветь только о содержимом таблицы: отдельно TensorFlow.js, Gemini Nano и комментарий нужного критерия. Не добавляй результаты прогонов или числа из истории переписки.'
            elif asks_recommendations_with_measurements(question):
                prompt += ('\nОбязательно ответь на основе ОБОИХ источников: кратко вердикт таблицы, затем '
                           'медианы инференса из calculate_statistics с моделями, бэкендами, n и ссылками, '
                           'затем практический выбор для данного эксперимента. Не ограничивайся пересказом таблицы. '
                           'Не распространяй результаты одного эксперимента на все задачи обработки текста. '
                           'Если измерений нет, прямо скажи об этом; не придумывай сравнение.')
            yield {"type": "status", "message": "Модель обрабатывает контекст…"}
            truncated = False
            async for chunk in self._chat_stream(prompt, thinking, []):
                if chunk.get("thinking") and thinking:
                    thinking_text += chunk["thinking"]
                    yield {"type": "thinking", "text": chunk["thinking"]}
                if chunk.get("text"):
                    answer_text += chunk["text"]
                    yield {"type": "token", "text": chunk["text"]}
                truncated = truncated or chunk.get("truncated", False)
            # Thinking exhausting its budget must not replace the final answer.
            if not answer_text.strip() and thinking:
                yield {"type": "status", "message": "Формирую итоговый ответ…"}
                truncated = False
                async for chunk in self._chat_stream(prompt, False, []):
                    if chunk.get("text"):
                        answer_text += chunk["text"]
                        yield {"type": "token", "text": chunk["text"]}
                    truncated = truncated or chunk.get("truncated", False)
            if not answer_text.strip():
                raise RuntimeError("Модель не сформировала итоговый ответ. Попробуйте уточнить вопрос.")
            if truncated:
                answer_text += "\n\nОтвет достиг ограничения длины. Уточните вопрос для продолжения."
        else:
            raise RuntimeError("Агент не получил данных для ответа.")
        result = AgentAnswer(answer=answer_text.strip(), thinking=thinking_text, sources=sources,
                           model=self.settings.ollama_chat_model, charts=charts)
        logger.info("Agent total_seconds=%.3f thinking=%s", perf_counter() - started, thinking)
        yield {"type": "done", "result": result.model_dump()}

    async def _chat_stream(self, user_prompt: str, thinking: bool = False,
                           history: list[AgentHistoryTurn] | None = None) -> AsyncIterator[dict]:
        messages = [{"role": "system", "content": SYSTEM_PROMPT +
            '\nВерни JSON вида {"answer":"готовый ответ пользователю"}. '
            'В answer пиши только итоговый ответ, без описания своего анализа, планов и рассуждений. '
            'История нужна для понимания вопроса, факты бери только из текущего контекста.'}]
        for turn in (history or [])[-3:]:
            messages.extend([
                {"role": "user", "content": turn.question[:1000]},
                {"role": "assistant", "content": json.dumps({"answer": turn.answer[:1800]}, ensure_ascii=False)},
            ])
        messages.append({"role": "user", "content": user_prompt})
        payload = {
            "model": self.settings.ollama_chat_model, "stream": True,
            "think": thinking, "format": ANSWER_SCHEMA,
            "keep_alive": self.settings.ollama_keep_alive,
            "options": {"temperature": 0.2, "num_predict": self.settings.agent_max_tokens + (512 if thinking else 0),
                        "num_ctx": 8192, "num_thread": 4},
            "messages": messages,
        }
        raw = ""
        emitted = ""
        async with httpx.AsyncClient(timeout=self.settings.ollama_timeout_seconds) as client:
            async with client.stream("POST", f"{self.settings.ollama_url.rstrip('/')}/api/chat", json=payload) as response:
                response.raise_for_status()
                async for line in response.aiter_lines():
                    if not line.strip():
                        continue
                    data = json.loads(line)
                    if data.get("error"):
                        raise RuntimeError(data["error"])
                    message = data.get("message") or {}
                    if thinking and message.get("thinking"):
                        yield {"thinking": message["thinking"]}
                    raw += message.get("content", "")
                    prefix = answer_prefix(raw)
                    if prefix.startswith(emitted) and len(prefix) > len(emitted):
                        yield {"text": prefix[len(emitted):]}
                        emitted = prefix
                    if data.get("done"):
                        truncated = data.get("done_reason") == "length"
                        if raw.strip() and not truncated:
                            try:
                                parsed = json.loads(raw)
                            except json.JSONDecodeError as exc:
                                raise RuntimeError("Модель вернула некорректный формат ответа") from exc
                            if not isinstance(parsed, dict) or not isinstance(parsed.get("answer"), str):
                                raise RuntimeError("Модель вернула некорректный формат ответа")
                        logger.info("Ollama tokens=%s load_seconds=%.2f", data.get("eval_count"), data.get("load_duration", 0) / 1e9)
                        yield {"truncated": truncated}
                        return
        raise RuntimeError("Ollama прервала ответ до завершения")
