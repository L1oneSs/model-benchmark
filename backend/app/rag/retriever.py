"""Поиск по индексу: косинусная близость на numpy.

Корпус стенда — это несколько десятков строк (таблица рекомендаций плюс сводки
измерений), поэтому полный перебор дешевле любого векторного индекса и не
требует расширений PostgreSQL."""

from __future__ import annotations

import numpy as np
import re
from sqlalchemy.orm import Session

from app.db.models import Measurement, Recommendation
from app.db.repositories import (
    MeasurementRepository,
    RagDocumentRepository,
    RecommendationRepository,
)
from app.rag.embeddings import EmbeddingClient


def asks_recommendation_table(question: str) -> bool:
    text = question.lower()
    table = bool(re.search(r"таблиц\w*.*рекомендац|рекомендац\w*.*таблиц|статич\w*.*таблиц", text))
    comparison = bool(re.search(r"измерен|замер|прогон", text) and
                      re.search(r"сравн|сопостав|соответств|подтвержд|расхожд|отлич|почему", text))
    return table and not comparison


def title_relevance(question: str, title: str) -> float:
    words = {word[:5] for word in re.findall(r"[а-яёa-z0-9]+", question.lower()) if len(word) >= 4}
    title_words = {word[:5] for word in re.findall(r"[а-яёa-z0-9]+", title.lower()) if len(word) >= 4}
    return len(words & title_words) / max(1, len(title_words))


def recommendation_to_text(row: Recommendation) -> str:
    return (
        f"Рекомендация «{row.title}» (ключ {row.rec_key}, класс задачи {row.task_type}). "
        f"TensorFlow.js: {row.tfjs_verdict} "
        f"Gemini Nano: {row.gemini_verdict} "
        f"Комментарий: {row.comment}"
    )


def measurement_to_text(row: Measurement) -> str:
    approach = "TensorFlow.js" if row.approach == "tensorflow_js" else "Gemini Nano"
    if row.status != "ok":
        return (
            f"Измерение эксперимента «{row.experiment_title}» (ключ {row.experiment_key}), "
            f"подход {approach}: прогон не состоялся, статус {row.status}. "
            f"{row.error_message or ''}"
        ).strip()

    parts = []
    labels = {
        "load_ms": "загрузка модели",
        "first_token_ms": "время до первого предсказания",
        "inference_ms": "латентность инференса",
        "total_ms": "полное время",
        "memory_mb": "память",
    }
    for metric, label in labels.items():
        value = row.metrics.get(metric) if isinstance(row.metrics, dict) else None
        if isinstance(value, (int, float)):
            unit = "МБ" if metric == "memory_mb" else "мс"
            parts.append(f"{label} {round(float(value), 1)} {unit}")
    settings = ", ".join(f"{k}={v}" for k, v in (row.settings or {}).items())
    return (
        f"Измерение эксперимента «{row.experiment_title}» (ключ {row.experiment_key}), "
        f"подход {approach}, модель {row.model_name}"
        f"{', настройки: ' + settings if settings else ''}. "
        f"Результаты: {'; '.join(parts) if parts else 'метрики не записаны'}. "
        f"Дата прогона {row.created_at:%d.%m.%Y %H:%M}."
    )


class Retriever:
    def __init__(self, session: Session) -> None:
        self.session = session
        self.documents = RagDocumentRepository(session)
        self.recommendations = RecommendationRepository(session)
        self.measurements = MeasurementRepository(session)
        self.embeddings = EmbeddingClient()

    async def reindex(self, recent_measurements: int = 10) -> int:
        """Перестраивает индекс: все рекомендации плюс последние измерения.

        Вызывается после каждой записи измерений, поэтому бот отвечает
        с учётом самых свежих прогонов."""
        payload: list[tuple[str, str, str]] = []

        for row in self.recommendations.list_all():
            payload.append(("recommendation", row.rec_key, recommendation_to_text(row)))

        for row in self.measurements.list_recent(limit=recent_measurements):
            payload.append(("measurement_summary", str(row.id), measurement_to_text(row)))

        if not payload:
            return 0

        existing = {(row.source_type, row.source_key): row.content for row in self.documents.list_all()}
        changed = [item for item in payload if existing.get((item[0], item[1])) != item[2]]
        vectors = await self.embeddings.embed([text for _, _, text in changed])
        for (source_type, source_key, text), vector in zip(changed, vectors, strict=True):
            self.documents.upsert(source_type, source_key, text, vector)
        return len(payload)

    async def search(self, question: str, top_k: int, *, table_only: bool = False) -> list[tuple[str, str, str, float]]:
        """Возвращает top_k фрагментов: (source_type, source_key, content, score)."""
        recommendations = self.recommendations.list_all()
        current = {row.rec_key: recommendation_to_text(row) for row in recommendations}
        if table_only:
            # Same live table as the UI; works even before the first reindex.
            ranked = sorted(recommendations, key=lambda row: title_relevance(question, row.title), reverse=True)
            return [("recommendation", row.rec_key, current[row.rec_key], title_relevance(question, row.title))
                    for row in ranked[:top_k]]
        rows = [row for row in self.documents.list_all()
                if row.source_type != "recommendation" or row.source_key in current]
        if not rows:
            return []

        query_vector = np.asarray(await self.embeddings.embed_one(question), dtype=np.float32)
        matrix = np.asarray([row.embedding for row in rows], dtype=np.float32)

        query_norm = np.linalg.norm(query_vector)
        row_norms = np.linalg.norm(matrix, axis=1)
        denominator = row_norms * query_norm
        denominator[denominator == 0] = 1e-9
        scores = (matrix @ query_vector) / denominator

        order = list(np.argsort(-scores))
        # Keep room for recommendations even if many runs have a higher score.
        recommended = [i for i in order if rows[i].source_type == "recommendation"][:max(1, top_k // 2)]
        selected = recommended + [i for i in order if i not in recommended][:max(0, top_k - len(recommended))]
        return [
            (rows[i].source_type, rows[i].source_key,
             current[rows[i].source_key] if rows[i].source_type == "recommendation" else rows[i].content,
             float(scores[i]))
            for i in selected
        ]
