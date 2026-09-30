"""ORM-модели. Схема создаётся скриптами из database/, здесь только отображение."""

from datetime import datetime

from sqlalchemy import CheckConstraint, DateTime, Integer, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


class Base(DeclarativeBase):
    pass


class RagChat(Base):
    __tablename__ = "rag_chats"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    turns: Mapped[list] = mapped_column(JSONB, nullable=False, default=list)
    pending: Mapped[str | None] = mapped_column(String(36), nullable=True)
    pending_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Recommendation(Base):
    """Строка статичной таблицы рекомендаций."""

    __tablename__ = "recommendations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    rec_key: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    task_type: Mapped[str] = mapped_column(Text, nullable=False)
    tfjs_verdict: Mapped[str] = mapped_column(Text, nullable=False)
    gemini_verdict: Mapped[str] = mapped_column(Text, nullable=False)
    comment: Mapped[str] = mapped_column(Text, nullable=False, default="")
    sort_order: Mapped[int] = mapped_column(Integer, nullable=False, default=100)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Measurement(Base):
    """Один прогон одного подхода в одном эксперименте."""

    __tablename__ = "measurements"
    __table_args__ = (
        CheckConstraint("approach IN ('tensorflow_js', 'gemini_nano')", name="measurements_approach_check"),
        CheckConstraint("status IN ('ok', 'error', 'unsupported')", name="measurements_status_check"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    experiment_key: Mapped[str] = mapped_column(Text, nullable=False)
    experiment_title: Mapped[str] = mapped_column(Text, nullable=False)
    approach: Mapped[str] = mapped_column(Text, nullable=False)
    model_name: Mapped[str] = mapped_column(Text, nullable=False)
    settings: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    environment: Mapped[dict] = mapped_column(JSONB, nullable=False, default=dict)
    input_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    output_summary: Mapped[str] = mapped_column(Text, nullable=False, default="")
    status: Mapped[str] = mapped_column(Text, nullable=False, default="ok")
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    run_index: Mapped[int] = mapped_column(Integer, nullable=False, default=1)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class RagDocument(Base):
    """Проиндексированный фрагмент для поиска RAG-бота."""

    __tablename__ = "rag_documents"
    __table_args__ = (
        UniqueConstraint("source_type", "source_key", name="rag_documents_source_unique"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    source_type: Mapped[str] = mapped_column(String, nullable=False)
    source_key: Mapped[str] = mapped_column(String, nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    embedding: Mapped[list] = mapped_column(JSONB, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
