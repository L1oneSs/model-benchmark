"""Persistent per-client history; short row locks serialize writes and enforce the cap."""
from datetime import datetime, timedelta, timezone
from uuid import UUID, uuid4

from fastapi import Header, HTTPException
from sqlalchemy import select
from sqlalchemy.dialects.postgresql import insert

from app.db.database import SessionLocal
from app.db.models import AgentChat
from app.schemas import AgentHistoryTurn

HISTORY_LIMIT = 30


def chat_id(x_agent_chat: UUID | None = Header(default=None),
            x_rag_chat: UUID | None = Header(default=None)) -> str:
    if x_agent_chat is not None and x_rag_chat is not None and x_agent_chat != x_rag_chat:
        raise HTTPException(400, "Идентификаторы чата в заголовках не совпадают")
    key = x_agent_chat or x_rag_chat
    if key is None:
        raise HTTPException(422, "Передайте UUID чата в X-Agent-Chat")
    return str(key)


def locked_chat(session, key):
    session.execute(insert(AgentChat).values(id=key, turns=[]).on_conflict_do_nothing())
    return session.scalar(select(AgentChat).where(AgentChat.id == key).with_for_update())


def read_history(key):
    with SessionLocal.begin() as session:
        chat = locked_chat(session, key)
        return {"turns": chat.turns, "limit": HISTORY_LIMIT}


def clear_history(key):
    with SessionLocal.begin() as session:
        chat = locked_chat(session, key)
        chat.turns = []
        chat.pending = None
        chat.pending_at = None
    return {"turns": [], "limit": HISTORY_LIMIT}


def import_history(key, turns):
    with SessionLocal.begin() as session:
        chat = locked_chat(session, key)
        # Never overwrite server history or duplicate a concurrent migration.
        if not chat.turns and not chat.pending:
            chat.turns = [turn.model_dump() for turn in turns]
        return {"turns": chat.turns, "limit": HISTORY_LIMIT}


def reserve(key):
    with SessionLocal.begin() as session:
        chat = locked_chat(session, key)
        if len(chat.turns) >= HISTORY_LIMIT:
            raise HTTPException(409, "Достигнут лимит истории: 30 ответов. Удалите историю чата, чтобы продолжить.")
        if chat.pending and chat.pending_at and chat.pending_at > datetime.now(timezone.utc) - timedelta(minutes=15):
            raise HTTPException(409, "В этом чате уже формируется ответ. Дождитесь его или удалите чат.")
        token = str(uuid4())
        chat.pending = token
        chat.pending_at = datetime.now(timezone.utc)
        history = [AgentHistoryTurn(question=t["question"][:2000], answer=t["answer"][:6000], sources=t.get('sources', [])) for t in chat.turns[-3:]]
        return token, history


def finish(key, token, question, answer):
    with SessionLocal.begin() as session:
        chat = locked_chat(session, key)
        if chat.pending != token:
            raise RuntimeError("История чата удалена во время генерации")
        chat.turns = [*chat.turns, {"question": question, **answer}]
        chat.pending = None
        chat.pending_at = None


def release(key, token):
    with SessionLocal.begin() as session:
        chat = locked_chat(session, key)
        if chat.pending == token:
            chat.pending = None
            chat.pending_at = None
