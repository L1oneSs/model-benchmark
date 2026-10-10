"""Схемы запросов и ответов. Фронтенд отправляет результаты замеров ровно в этом виде."""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field

Approach = Literal["tensorflow_js", "gemini_nano"]
RunStatus = Literal["ok", "error", "unsupported"]


class MeasurementIn(BaseModel):
    """Один прогон одного подхода. Метрики снимает браузер, сервер их только принимает."""

    experiment_key: str
    experiment_title: str
    approach: Approach
    model_name: str
    settings: dict[str, Any] = Field(default_factory=dict)
    metrics: dict[str, float] = Field(default_factory=dict)
    environment: dict[str, Any] = Field(default_factory=dict)
    input_summary: str = ""
    output_summary: str = ""
    status: RunStatus = "ok"
    error_message: str | None = None


class MeasurementBatchIn(BaseModel):
    """Серия прогонов, отправляется одним запросом после завершения эксперимента."""

    runs: list[MeasurementIn] = Field(min_length=1)


class MeasurementOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    experiment_key: str
    experiment_title: str
    approach: Approach
    model_name: str
    settings: dict[str, Any]
    metrics: dict[str, float]
    environment: dict[str, Any]
    input_summary: str
    output_summary: str
    status: RunStatus
    error_message: str | None
    run_index: int
    created_at: datetime


class MeasurementPage(BaseModel):
    total: int
    items: list[MeasurementOut]


class RecommendationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    rec_key: str
    title: str
    task_type: str
    tfjs_verdict: str
    gemini_verdict: str
    comment: str
    sort_order: int
    updated_at: datetime


class RecommendationPatch(BaseModel):
    title: str | None = None
    task_type: str | None = None
    tfjs_verdict: str | None = None
    gemini_verdict: str | None = None
    comment: str | None = None
    sort_order: int | None = None


class AgentHistoryTurn(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    answer: str = Field(min_length=1, max_length=6000)
    sources: list[AgentSource] = Field(default_factory=list)


class AgentQuery(BaseModel):
    question: str = Field(min_length=1, max_length=2000)
    thinking: bool = False


class AgentSource(BaseModel):
    source_type: str
    source_key: str
    content: str
    score: float


class ChartPoint(BaseModel):
    label: str = Field(max_length=500)
    value: float = Field(allow_inf_nan=False)
    samples: int = Field(ge=1)


class AgentChart(BaseModel):
    kind: Literal["bar"] = "bar"
    renderer: Literal["html", "python_static", "python_interactive"] = "html"
    statistic: Literal["median", "mean"] = "median"
    artifact_url: str | None = Field(default=None, pattern=r"^/api/agent/charts/[a-f0-9]{32}\.(png|html)$")
    title: str = Field(max_length=300)
    metric: Literal["inference_ms", "first_token_ms", "load_ms", "total_ms", "memory_mb"]
    unit: Literal["мс", "МБ"]
    points: list[ChartPoint] = Field(max_length=500)


class AgentAnswer(BaseModel):
    answer: str
    thinking: str = ""
    sources: list[AgentSource]
    model: str
    charts: list[AgentChart] = Field(default_factory=list, max_length=8)


class AgentStoredTurn(AgentAnswer):
    question: str = Field(min_length=1, max_length=2000)


class AgentHistoryImport(BaseModel):
    turns: list[AgentStoredTurn] = Field(max_length=30)
