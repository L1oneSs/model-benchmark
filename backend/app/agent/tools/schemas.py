from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class EmptyArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")


class RecommendationArgs(EmptyArgs):
    rec_key: str | None = Field(default=None, max_length=100)


class MeasurementArgs(EmptyArgs):
    experiment_key: str = Field(min_length=1, max_length=100)
    approach: Literal["tensorflow_js", "gemini_nano"] | None = None
    backend: str | None = Field(default=None, max_length=30)
    model_name: str | None = Field(default=None, max_length=200)
    run_index: int | None = Field(default=None, ge=1)
    limit: int = Field(default=20, ge=1, le=50)


class StatisticsArgs(MeasurementArgs):
    limit: int = Field(default=100, ge=1, le=500)


class ExplanationArgs(StatisticsArgs):
    metric: Literal['inference_ms', 'first_token_ms', 'load_ms', 'total_ms', 'memory_mb'] = 'inference_ms'
    statistic: Literal['median', 'mean'] = 'median'
    measurement_ids: list[int] | None = Field(default=None, max_length=500)


class CompareArgs(StatisticsArgs):
    first_run: int | None = Field(default=None, ge=1)
    second_run: int | None = Field(default=None, ge=1)


class ChartArgs(StatisticsArgs):
    kind: Literal["bar", "line", "scatter"] = "bar"
    renderer: Literal["html", "python_static", "python_interactive"] = "html"
    statistic: Literal["median", "mean"] = "median"
    metric: Literal["inference_ms", "first_token_ms", "load_ms", "total_ms", "memory_mb", "all"] = "inference_ms"
