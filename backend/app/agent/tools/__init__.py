"""Validated, read-only tool registry. No arbitrary SQL or code execution."""
from pydantic import ValidationError
from .schemas import EmptyArgs, RecommendationArgs, MeasurementArgs, StatisticsArgs, CompareArgs, ChartArgs, ExplanationArgs
from .charts import ChartTools
from .measurements import MeasurementTools
from .recommendations import RecommendationTools
from .statistics import StatisticsTools, summarize

TOOL_TYPES = {
    'explain_statistic': (ExplanationArgs, 'Explain the median/mean formula using actual individual observations, their IDs and series. Preserve the previous calculation selection if measurement_ids are available.'),
    "build_chart": (ChartArgs, "Build grouped median/mean bar charts: HTML in chat, Python static PNG (Matplotlib), or Python interactive HTML (Plotly). Use metric=all for every available metric."),
    "list_experiments": (EmptyArgs, "List experiments recorded in the database, their titles and counts. Use to discover exact experiment keys."),
    "read_recommendations": (RecommendationArgs, "Read the current recommendation table. Omit rec_key to read all criteria. Table verdicts are not measured numbers."),
    "read_measurements": (MeasurementArgs, "Read recent individual runs for an exact experiment, optionally filtering approach, backend, model or series."),
    "calculate_statistics": (StatisticsArgs, "Calculate metrics on recent successful runs, grouped by approach, model and backend. Missing values stay missing."),
    "compare_series": (CompareArgs, "Compare two series of an experiment, defaulting to the latest two. Compute median latency differences for matching approach/model/backend groups."),
}
TOOLS = [{"type": "function", "function": {"name": name, "description": description,
          "parameters": schema.model_json_schema()}} for name, (schema, description) in TOOL_TYPES.items()]


class AgentTools(MeasurementTools, RecommendationTools, StatisticsTools, ChartTools):
    def __init__(self, session):
        self.session = session

    def execute(self, name, arguments):
        if name not in TOOL_TYPES:
            return {"error": "Unknown tool. Use only the provided tools."}
        try:
            args = TOOL_TYPES[name][0].model_validate(arguments)
        except ValidationError as error:
            return {"error": str(error)}
        return getattr(self, name)(args)
