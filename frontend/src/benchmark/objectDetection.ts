/** Общий словарь и формат результата для двух реализаций обнаружения объектов. */
import { formatSavedModeration } from './moderation';
export const COCO_CLASSES = (
  'person, bicycle, car, motorcycle, airplane, bus, train, truck, boat, traffic light, fire hydrant, stop sign, parking meter, bench, ' +
  'bird, cat, dog, horse, sheep, cow, elephant, bear, zebra, giraffe, backpack, umbrella, handbag, tie, suitcase, frisbee, skis, ' +
  'snowboard, sports ball, kite, baseball bat, baseball glove, skateboard, surfboard, tennis racket, bottle, wine glass, cup, fork, ' +
  'knife, spoon, bowl, banana, apple, sandwich, orange, broccoli, carrot, hot dog, pizza, donut, cake, chair, couch, potted plant, ' +
  'bed, dining table, toilet, tv, laptop, mouse, remote, keyboard, cell phone, microwave, oven, toaster, sink, refrigerator, book, ' +
  'clock, vase, scissors, teddy bear, hair drier, toothbrush'
).split(', ');

export function parseObjectCounts(answer: string): Record<string, number> {
  const cleaned = answer.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
  const counts: unknown = JSON.parse(cleaned);
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    throw new Error('Ожидался объект JSON с количеством обнаруженных объектов');
  }
  const positiveCounts: Record<string, number> = {};
  for (const [label, count] of Object.entries(counts)) {
    if (!COCO_CLASSES.includes(label) || typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('Некорректный класс или количество объектов в ответе Gemini Nano');
    }
    if (count > 0) positiveCounts[label] = count;
  }
  return positiveCounts;
}

export function formatObjectCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).filter(([, count]) => count > 0);
  if (!entries.length) return 'Объекты не обнаружены';
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return `Объектов: ${total} · ${entries.map(([label, count]) => `${label}: ${count}`).join(', ')}`;
}

/** Старые записи с сырым JSON тоже показываем компактно, без изменения замеров. */
export function formatExperimentOutput(experimentKey: string, summary: string): string {
  if (experimentKey === 'text_moderation') return formatSavedModeration(summary);
  if (experimentKey === 'face_counting') return summary.match(/^Лиц:\s*\d+/)?.[0] ?? summary;
  if (experimentKey !== 'object_detection' || !/^(?:```|\{)/.test(summary.trim())) return summary;
  try {
    return formatObjectCounts(parseObjectCounts(summary));
  } catch {
    return 'Некорректный JSON в ответе модели — повторите измерение';
  }
}
