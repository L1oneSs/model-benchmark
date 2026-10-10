import math
import statistics
from sqlalchemy import select, desc
from app.db.models import Measurement

def summarize(rows):
    groups = {}
    for row in rows:
        key = (row.approach, row.model_name, row.settings.get("backend"))
        groups.setdefault(key, []).append(row)
    result = []
    for (approach, model, backend), group in groups.items():
        metrics = {}
        for name in ("load_ms", "first_token_ms", "inference_ms", "total_ms", "memory_mb"):
            values = [float(r.metrics[name]) for r in group if isinstance(r.metrics.get(name), (int, float))
                      and not isinstance(r.metrics[name], bool) and math.isfinite(r.metrics[name])]
            if values:
                metrics[name] = {"median": round(statistics.median(values), 3),
                                 "mean": round(statistics.fmean(values), 3),
                                 "stdev": round(statistics.stdev(values), 3) if len(values) > 1 else 0,
                                 "samples": len(values)}
        result.append({"approach": approach, "model": model, "backend": backend,
                       "runs": len(group), "metrics": metrics})
    return result



class StatisticsTools:
    def explain_statistic(self, args):
        rows, truncated = self.rows(args, successful=True)
        groups = []
        for summary in summarize(rows):
            observations = []
            for row in rows:
                if (row.approach, row.model_name, row.settings.get('backend')) != (summary['approach'], summary['model'], summary['backend']):
                    continue
                value = row.metrics.get(args.metric)
                if isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value):
                    observations.append({'id': row.id, 'series': row.run_index, 'value': value})
            if observations:
                observations.sort(key=lambda item: (item['value'], item['id']))
                groups.append({**summary, 'observations': observations,
                               'value': summary['metrics'][args.metric][args.statistic]})
        return {'experiment': args.experiment_key, 'metric': args.metric, 'statistic': args.statistic,
                'groups': groups, 'truncated': truncated, 'selection_restored': args.measurement_ids is not None,
                'requested_measurement_ids': args.measurement_ids,
                'filters': {name: getattr(args, name) for name in ('approach', 'backend', 'model_name', 'run_index')},
                'formula': 'Sort x; odd n: x[(n+1)/2]; even n: (x[n/2]+x[n/2+1])/2 (1-based)' if args.statistic == 'median' else 'sum(x)/n'}

    def compare_series(self, args):
        if args.run_index is not None:
            return {"error": "Use first_run and second_run, not run_index, for comparison."}
        indices = list(self.session.scalars(select(Measurement.run_index).where(
            Measurement.experiment_key == args.experiment_key).distinct().order_by(desc(Measurement.run_index)).limit(2)))
        first = args.first_run if args.first_run is not None else (indices[1] if len(indices) > 1 else None)
        second = args.second_run if args.second_run is not None else (indices[0] if indices else None)
        if first is None or second is None or first == second:
            return {"first_run": first, "second_run": second, "first": [], "second": [], "changes": [],
                "available_series": indices, "truncated": False,
                "note": "Need two different recorded series to compare. Run another series or specify two different existing series."}
        left, cut_left = self.rows(args, series=first, successful=True)
        right, cut_right = self.rows(args, series=second, successful=True)
        old, new = summarize(left), summarize(right)
        changes = []
        for item in new:
            match = next((r for r in old if all(r[k] == item[k] for k in ("approach", "model", "backend"))), None)
            if match and "inference_ms" in item["metrics"] and "inference_ms" in match["metrics"]:
                before = match["metrics"]["inference_ms"]["median"]
                after = item["metrics"]["inference_ms"]["median"]
                changes.append({"approach": item["approach"], "model": item["model"], "backend": item["backend"],
                "inference_before_ms": before, "inference_after_ms": after,
                "first_samples": match["metrics"]["inference_ms"]["samples"],
                "second_samples": item["metrics"]["inference_ms"]["samples"],
                "delta_ms": round(after - before, 3),
                "delta_percent": round((after - before) / before * 100, 2) if before else None})
        return {"first_run": first, "second_run": second, "first": old, "second": new,
                "changes": changes, "truncated": cut_left or cut_right,
                "note": "Positive latency delta means slower. Only matching model/backend groups are compared."}

    def calculate_statistics(self, args):
        rows, truncated = self.rows(args, successful=True)
        return {"experiment": args.experiment_key, "run_index": args.run_index, "groups": summarize(rows), "truncated": truncated,
                'measurement_ids': [r.id for r in rows if hasattr(r, 'id')],
                'filters': {name: getattr(args, name) for name in ('approach', 'backend', 'model_name', 'run_index')},
                "experiment_title": getattr(rows[0], "experiment_title", args.experiment_key) if rows else args.experiment_key,
                "limit": args.limit, "units": "Times: ms; memory: JS heap MB, not total model memory."}
