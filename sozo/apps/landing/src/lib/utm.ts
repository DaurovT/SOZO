import type { Utm } from '../api';

const KEY = 'sozo.utm';
const FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'] as const;

/**
 * Метки первого касания: снимаем из URL при заходе и держим в sessionStorage,
 * чтобы дожили до отправки формы на другой странице.
 */
export function captureUtm(search: string): void {
  const params = new URLSearchParams(search);
  const found: Utm = {};
  for (const f of FIELDS) {
    const v = params.get(f);
    if (v) found[f] = v.slice(0, 200);
  }
  if (Object.keys(found).length === 0) return;
  try {
    sessionStorage.setItem(KEY, JSON.stringify(found));
  } catch {
    /* приватный режим — метки просто не сохранятся */
  }
}

export function getUtm(): Utm | undefined {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as Utm;
    return Object.keys(parsed).length > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}
