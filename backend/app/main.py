"""Точка входа бэкенда.

Бэкенд намеренно не выполняет инференс: обе сравниваемые парадигмы работают
в браузере пользователя, поэтому сервер отвечает за хранение результатов,
их агрегацию и работу агента."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import FileResponse
from app.agent.chart_rendering import DIRECTORY as CHART_DIRECTORY
import re
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from app.api import measurements, agent, recommendations
from app.config import get_settings
from app.db.database import engine
from app.db.models import AgentChat

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
logger = logging.getLogger("model-benchmark")

settings = get_settings()

@asynccontextmanager
async def lifespan(app: FastAPI):
    AgentChat.__table__.create(engine, checkfirst=True)
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
app.include_router(agent.router)

@app.get('/api/agent/charts/{filename}', tags=['agent'])
def chart_artifact(filename: str):
    if not re.fullmatch(r'[a-f0-9]{32}\.(png|html)', filename):
        raise HTTPException(404, 'Chart not found')
    path = CHART_DIRECTORY / filename
    if not path.is_file():
        raise HTTPException(404, 'Chart not found')
    return FileResponse(path, media_type='image/png' if filename.endswith('.png') else 'text/html',
                        headers={'X-Content-Type-Options': 'nosniff'})
# Deprecated chat aliases only; no legacy RAG service or index.
legacy_chat = APIRouter(prefix="/api/rag")
for route in agent.router.routes:
    legacy_chat.add_api_route(route.path.removeprefix("/api/agent"), route.endpoint,
        methods=route.methods, response_model=route.response_model, include_in_schema=False, deprecated=True)
app.include_router(legacy_chat)


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
    }
