import tempfile
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from pydantic import ValidationError
from app.agent.chart_rendering import render_artifact, requested_chart_options
from app.agent.tools.charts import ChartTools
from app.agent.tools.schemas import ChartArgs
from app.schemas import AgentChart


class ChartKindTests(unittest.TestCase):
    def test_supported_kinds_preserve_values_and_validate_for_client(self):
        tool = ChartTools()
        tool.calculate_statistics = Mock(return_value={'groups':[
            {'model':'Test model', 'backend':'cpu', 'metrics':{'inference_ms':{'median':12.5,'mean':13,'samples':5}}}
        ], 'truncated':False})
        for kind in ['bar','line','scatter']:
            with self.subTest(kind=kind), patch('app.agent.tools.charts.render_artifact', return_value=None):
                chart = tool.build_chart(ChartArgs(experiment_key='text',kind=kind))['chart']
                self.assertEqual(AgentChart.model_validate(chart).kind,kind)
                self.assertEqual(chart['points'][0]['value'],12.5)
                self.assertEqual(chart['points'][0]['samples'],5)

    def test_explicit_echarts_kind_survives_request_parsing(self):
        options=requested_chart_options('Построй линейный график среднего инференса через ECharts')
        self.assertEqual(options['renderer'],'html')
        self.assertEqual(options['kind'],'line')
        self.assertEqual(options['statistic'],'mean')
        self.assertEqual(options['metric'],'inference_ms')

    def test_unsupported_distribution_is_rejected_for_aggregate_chart(self):
        with self.assertRaises(ValidationError):
            ChartArgs(experiment_key='text',kind='histogram')

    def test_python_exports_accept_all_supported_kinds(self):
        with tempfile.TemporaryDirectory() as directory, patch('app.agent.chart_rendering.DIRECTORY',Path(directory)):
            for renderer in ['python_static','python_interactive']:
                for kind in ['bar','line','scatter']:
                    with self.subTest(renderer=renderer,kind=kind):
                        url=render_artifact({'kind':kind,'renderer':renderer,'title':'Test','metric':'inference_ms','unit':'мс',
                            'points':[{'label':'CPU','value':-1,'samples':5},{'label':'WASM','value':2,'samples':5}]})
                        file=Path(directory)/url.rsplit('/',1)[-1]
                        self.assertGreater(file.stat().st_size,100)
