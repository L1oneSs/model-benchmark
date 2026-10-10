import unittest
from types import SimpleNamespace as Row
from app.config import Settings
from app.agent.intent import asks_recommendation_table
from app.agent.service import AgentService
from app.schemas import AgentHistoryTurn, AgentSource

QUESTION = "Что в таблице рекомендаций сказано про скорость обработки текста?"


class IntentTests(unittest.IsolatedAsyncioTestCase):
    async def test_explicit_table_question_excludes_wrong_history(self):
        service = AgentService.__new__(AgentService)
        service.settings = Settings()
        async def collect(question, history):
            yield {"type": "context", "sources": [AgentSource(source_type="recommendation",
                source_key="read_recommendations:1", content="Контроль ускорителя", score=1)]}
        service.planner = Row(collect=collect)
        captured = []

        async def chat(prompt, thinking=False, history=None):
            captured.append((prompt, history))
            yield {"text": "Answer"}

        service._chat_stream = chat
        answer = await service.answer(QUESTION, history=[AgentHistoryTurn(question="Old", answer="372.1–515.1 ms")])
        self.assertTrue(all(source.source_type == "recommendation" for source in answer.sources))
        self.assertEqual(captured[0][1], [])
        self.assertNotIn("372.1", captured[0][0])
        self.assertIn("read_recommendations", captured[0][0])

    def test_source_intent(self):
        self.assertFalse(asks_recommendation_table("А теперь дай мне рекомендации по выбору парадигмы для скорости обработки текста, основываясь на таблице рекомендаций и последних измерениях"))
        self.assertTrue(asks_recommendation_table(QUESTION))
        self.assertTrue(asks_recommendation_table("Что написано в статичной таблице про память?"))
        self.assertFalse(asks_recommendation_table("Сравни таблицу рекомендаций с измерениями"))
        self.assertFalse(asks_recommendation_table("Какая латентность в последних измерениях?"))


if __name__ == "__main__":
    unittest.main()
