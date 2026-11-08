"""Render numerical tool results without asking an LLM to reinterpret arithmetic."""
import json
import re

METRICS = {
    "inference_ms": ("Инференс", "мс", r"инференс|inference|латент"),
    "first_token_ms": ("Первое предсказание", "мс", r"перв|first"),
    "load_ms": ("Загрузка модели", "мс", r"загруз|load"),
    "total_ms": ("Полное время", "мс", r"полно|total"),
    "memory_mb": ("Память JS heap", "МБ", r"памят|memory"),
}


def number(value):
    return f"{value:,.3f}".rstrip("0").rstrip(".").replace(",", " ").replace(".", ",")


def render_numeric_answer(question, sources):
    explanations = [(i, json.loads(s.content)) for i, s in enumerate(sources, 1)
                    if s.source_key.startswith('explain_statistic:')]
    if explanations:
        lines = []
        for index, data in explanations:
            if data.get('error'):
                lines.append(data['error'])
                continue
            label, unit, _ = METRICS[data['metric']]
            if not data['groups']:
                lines.append(f"Не удалось восстановить исходные замеры для {data['experiment']} и указанных фильтров. Это не подтверждает отсутствие измерений во всём эксперименте. [{index}]")
            for group in data['groups']:
                observations = group['observations']
                n = len(observations)
                values = '; '.join(number(item['value']) for item in observations)
                if data['statistic'] == 'mean':
                    formula = f"Среднее = сумма значений / n = {number(sum(item['value'] for item in observations))} / {n}"
                elif n % 2:
                    formula = f"Медиана при нечётном n — значение на позиции (n + 1) / 2 = {n // 2 + 1} в отсортированном списке"
                else:
                    formula = f"Медиана при чётном n = (x[n/2] + x[n/2 + 1]) / 2 = ({number(observations[n//2-1]['value'])} + {number(observations[n//2]['value'])}) / 2"
                rows = '; '.join(f"ID {item['id']}, серия {item['series']}: {number(item['value'])} {unit}" for item in observations)
                lines.append(f"{group['model']} · {group['backend'] or 'встроенный API'} — {label}:\n"
                             f"Отсортированные значения: {values} {unit}; n={n}.\n{formula}. Результат: {number(group['value'])} {unit}.\n"
                             f"Исходные измерения: {rows}. Только успешные прогоны. [{index}]")
            if not data.get('selection_restored'):
                lines.append('В старом ответе не сохранены ID исходной выборки: расчёт проверен по текущим записям, точное совпадение прежней выборки не гарантируется.')
            if data.get('truncated'):
                lines.append('Выборка ограничена: часть прогонов не вошла в расчёт.')
        return '\n\n'.join(lines)
    chart_sources = [(i, json.loads(s.content)) for i, s in enumerate(sources, 1)
                     if s.source_key.startswith("build_chart:")]
    if chart_sources:
        lines = []
        for index, data in chart_sources:
            charts = data.get("charts", [data["chart"]] if "chart" in data else [])
            names = [METRICS[chart["metric"]][0].lower() for chart in charts if chart["points"]]
            title = data.get("experiment_title", data["experiment"])
            statistic = 'средних' if charts and charts[0].get('statistic') == 'mean' else 'медиан'
            lines.append(f"Графики {statistic} для «{title}»: {', '.join(names)}. [{index}]"
                         if names else f"Нет успешных измерений выбранных метрик для «{title}». [{index}]")
            missing = data.get("missing_metrics", [])
            if missing:
                lines.append("Нет измерений: " + ", ".join(METRICS[metric][0].lower() for metric in missing) + ".")
            if data.get("truncated"):
                lines.append("Выборка ограничена: часть прогонов не вошла в расчёт.")
        return "\n\n".join(lines)
    text = question.lower()
    if re.search(r"рекомендац|таблиц", text):
        return None
    comparison = bool(re.search(r"сравн|сопостав|compare", text) and re.search(r"сери|series", text))
    stats = bool(re.search(r"медиан|статист|median|statistics|клифф|cliff|p[-_ ]?value|p95|iqr|значим|величин.{0,8}эффект|доверительн", text))
    if not comparison and not stats:
        return None
    tool = "compare_series" if comparison else "calculate_statistics"
    entries = [(i, json.loads(s.content)) for i, s in enumerate(sources, 1)
               if s.source_key.startswith(tool + ":")]
    if not entries:
        return None
    lines = []
    seen = set()
    for index, data in entries:
        if comparison:
            first, second = data["first_run"], data["second_run"]
            if first is None or second is None or first == second:
                lines.append(f"Для сравнения нужны две разные записанные серии. Доступные серии: "
                             f"{', '.join(map(str, data.get('available_series', []))) or 'нет'}. [{index}]")
                continue
            if not data["changes"]:
                lines.append(f"В сериях {first} и {second} нет сопоставимых групп одной модели и бэкенда. [{index}]")
            for change in data["changes"]:
                key = (first, second, change["model"], change["backend"], change["inference_before_ms"], change["inference_after_ms"])
                if key in seen:
                    continue
                seen.add(key)
                delta = change["delta_ms"]
                direction = "латентность выросла" if delta > 0 else "латентность снизилась" if delta < 0 else "латентность не изменилась"
                percent = change["delta_percent"]
                relative = f" ({'+' if percent > 0 else ''}{number(percent)}%)" if percent is not None else ""
                backend = change["backend"] or "встроенный API"
                lines.append(f"{change['model']} · {backend}:\n"
                    f"Серия {first}: {number(change['inference_before_ms'])} мс → серия {second}: "
                    f"{number(change['inference_after_ms'])} мс.\n"
                    f"Разница: {'+' if delta > 0 else ''}{number(delta)} мс{relative}; {direction}. "
                    f"Прогонов: {change['first_samples']} → {change['second_samples']}. [{index}]")
        else:
            chosen = [name for name, (_, _, pattern) in METRICS.items() if re.search(pattern, text)]
            if not chosen:
                chosen = ['inference_ms'] if re.search(r'клифф|cliff|p[-_ ]?value|значим|величин.{0,8}эффект', text) else list(METRICS)
            if not data["groups"]:
                lines.append(f"Нет успешных прогонов для выбранного эксперимента и фильтров. [{index}]")
            for group in data["groups"]:
                backend = group["backend"] or "встроенный API"
                caption = f"{group['model']} · {backend}"
                if data.get("run_index") is not None:
                    caption += f" · серия {data['run_index']}"
                values = []
                for metric in chosen:
                    label, unit, _ = METRICS[metric]
                    value = group["metrics"].get(metric)
                    if value:
                        detail = f"{label}: медиана {number(value['median'])} {unit}, n={value['samples']}"
                        if 'iqr' in value:
                            detail += f", p95 {number(value['p95'])}, IQR {number(value['iqr'])} {unit}"
                        if value.get('ci95') is not None:
                            detail += f", 95% ДИ медианы [{number(value['ci95'][0])}; {number(value['ci95'][1])}] {unit}"
                        values.append(detail)
                    else:
                        values.append(f"{label}: нет измерений")
                lines.append(caption + ":\n" + "; ".join(values) + f". [{index}]")
            for item in data.get('comparisons', []):
                if item['metric'] not in chosen:
                    continue
                a, b = item['a'], item['b']
                label = METRICS[item['metric']][0]
                p = item['p_value']
                p_text = ('< 0,0001' if p < .0001 else f'{p:.4f}') if p is not None else 'недостаточно данных'
                adjusted = item.get('p_value_adjusted')
                correction = f", p с поправкой Холма={adjusted:.4g}" if adjusted is not None else ''
                lines.append(f"{label}: A={a['model']} ({a['backend'] or 'встроенный API'}), "
                             f"B={b['model']} ({b['backend'] or 'встроенный API'}): "
                             f"δ Клиффа={number(item['cliffs_delta'])}, p-value={p_text}{correction}; "
                             f"измерений A/B: {item['n_a']}/{item['n_b']}. [{index}]")
            if data.get('comparisons'):
                lines.append('Сравнения используют отдельные успешные измерения. Манна-Уитни предполагает независимые наблюдения; '
                             'одинаковые входы и условия автоматически не проверяются. Отрицательная δ означает меньшие '
                             'значения у A, а не процент ускорения. Зависимые повторы могут преувеличивать значимость.')
        if data.get("truncated"):
            lines.append("Выборка ограничена: часть прогонов не вошла в расчёт.")
    if any(s.source_key == "step_limit" for s in sources):
        lines.append("Достигнут лимит шагов агента: полученные данные могут не покрывать весь запрос.")
    return "\n\n".join(lines)
