from app.agent.skills import read_skill

SYSTEM_PROMPT = read_skill("answer")

USER_TEMPLATE = """Контекст.

{context}

Вопрос пользователя: {question}"""


def build_user_prompt(context: str, question: str) -> str:
    return USER_TEMPLATE.format(context=context.strip(), question=question.strip())
