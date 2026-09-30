"""Точка входа бэкенда.

Бэкенд намеренно не выполняет инференс: обе сравниваемые парадигмы работают
в браузере пользователя, поэтому сервер отвечает за хранение результатов,
их агрегацию и работу RAG-бота."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import measurements, rag, recommendations
from app.config import get_settings
from app.db.database import engine
from app.db.models import RagChat

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("model-benchmark")

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    RagChat.__table__.create(engine, checkfirst=True)
    yield


app = FastAPI(
    lifespan=lifespan,
    title="Model Benchmark API",
    description=(
        "Бэкенд стенда для сравнения библиотечной (TensorFlow.js) и встроенной "
        "(Gemini Nano) парадигм интеграции машинного обучения в браузер."
    ),
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(measurements.router)
app.include_router(recommendations.router)
app.include_router(rag.router)


@app.get("/api/health", tags=["service"])
def health() -> dict[str, str]:
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database_status = "ok"
    except Exception as exc:  # noqa: BLE001
        database_status = f"error: {exc}"
    return {
        "status": "ok",
        "database": database_status,
        "chat_model": settings.ollama_chat_model,
        "embedding_model": settings.ollama_embedding_model,
    }
