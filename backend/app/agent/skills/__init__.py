"""Runtime instructions shipped with the agent, not Codex workspace skills."""
from functools import lru_cache
from pathlib import Path

DIRECTORY = Path(__file__).parent
SKILLS = {
    "read_recommendations": "recommendations",
    "read_measurements": "measurements",
    "calculate_statistics": "measurements",
    'explain_statistic': 'measurements',
    "compare_series": "comparisons",
    "build_chart": "charts",
}

@lru_cache
def read_skill(name: str) -> str:
    if name not in {"core", "answer", *SKILLS.values()}:
        raise ValueError("Unknown agent skill")
    return (DIRECTORY / (name + ".md")).read_text(encoding="utf-8")

def planning_instructions(tool_names) -> str:
    names = sorted({SKILLS[name] for name in tool_names if name in SKILLS})
    return planning_skill('core') + "\n\n" + "\n\n".join(planning_skill(name) for name in names)


def planning_skill(name: str) -> str:
    """Load the mandatory protocol; keep templates/examples out of the small model context."""
    text = read_skill(name)
    start, end = '<!-- runtime:start -->', '<!-- runtime:end -->'
    if start not in text or end not in text:
        return text
    heading = next(line for line in text.splitlines() if line.startswith('# '))
    return heading + '\n\n' + text.split(start, 1)[1].split(end, 1)[0].strip()
