"""Статичная таблица рекомендаций: чтение и точечная правка вердиктов
по итогам прогонов."""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db.database import get_session
from app.db.repositories import RecommendationRepository
from app.schemas import RecommendationOut, RecommendationPatch

router = APIRouter(prefix="/api/recommendations", tags=["recommendations"])


@router.get("", response_model=list[RecommendationOut])
def list_recommendations(session: Session = Depends(get_session)):
    return RecommendationRepository(session).list_all()


@router.patch("/{rec_key}", response_model=RecommendationOut)
def patch_recommendation(
    rec_key: str,
    patch: RecommendationPatch,
    session: Session = Depends(get_session),
):
    row = RecommendationRepository(session).update(rec_key, patch.model_dump(exclude_unset=True))
    if row is None:
        raise HTTPException(status_code=404, detail=f"Рекомендация {rec_key} не найдена")
    return row
