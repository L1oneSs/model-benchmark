export const MAX_FACES = 20;

export function parseFaceCount(answer: string): number {
  const cleaned = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  if (!/^\d+$/.test(cleaned)) throw new Error('Gemini Nano должен вернуть только целое количество лиц');
  const count = Number(cleaned);
  if (!Number.isSafeInteger(count) || count > MAX_FACES) throw new Error(`Количество лиц должно быть от 0 до ${MAX_FACES}`);
  return count;
}
