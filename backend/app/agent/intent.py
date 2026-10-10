"""Source selection policies independent of retrieval or embeddings."""
import re

def chart_request(question: str) -> bool:
    return bool(re.search(r"график|диаграмм|\bchart\b|\bplot\b", question, re.I))

def all_metrics_request(question: str) -> bool:
    return bool(re.search(r"(?:все|всем|всех)\b.{0,60}метрик|метрик.{0,60}\b(?:все|всем|всех)\b|\ball\b.{0,40}\bmetrics\b", question, re.I))

def asks_recommendation_table(question: str) -> bool:
    text = question.lower()
    table = bool(re.search(r"таблиц\w*.*рекомендац|рекомендац\w*.*таблиц|статич\w*.*таблиц", text))
    return table and not asks_recommendations_with_measurements(question)


def asks_recommendations_with_measurements(question: str) -> bool:
    text = question.lower()
    return bool(re.search(r"рекомендац|таблиц", text) and re.search(r"измерен|замер|прогон", text))
