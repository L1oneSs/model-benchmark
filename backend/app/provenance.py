"""Reproducibility metadata. Never record secrets from process environment."""
from datetime import datetime, timezone
from functools import lru_cache
import hashlib
import importlib.metadata
import json
import os
from pathlib import Path
import platform
import sys
import uuid


def canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)


def sha256(value):
    return hashlib.sha256(value.encode('utf-8') if isinstance(value, str) else value).hexdigest()


def file_hash(path):
    return sha256(path.read_bytes()) if path.is_file() else None


@lru_cache(maxsize=1)
def runtime_metadata():
    app_dir = Path(__file__).parent
    requirements = app_dir.parent / 'requirements.txt'
    files = {p.relative_to(app_dir).as_posix(): file_hash(p) for p in sorted(app_dir.rglob('*.py'))}
    versions = {}
    for package in ('fastapi', 'uvicorn', 'sqlalchemy', 'psycopg', 'pydantic', 'numpy', 'scipy', 'matplotlib', 'plotly'):
        try:
            versions[package] = importlib.metadata.version(package)
        except importlib.metadata.PackageNotFoundError:
            versions[package] = None
    installed = dict(sorted((dist.metadata['Name'], dist.version) for dist in importlib.metadata.distributions() if dist.metadata['Name']))
    resource_limits = {}
    for name in ('cpu.max', 'memory.max', 'memory.swap.max', 'pids.max'):
        try:
            resource_limits[name] = Path('/sys/fs/cgroup', name).read_text().strip()
        except OSError:
            resource_limits[name] = None
    return {'code': {'component': 'backend', 'commit': os.getenv('STAND_GIT_COMMIT') or None,
                     'repository': os.getenv('STAND_REPOSITORY') or None,
                     'source_sha256': sha256(canonical(files)), 'files_sha256': files,
                     'source_hash_encoding': 'SHA-256 of canonical JSON object path -> file_sha256',
                     'requirements_sha256': file_hash(requirements)},
            'environment': {'python': sys.version, 'implementation': platform.python_implementation(),
                            'platform': platform.platform(), 'machine': platform.machine(),
                            'logical_cpus_visible': os.cpu_count(), 'packages': versions,
                            'installed_distributions': installed, 'container_resource_limits': resource_limits,
                            'scope': 'backend process, not the browser host'},
            'limitations': {'browser_cpu_model': 'not exposed by browser',
                           'browser_physical_ram': 'deviceMemory is approximate and capped',
                           'builtin_model_revision': 'not exposed by Chrome API',
                           'model_weights_sha256': 'not measured unless supplied by the adapter'}}


def enrich_metadata(run, received_at):
    client = json.loads(canonical(run.metadata))
    return {**client, 'schema_version': 1,
            'measurement_id': str(uuid.uuid4()),
            'server': runtime_metadata(),
            'experiment': {'key': run.experiment_key, 'title': run.experiment_title},
            'model': {'approach': run.approach, 'name': run.model_name, 'settings': run.settings},
            'result': {'status': run.status, 'error': run.error_message,
                       'output_summary_sha256': sha256(run.output_summary),
                       'metrics_sha256': sha256(canonical(run.metrics)),
                       'output_scope': 'adapter output_summary; may be truncated by adapter'},
            'received_at': received_at,
            'integrity': {'client_metadata_sha256': sha256(canonical(client)),
                          'algorithm': 'SHA-256', 'json_encoding': 'UTF-8, sorted keys, compact separators'}}


def export_metadata(row):
    """Expose retained legacy facts without attributing today's code to an old run."""
    retained = getattr(row, 'provenance', None)
    if isinstance(retained, dict) and retained:
        return retained
    metrics, settings, environment = row.metrics or {}, row.settings or {}, row.environment or {}
    return {
        'schema_version': 1,
        'capture_status': 'legacy_partial',
        'source': 'existing measurement columns; detailed metadata was not captured at execution time',
        'database_id': row.id,
        'created_at': row.created_at.isoformat(),
        'experiment': {'key': row.experiment_key, 'title': row.experiment_title},
        'model': {'approach': row.approach, 'name': row.model_name, 'settings': settings},
        'parameters': settings,
        'browser': environment,
        'data': {'input_summary': row.input_summary, 'text': None, 'sha256': None,
                 'unavailable_reason': 'only input summary was saved, not the exact input'},
        'result': {'status': row.status, 'error': row.error_message, 'metrics': metrics,
                   'output_summary': row.output_summary,
                   'output_summary_sha256': sha256(row.output_summary),
                   'metrics_sha256': sha256(canonical(metrics)),
                   'output_scope': 'saved adapter output_summary; may be truncated'},
        'code': None,
        'missing_fields': ['code revision and dependency versions at execution time',
                           'exact input and its SHA-256', 'execution snapshots and resource timings',
                           'full model request and untruncated output'],
    }
