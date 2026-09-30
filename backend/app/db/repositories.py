"""Доступ к данным. Вся работа с таблицами собрана здесь, чтобы слой API
и RAG-сервис не писали SQL напрямую."""

from __future__ import annotations

import statistics
from datetime import datetime, timezone

from sqlalchemy import Float, cast, desc, func, select
from sqlalchemy.orm import Session

from app.db.models import Measurement, RagDocument, Recommendation


class RecommendationRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def list_all(self) -> list[Recommendation]:
        stmt = select(Recommendation).order_by(Recommendation.sort_order, Recommendation.id)
        return list(self.session.scalars(stmt))

    def get(self, rec_key: str) -> Recommendation | None:
        return self.session.scalar(select(Recommendation).where(Recommendation.rec_key == rec_key))

    def update(self, rec_key: str, fields: dict) -> Recommendation | None:
        row = self.get(rec_key)
        if row is None:
            return None
        for name, value in fields.items():
            if value is not None and hasattr(row, name):
                setattr(row, name, value)
        row.updated_at = datetime.now(timezone.utc)
        self.session.commit()
        self.session.refresh(row)
        return row


class MeasurementRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add_many(self, rows: list[Measurement]) -> list[Measurement]:
        self.session.add_all(rows)
        self.session.commit()
        for row in rows:
            self.session.refresh(row)
        return rows

    def next_run_index(self, experiment_key: str) -> int:
        current = self.session.scalar(
            select(func.max(Measurement.run_index)).where(Measurement.experiment_key == experiment_key)
        )
        return (current or 0) + 1

    def list_recent(
        self,
        experiment_key: str | None = None,
        approach: str | None = None,
        backend: str | None = None,
        sort_by: str = "created_at",
        sort_order: str = "desc",
        limit: int = 50,
        offset: int = 0,
    ) -> list[Measurement]:
        metric_columns = {
            "inference_ms": cast(Measurement.metrics["inference_ms"].as_string(), Float),
            "first_token_ms": cast(Measurement.metrics["first_token_ms"].as_string(), Float),
            "memory_mb": cast(Measurement.metrics["memory_mb"].as_string(), Float),
            "created_at": Measurement.created_at,
        }
        sort_column = metric_columns.get(sort_by, Measurement.created_at)
        order = sort_column.asc() if sort_order == "asc" else sort_column.desc()
        stmt = select(Measurement).order_by(order.nullslast(), desc(Measurement.id))
        if experiment_key:
            stmt = stmt.where(Measurement.experiment_key == experiment_key)
        if approach:
            stmt = stmt.where(Measurement.approach == approach)
        if backend:
            stmt = stmt.where(Measurement.settings["backend"].as_string() == backend)
        return list(self.session.scalars(stmt.limit(limit).offset(offset)))

    def count(
        self,
        experiment_key: str | None = None,
        approach: str | None = None,
        backend: str | None = None,
    ) -> int:
        stmt = select(func.count(Measurement.id))
        if experiment_key:
            stmt = stmt.where(Measurement.experiment_key == experiment_key)
        if approach:
            stmt = stmt.where(Measurement.approach == approach)
        if backend:
            stmt = stmt.where(Measurement.settings["backend"].as_string() == backend)
        return self.session.scalar(stmt) or 0

    def latest_per_approach(self, experiment_key: str) -> dict[str, Measurement]:
        """Последнее удачное измерение по каждой парадигме — для dropdown на вкладке «Стенд»."""
        out: dict[str, Measurement] = {}
        for approach in ("tensorflow_js", "gemini_nano"):
            row = self.session.scalar(
                select(Measurement)
                .where(
                    Measurement.experiment_key == experiment_key,
                    Measurement.approach == approach,
                    Measurement.status == "ok",
                )
                .order_by(desc(Measurement.created_at), desc(Measurement.id))
                .limit(1)
            )
            if row is not None:
                out[approach] = row
        return out

    def aggregate(self, experiment_key: str, approach: str, window: int = 10, backend: str | None = None) -> dict | None:
        """Медиана, среднее и разброс по последним window прогонам.

        Медиана устойчивее среднего к выбросам первого прогона, поэтому в
        сравнительных таблицах опираемся на неё."""
        query = select(Measurement)
        if backend is not None:
            query = query.where(Measurement.settings["backend"].astext == backend)
        rows = self.session.scalars(
            query
            .where(
                Measurement.experiment_key == experiment_key,
                Measurement.approach == approach,
                Measurement.status == "ok",
            )
            .order_by(desc(Measurement.created_at), desc(Measurement.id))
            .limit(window)
        ).all()
        if not rows:
            return None

        summary: dict = {
            "experiment_key": experiment_key,
            "approach": approach,
            "runs": len(rows),
            "model_name": rows[0].model_name,
        }
        for metric in ("load_ms", "first_token_ms", "inference_ms", "total_ms", "memory_mb"):
            values = [
                float(row.metrics[metric])
                for row in rows
                if isinstance(row.metrics, dict) and isinstance(row.metrics.get(metric), (int, float))
            ]
            if not values:
                continue
            summary[metric] = {
                "median": round(statistics.median(values), 2),
                "mean": round(statistics.fmean(values), 2),
                "min": round(min(values), 2),
                "max": round(max(values), 2),
                "stdev": round(statistics.stdev(values), 2) if len(values) > 1 else 0.0,
                "samples": len(values),
            }
        return summary


class RagDocumentRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def upsert(self, source_type: str, source_key: str, content: str, embedding: list[float]) -> None:
        row = self.session.scalar(
            select(RagDocument).where(
                RagDocument.source_type == source_type,
                RagDocument.source_key == source_key,
            )
        )
        if row is None:
            row = RagDocument(source_type=source_type, source_key=source_key)
            self.session.add(row)
        row.content = content
        row.embedding = embedding
        row.updated_at = datetime.now(timezone.utc)
        self.session.commit()

    def list_all(self) -> list[RagDocument]:
        return list(self.session.scalars(select(RagDocument)))

    def count(self) -> int:
        return self.session.scalar(select(func.count(RagDocument.id))) or 0
