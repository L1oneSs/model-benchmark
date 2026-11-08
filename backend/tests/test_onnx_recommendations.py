from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock, patch
import unittest
import httpx

from app.main import app
from app.db.database import get_session
from app.db.repositories import RecommendationRepository
from app.agent.tools import AgentTools


def recommendation():
    return SimpleNamespace(id=1,rec_key='privacy',title='Privacy',task_type='privacy',
        tfjs_verdict='TFJS',onnx_verdict='ONNX is local',gemini_verdict='Chrome',comment='Comment',
        sort_order=1,updated_at=datetime.now(timezone.utc))


class OnnxRecommendationTests(unittest.TestCase):
    def test_agent_reads_onnx_together_with_existing_columns(self):
        session=Mock()
        session.scalar.return_value=recommendation()
        result=AgentTools(session).execute('read_recommendations',{'rec_key':'privacy'})
        self.assertEqual(result['recommendations'][0]['onnx'],'ONNX is local')
        self.assertEqual(result['recommendations'][0]['tensorflow_js'],'TFJS')
        self.assertEqual(result['recommendations'][0]['gemini_nano'],'Chrome')

class OnnxRecommendationApiTests(unittest.IsolatedAsyncioTestCase):
    async def test_column_is_returned_and_patchable(self):
        row=recommendation()
        app.dependency_overrides[get_session]=lambda:Mock()
        try:
            with patch.object(RecommendationRepository,'list_all',return_value=[row]), \
                 patch.object(RecommendationRepository,'update',return_value=row) as update:
                async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
                    result=await client.get('/api/recommendations')
                    self.assertEqual(result.status_code,200)
                    self.assertEqual(result.json()[0]['onnx_verdict'],'ONNX is local')
                    response=await client.patch('/api/recommendations/privacy',json={'onnx_verdict':'Updated ONNX'})
                    self.assertEqual(response.status_code,200)
                    update.assert_called_once_with('privacy',{'onnx_verdict':'Updated ONNX'})
        finally:
            app.dependency_overrides.pop(get_session,None)
