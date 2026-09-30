"""Эндпоинты RAG-бота."""

from __future__ import annotations

import httpx
import json
import logging
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session

from app.db.database import get_session
from app.rag.service import RagService
from app.schemas import RagAnswer, RagQuery, RagHistoryImport
from app.rag.history import chat_id, read_history, clear_history, import_history, reserve, finish, release

router = APIRouter(prefix="/api/rag", tags=["rag"])


@router.get("/history")
def history(key: str = Depends(chat_id)):
    return read_history(key)


@router.delete("/history")
def delete_history(key: str = Depends(chat_id)):
    return clear_history(key)


@router.post("/history/import")
def migrate_history(body: RagHistoryImport, key: str = Depends(chat_id)):
    return import_history(key, body.turns)


@router.post("/ask", response_model=RagAnswer)
async def ask(query: RagQuery, stream: bool = False, session: Session = Depends(get_session), key: str = Depends(chat_id)):
    token, history = reserve(key)
    if stream:
        async def events():
            try:
                async for event in RagService(session).stream_answer(query.question, query.thinking, history):
                    if event["type"] == "done":
                        finish(key, token, query.question, event["result"])
                    yield json.dumps(event, ensure_ascii=False) + "\n"
            except Exception:
                logging.getLogger(__name__).exception("RAG streaming failed")
                yield json.dumps({"type": "error", "message": "Не удалось завершить ответ локальной модели. Повторите запрос; подробности в логах бэкенда."}, ensure_ascii=False) + "\n"
            finally:
                release(key, token)
        return StreamingResponse(events(), media_type="application/x-ndjson", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})
    try:
        result = await RagService(session).answer(query.question, query.thinking, history)
        finish(key, token, query.question, result.model_dump())
        return result
    except (httpx.HTTPError, RuntimeError) as exc:
        raise HTTPException(
            status_code=503,
            detail=(
                "Локальная модель недоступна. Проверьте, что сервисы llm и llm-bootstrap "
                f"поднялись: docker compose logs llm-bootstrap. Ошибка: {exc}"
            ),
        ) from exc
    finally:
        release(key, token)


@router.post("/reindex")
async def reindex(session: Session = Depends(get_session)) -> dict[str, int]:
    """Ручная переиндексация. Обычно вызывается автоматически после записи измерений."""
    try:
        indexed = await RagService(session).reindex()
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=503, detail=f"Ollama недоступна: {exc}") from exc
    return {"indexed": indexed}
