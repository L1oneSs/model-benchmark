"""Chat agent API, streaming and persistent conversation history."""

from __future__ import annotations

import httpx
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.database import get_session
from app.agent.service import AgentService
from app.schemas import AgentAnswer, AgentQuery, AgentHistoryImport
from app.agent.history import chat_id, read_history, clear_history, import_history, reserve, finish, release

router = APIRouter(prefix="/api/agent", tags=["agent"])


@router.get("/history")
def history(key: str = Depends(chat_id)):
    return read_history(key)


@router.delete("/history")
def delete_history(key: str = Depends(chat_id)):
    return clear_history(key)


@router.post("/history/import")
def migrate_history(body: AgentHistoryImport, key: str = Depends(chat_id)):
    return import_history(key, body.turns)


@router.post("/ask", response_model=AgentAnswer)
async def ask(query: AgentQuery, stream: bool = False, session: Session = Depends(get_session), key: str = Depends(chat_id)):
    token, history = reserve(key)
    if stream:
        async def events():
            try:
                async for event in AgentService(session).stream_answer(query.question, query.thinking, history):
                    if event["type"] == "done":
                        finish(key, token, query.question, event["result"])
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except Exception as exc:
                logging.getLogger(__name__).warning("Agent streaming failed: %s", type(exc).__name__)
                message = str(exc) if isinstance(exc, RuntimeError) else "Сервис агента недоступен. Проверьте backend и Ollama и повторите запрос."
                yield json.dumps({"type": "error", "message": message}, ensure_ascii=False) + "\n"
            finally:
                release(key, token)
        return StreamingResponse(events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    try:
        result = await AgentService(session).answer(query.question, query.thinking, history)
        finish(key, token, query.question, result.model_dump())
        return result
    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail=str(exc) if isinstance(exc, RuntimeError) else "Сервис агента недоступен. Проверьте конфигурацию backend и Ollama.",
        ) from exc
    finally:
        release(key, token)
