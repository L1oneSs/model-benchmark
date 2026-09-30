import unittest
from types import SimpleNamespace as Row
from unittest.mock import AsyncMock, Mock

from app.config import Settings
from app.rag.retriever import Retriever, asks_recommendation_table
from app.rag.service import RagService
from app.schemas import RagHistoryTurn

QUESTION = "Что в таблице рекомендаций сказано про скорость обработки текста?"


def recommendation(key, title):
    return Row(rec_key=key, title=title, task_type="text", tfjs_verdict="Контроль ускорителя",
               gemini_verdict="Зависит от длины генерации", comment="Сравнение: text_classification")


class RetrievalTests(unittest.IsolatedAsyncioTestCase):
    def retriever(self):
        retriever = Retriever.__new__(Retriever)
        retriever.recommendations = Row(list_all=Mock(return_value=[
            recommendation("image", "Скорость обработки изображения"),
            recommendation("text", "Скорость обработки текста"),
        ]))
        retriever.documents = Row(list_all=Mock(return_value=[]))
        retriever.embeddings = Row(embed_one=AsyncMock(return_value=[1, 0]))
        return retriever

    async def test_table_reads_live_rows_without_index_or_embedding(self):
        retriever = self.retriever()
        found = await retriever.search(QUESTION, 6, table_only=True)
        self.assertEqual(found[0][1], "text")
        self.assertTrue(all(row[0] == "recommendation" for row in found))
        self.assertIn("Контроль ускорителя", found[0][2])
        retriever.embeddings.embed_one.assert_not_called()
        retriever.documents.list_all.assert_not_called()

    async def test_measurements_cannot_crowd_out_recommendations(self):
        retriever = self.retriever()
        retriever.documents.list_all.return_value = [
            Row(source_type="measurement_summary", source_key=str(i), content="123 ms", embedding=[1, 0])
            for i in range(100)
        ] + [Row(source_type="recommendation", source_key="text", content="Outdated table", embedding=[0.1, 1])]
        found = await retriever.search("Сравни подходы", 6)
        self.assertEqual(len(found), 6)
        self.assertEqual(found[0][0], "recommendation")
        self.assertIn("Контроль ускорителя", found[0][2])
        self.assertNotIn("Outdated", found[0][2])

    async def test_explicit_table_question_excludes_wrong_history(self):
        service = RagService.__new__(RagService)
        service.settings = Settings()
        service.retriever = self.retriever()
        captured = []

        async def chat(prompt, thinking=False, history=None):
            captured.append((prompt, history))
            yield {"text": "Answer"}

        service._chat_stream = chat
        answer = await service.answer(QUESTION, history=[RagHistoryTurn(question="Old", answer="372.1–515.1 ms")])
        self.assertTrue(all(source.source_type == "recommendation" for source in answer.sources))
        self.assertEqual(captured[0][1], [])
        self.assertNotIn("372.1", captured[0][0])
        self.assertIn("ТАБЛИЦА РЕКОМЕНДАЦИЙ", captured[0][0])

    def test_source_intent(self):
        self.assertTrue(asks_recommendation_table(QUESTION))
        self.assertTrue(asks_recommendation_table("Что написано в статичной таблице про память?"))
        self.assertFalse(asks_recommendation_table("Сравни таблицу рекомендаций с измерениями"))
        self.assertFalse(asks_recommendation_table("Какая латентность в последних измерениях?"))


if __name__ == "__main__":
    unittest.main()
