"""Validated chart data and trusted optional Python renderers."""
from app.agent.chart_rendering import render_artifact
class ChartTools:
    def build_chart(self, args):
        data = self.calculate_statistics(args)
        metrics = ["inference_ms", "first_token_ms", "load_ms", "total_ms", "memory_mb"] if args.metric == "all" else [args.metric]
        charts = []
        missing = []
        for metric in metrics:
            points = []
            for group in data["groups"]:
                value = group["metrics"].get(metric)
                if value is None:
                    continue
                points.append({"label": f"{group['model']} · {group['backend'] or 'встроенный API'}",
                               "value": value[args.statistic], "samples": value["samples"]})
            chart = {"kind": "bar", "title": f"{data.get('experiment_title', args.experiment_key)} · медиана",
                     "metric": metric, "unit": "МБ" if metric == "memory_mb" else "мс", "points": points}
            if points or args.metric != "all":
                chart['renderer'] = args.renderer
                chart['statistic'] = args.statistic
                if args.statistic == 'mean':
                    chart['title'] = chart['title'].replace('медиана', 'среднее')
                chart['artifact_url'] = render_artifact(chart)
                charts.append(chart)
            if not points:
                missing.append(metric)
        result = {"experiment": args.experiment_key, "experiment_title": data.get("experiment_title", args.experiment_key), "metric": args.metric,
                "truncated": data["truncated"], "limit": args.limit,
                "charts": charts, "missing_metrics": missing}
        if args.metric != "all":
            result["chart"] = charts[0]
        return result
