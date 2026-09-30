"""Эмбеддинги через локальную Ollama. Внешние API не используются:
модель скачивается один раз сервисом llm-bootstrap и живёт в томе ollama."""

from __future__ import annotations

import httpx

from app.config import get_settings


class EmbeddingClient:
    def __init__(self) -> None:
        settings = get_settings()
        self.base_url = settings.ollama_url.rstrip("/")
        self.model = settings.ollama_embedding_model
        self.timeout = settings.ollama_timeout_seconds
        self.keep_alive = 0

    async def embed(self, texts: list[str]) -> list[list[float]]:
        """Возвращает по вектору на каждый текст в том же порядке."""
        if not texts:
            return []
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            response = await client.post(
                f"{self.base_url}/api/embed",
                json={"model": self.model, "input": texts, "keep_alive": self.keep_alive},
            )
            response.raise_for_status()
            payload = response.json()
        vectors = payload.get("embeddings")
        if not vectors:
            raise RuntimeError(f"Ollama вернула пустой ответ на эмбеддинги: {payload}")
        return vectors

    async def embed_one(self, text: str) -> list[float]:
        vectors = await self.embed([text])
        return vectors[0]
