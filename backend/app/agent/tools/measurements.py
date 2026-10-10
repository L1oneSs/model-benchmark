from sqlalchemy import select, desc, func
from app.db.models import Measurement

class MeasurementTools:
    def rows(self, args, *, series=None, successful=False):
        query = select(Measurement).where(Measurement.experiment_key == args.experiment_key)
        for field in ("approach", "model_name"):
            if getattr(args, field) is not None:
                query = query.where(getattr(Measurement, field) == getattr(args, field))
        if args.backend is not None:
            query = query.where(Measurement.settings["backend"].as_string() == args.backend)
        if series is not None or args.run_index is not None:
            query = query.where(Measurement.run_index == (series if series is not None else args.run_index))
        if successful:
            query = query.where(Measurement.status == "ok")
        if getattr(args, 'measurement_ids', None) is not None:
            query = query.where(Measurement.id.in_(args.measurement_ids))
        query = query.order_by(desc(Measurement.created_at), desc(Measurement.id))
        rows = list(self.session.scalars(query.limit(args.limit + 1)))
        return rows[:args.limit], len(rows) > args.limit

    def list_experiments(self, args):
        rows = self.session.execute(select(Measurement.experiment_key, Measurement.experiment_title,
            func.count()).group_by(Measurement.experiment_key, Measurement.experiment_title))
        return {"experiments": [{"key": key, "title": title, "records": count} for key, title, count in rows]}

    def read_measurements(self, args):
        rows, truncated = self.rows(args)
        return {"experiment": args.experiment_key, "truncated": truncated, "measurements": [
            {"id": r.id, "series": r.run_index, "approach": r.approach, "model": r.model_name,
             "backend": r.settings.get("backend"), "metrics": r.metrics, "status": r.status,
             "error": r.error_message, "output": r.output_summary[:300], "created_at": r.created_at.isoformat()}
            for r in rows]}
