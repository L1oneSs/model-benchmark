import csv
from datetime import datetime, timezone
import io
import json
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import httpx
from app.main import app
from app.db.database import get_session
from app.db.models import Measurement
from app.db.repositories import MeasurementRepository
from app.schemas import MeasurementIn, MeasurementOut
from app.provenance import enrich_metadata, export_metadata, canonical, sha256
from app.api.measurements import csv_bytes


def measurement():
    return SimpleNamespace(id=7, experiment_key='text', experiment_title='Text', approach='tensorflow_js',
        model_name='Test model', settings={'backend':'wasm'}, metrics={'inference_ms':12.5}, environment={},
        provenance={'schema_version':1,'data':{'text':'Exact text; with "quotes"\nand newline'}},
        run_index=1, status='ok', input_summary='Text', output_summary='positive', error_message=None,
        created_at=datetime(2026,10,30,tzinfo=timezone.utc))


class ProvenanceTests(unittest.TestCase):
    def test_authoritative_fields_and_hashes(self):
        run = MeasurementIn(experiment_key='text', experiment_title='Text', approach='tensorflow_js',
                            model_name='Test', output_summary='positive', metrics={'inference_ms':1.5},
                            metadata={'data':{'text':'hello'},'server':{'code':'fake'}})
        with patch('app.provenance.runtime_metadata', return_value={'code':{'commit':'real'}}):
            result = enrich_metadata(run, '2026-10-30T12:00:00Z')
        self.assertEqual(result['server']['code']['commit'],'real')
        self.assertEqual(result['result']['output_summary_sha256'],sha256('positive'))
        self.assertEqual(result['integrity']['client_metadata_sha256'],sha256(canonical(run.metadata)))
        self.assertEqual(run.metadata['server']['code'],'fake')
        self.assertIn('measurement_id',result)

    def test_orm_reserved_metadata_name_is_mapped_to_json_field(self):
        row = measurement()
        result = MeasurementOut.model_validate(row).model_dump(mode='json')
        self.assertEqual(result['metadata'],row.provenance)
        self.assertNotIn('provenance',result)
        self.assertEqual(Measurement.__table__.c.metadata.name,'metadata')

    def test_csv_preserves_json_and_multiline_input(self):
        data = csv_bytes([measurement()])
        self.assertTrue(data.startswith(b'\xef\xbb\xbf'))
        row = next(csv.DictReader(io.StringIO(data.decode('utf-8-sig')),delimiter=';'))
        self.assertEqual(json.loads(row['metadata']), measurement().provenance)
        self.assertEqual(json.loads(row['settings']), {'backend':'wasm'})

    def test_legacy_csv_includes_retained_facts_without_inventing_missing_history(self):
        row = measurement()
        row.provenance = {}
        row.environment = {'chrome_version': '154.0.0.0', 'measured_at': '2026-10-04T08:11:16Z'}
        with patch('app.provenance.runtime_metadata') as current:
            metadata = export_metadata(row)
            current.assert_not_called()
        self.assertEqual(metadata['capture_status'], 'legacy_partial')
        self.assertEqual(metadata['browser'], row.environment)
        self.assertEqual(metadata['parameters'], row.settings)
        self.assertEqual(metadata['result']['metrics'], row.metrics)
        self.assertIsNone(metadata['data']['text'])
        self.assertIsNone(metadata['data']['sha256'])
        self.assertIsNone(metadata['code'])
        self.assertEqual(row.provenance, {})
        exported = next(csv.DictReader(io.StringIO(csv_bytes([row]).decode('utf-8-sig')), delimiter=';'))
        self.assertEqual(json.loads(exported['metadata']), metadata)
        self.assertEqual(csv_bytes([row]), csv_bytes([row]))


class ProvenanceApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_json_manifest_csv_digest_and_plot_data(self):
        row = measurement()
        app.dependency_overrides[get_session] = lambda: Mock()
        try:
            with patch.object(MeasurementRepository,'count',return_value=1), \
                 patch.object(MeasurementRepository,'list_recent',return_value=[row]), \
                 patch.object(MeasurementRepository,'statistics_rows',return_value=[row]):
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                    exported = (await client.get('/api/measurements/export.json?experiment_key=text')).json()
                    csv_result = await client.get('/api/measurements/export.csv?experiment_key=text')
                    self.assertEqual(exported['outputs']['results_csv_sha256'],sha256(csv_result.content))
                    self.assertEqual(exported['outputs']['measurements_sha256'],sha256(canonical(exported['measurements'])))
                    self.assertEqual(exported['measurements'][0]['metadata'],row.provenance)
                    graph = await client.get('/api/measurements/plot-data?experiment_key=text')
                    self.assertEqual(graph.status_code,200)
                    self.assertEqual(graph.json()['observations'][0]['id'],7)
                    self.assertNotIn('metadata',graph.json()['observations'][0])
        finally:
            app.dependency_overrides.pop(get_session,None)

    async def test_create_saves_metadata_and_keeps_legacy_inputs_valid(self):
        row = measurement()
        app.dependency_overrides[get_session] = lambda: Mock()
        try:
            with patch.object(MeasurementRepository,'next_run_index',return_value=1), \
                 patch.object(MeasurementRepository,'add_many',return_value=[row]) as save:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                    payload = {'runs':[{'experiment_key':'text','experiment_title':'Text', 'approach':'tensorflow_js',
                                      'model_name':'Test','metadata':{'data':{'text':'Exact input'}}}]}
                    response = await client.post('/api/measurements',json=payload)
                    self.assertEqual(response.status_code,201)
                    self.assertEqual(save.call_args.args[0][0].provenance['data']['text'],'Exact input')
                    del payload['runs'][0]['metadata']
                    self.assertEqual((await client.post('/api/measurements',json=payload)).status_code,201)
        finally:
            app.dependency_overrides.pop(get_session,None)
