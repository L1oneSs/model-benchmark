"""Конфигурация сервиса. Все значения приходят из переменных окружения,
которые docker-compose берёт из .env."""

from functools import lru_cache
from pydantic import Field

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+psycopg://benchmark:benchmark@database:5432/benchmark"

    ollama_url: str = "http://llm:11434"
    ollama_chat_model: str = "qwen3:4b"
    ollama_embedding_model: str = "qwen3-embedding:0.6b"
    ollama_timeout_seconds: float = 180.0
    ollama_keep_alive: str = "0"
    rag_max_tokens: int = Field(default=384, ge=64, le=4096)

    # Сколько фрагментов подмешивать в контекст ответа бота
    rag_top_k: int = 6
    # Сколько последних измерений бот учитывает помимо таблицы рекомендаций
    rag_recent_measurements: int = 10

    cors_origins: str = "http://localhost:8080"

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()
