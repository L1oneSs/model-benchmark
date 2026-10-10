"""Verify formula follow-up through API/history with a private temporary chat."""
import sys
sys.path.insert(0, '/srv')
import json
from uuid import uuid4
import httpx
from sqlalchemy.orm import Session
from app.db.database import engine
from app.agent.tools import AgentTools

base = 'http://backend:8000/api/agent'
headers = {'X-Agent-Chat': str(uuid4())}
with Session(engine) as session:
    source = AgentTools(session).execute('calculate_statistics', {'experiment_key': 'text_classification', 'backend': 'webgpu'})
    assert source['groups'], 'Record successful text_classification WebGPU measurements first'
    model = source['groups'][0]['model']
    median = source['groups'][0]['metrics']['inference_ms']['median']
with httpx.Client(timeout=30) as client:
    try:
        result = client.post(base + '/history/import', headers=headers, json={'turns': [{
            'question': 'Median inference text_classification webgpu', 'answer': str(median), 'model': 'fixture',
            'sources': [{'source_type': 'agent_tool', 'source_key': 'calculate_statistics:1', 'content': json.dumps(source), 'score': 1}]}]})
        result.raise_for_status()
        response = client.post(base + '/ask', headers=headers, json={'question':
            '\u041f\u043e \u043a\u0430\u043a\u043e\u0439 \u0444\u043e\u0440\u043c\u0443\u043b\u0435 \u0442\u044b \u043f\u043e\u0441\u0447\u0438\u0442\u0430\u043b \u044d\u0442\u043e\u0442 \u043e\u0442\u0432\u0435\u0442? \u0418 \u043f\u043e \u043a\u0430\u043a\u0438\u043c \u0438\u0437\u043c\u0435\u0440\u0435\u043d\u0438\u044f\u043c?\n' + model + ' webgpu: median ' + str(median)})
        response.raise_for_status()
        answer = response.json()
        data = json.loads(answer['sources'][0]['content'])
        assert data['selection_restored']
        assert data['groups'][0]['value'] == median
        assert set(x['id'] for x in data['groups'][0]['observations']).issubset(source['measurement_ids'])
        assert 'ID ' in answer['answer']
        print(answer['answer'])
        print('Formula follow-up API/history check OK')
    finally:
        client.delete(base + '/history', headers=headers).raise_for_status()
