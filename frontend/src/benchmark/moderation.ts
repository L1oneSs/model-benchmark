export const MODERATION_LABELS: Record<string, string> = {
  identity_attack: 'Дискриминация', insult: 'Оскорбления', obscene: 'Ненормативная лексика',
  severe_toxicity: 'Сильная токсичность', sexual_explicit: 'Сексуальный контент', threat: 'Угрозы', toxicity: 'Токсичность',
};
export const MODERATION_THRESHOLD = 0.75;

export function parseModerationReply(answer: string): Record<string, boolean> {
  const cleaned = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const value: unknown = JSON.parse(cleaned);
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Некорректный ответ модерации');
  const flags: Record<string, boolean> = {};
  for (const [key, flag] of Object.entries(value)) {
    const label = key === 'toxic' ? 'toxicity' : key;
    if (!(label in MODERATION_LABELS)) continue;
    if (typeof flag !== 'boolean') throw new Error('Категории модерации должны содержать true или false');
    flags[label] = flag;
  }
  if (!Object.keys(flags).length) throw new Error('В ответе нет категорий модерации');
  return flags;
}

export function formatModerationFlags(flags: Record<string, boolean>): string {
  const detected = Object.keys(MODERATION_LABELS).filter(key => flags[key]);
  return detected.length ? `Выявлено: ${detected.map(key => MODERATION_LABELS[key]).join(', ')}` : 'Нарушения не отмечены';
}

export function formatModerationScores(scores: Record<string, number>, matched: string[], threshold = MODERATION_THRESHOLD): string {
  const flagged = matched.filter(key => key in MODERATION_LABELS);
  const status = flagged.length
    ? `Выявлено: ${flagged.map(key => MODERATION_LABELS[key]).join(', ')}`
    : `Порог ${Math.round(threshold * 100)}% не достигнут`;
  const significant = Object.entries(scores).filter(([key, score]) => key in MODERATION_LABELS && score >= 0.05)
    .sort((a, b) => b[1] - a[1]).slice(0, 3);
  return status + (significant.length ? ` · ${significant.map(([key, score]) =>
    `${MODERATION_LABELS[key]}: ${(score * 100).toLocaleString('ru-RU', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`).join(' · ')}` : '');
}

export function formatSavedModeration(summary: string): string {
  if (/^(?:```|\{)/.test(summary.trim())) {
    try { return formatModerationFlags(parseModerationReply(summary)); }
    catch { return 'Некорректный ответ модерации — повторите измерение'; }
  }
  if (!/^(?:not flagged|flagged:)/i.test(summary)) return summary;
  const scores: Record<string, number> = {};
  for (const match of summary.matchAll(/([a-z_]+):\s*([\d.]+)%/g)) scores[match[1]] = Number(match[2]) / 100;
  const matched = summary.match(/^flagged:\s*(.*?)(?:\s*[?·]|$)/i)?.[1].split(',').map(label => label.trim()) ?? [];
  return formatModerationScores(scores, matched);
}
