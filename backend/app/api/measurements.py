"""Приём и выдача измерений.

Замеры снимает браузер: и TensorFlow.js, и Gemini Nano исполняются на стороне
клиента, поэтому бэкенд ничего не вычисляет — он принимает готовые числа,
складывает их в PostgreSQL для таблиц и инструментов агента."""

from __future__ import annotations

import csv
import io

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.orm import Session

from app.db.database import get_session
from app.db.models import Measurement
from app.db.repositories import MeasurementRepository
from app.schemas import MeasurementBatchIn, MeasurementOut, MeasurementPage


router = APIRouter(prefix="/api/measurements", tags=["measurements"])


@router.post("", response_model=list[MeasurementOut], status_code=201)
async def create_measurements(
    batch: MeasurementBatchIn,
    session: Session = Depends(get_session),
) -> list[Measurement]:
    repo = MeasurementRepository(session)
    run_index = repo.next_run_index(batch.runs[0].experiment_key)

    rows = [
        Measurement(
            experiment_key=run.experiment_key,
            experiment_title=run.experiment_title,
            approach=run.approach,
            model_name=run.model_name,
            settings=run.settings,
            metrics=run.metrics,
            environment=run.environment,
            input_summary=run.input_summary,
            output_summary=run.output_summary,
            status=run.status,
            error_message=run.error_message,
            run_index=run_index,
        )
        for run in batch.runs
    ]
    saved = repo.add_many(rows)
    return saved


@router.get("", response_model=MeasurementPage)
def list_measurements(
    experiment_key: str | None = None,
    approach: str | None = None,
    backend: str | None = None,
    sort_by: str = Query(default="created_at", pattern="^(inference_ms|first_token_ms|memory_mb|created_at)$"),
    sort_order: str = Query(default="desc", pattern="^(asc|desc)$"),
    limit: int = Query(default=20, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    session: Session = Depends(get_session),
) -> MeasurementPage:
    repo = MeasurementRepository(session)
    return MeasurementPage(
        total=repo.count(experiment_key, approach, backend),
        items=[MeasurementOut.model_validate(row) for row in repo.list_recent(
            experiment_key, approach, backend, sort_by, sort_order, limit, offset,
        )],
    )


@router.get("/latest")
def latest_by_experiment(
    experiment_key: str,
    session: Session = Depends(get_session),
) -> dict[str, MeasurementOut]:
    """Последний удачный прогон каждой парадигмы — для dropdown на вкладке «Стенд»."""
    repo = MeasurementRepository(session)
    return {
        approach: MeasurementOut.model_validate(row)
        for approach, row in repo.latest_per_approach(experiment_key).items()
    }


@router.get("/summary")
def summary(
    experiment_key: str,
    window: int = Query(default=10, ge=1, le=100),
    backend: str | None = None,
    session: Session = Depends(get_session),
) -> dict[str, dict | None]:
    """Медиана, среднее и разброс по последним прогонам — основа таблиц для главы НИР."""
    repo = MeasurementRepository(session)
    return {
        approach: repo.aggregate(experiment_key, approach, window, backend)
        for approach in ("tensorflow_js", "gemini_nano")
    }


@router.get("/export.csv")
def export_csv(
    experiment_key: str | None = None,
    session: Session = Depends(get_session),
) -> Response:
    """Плоская выгрузка прогонов: всех или только одного эксперимента."""
    repo = MeasurementRepository(session)
    total = repo.count(experiment_key=experiment_key)
    rows = repo.list_recent(experiment_key=experiment_key, limit=max(total, 1))

    buffer = io.StringIO()
    writer = csv.writer(buffer, delimiter=";")
    writer.writerow([
        "id", "experiment_key", "experiment_title", "approach", "model_name",
        "run_index", "status", "load_ms", "first_token_ms", "inference_ms",
        "total_ms", "memory_mb", "settings", "environment", "created_at",
    ])
    for row in reversed(rows):
        metrics = row.metrics if isinstance(row.metrics, dict) else {}
        writer.writerow([
            row.id, row.experiment_key, row.experiment_title, row.approach, row.model_name,
            row.run_index, row.status,
            metrics.get("load_ms", ""), metrics.get("first_token_ms", ""),
            metrics.get("inference_ms", ""), metrics.get("total_ms", ""),
            metrics.get("memory_mb", ""),
            row.settings, row.environment, row.created_at.isoformat(),
        ])

    filename = f"measurements_{experiment_key}.csv" if experiment_key else "measurements.csv"
    return Response(
        content="﻿" + buffer.getvalue(),
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
