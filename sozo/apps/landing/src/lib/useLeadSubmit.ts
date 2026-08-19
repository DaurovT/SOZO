import { useCallback, useRef, useState } from 'react';
import { submitLead, type LeadInput, type LeadPayload, type LeadResponse } from '../api';
import { getUtm } from './utm';

function fakeTicket(): string {
  let out = '';
  for (let i = 0; i < 8; i += 1) out += Math.floor(Math.random() * 16).toString(16);
  return out.toUpperCase();
}

/**
 * Общая отправка лида для всех трёх форм:
 *  - honeypot заполнен → тихий «успех» без обращения к сети;
 *  - повторный сабмит блокируется, пока летит запрос (guard + disabled на кнопке);
 *  - UTM-метки первого касания подмешиваются автоматически.
 */
export function useLeadSubmit() {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LeadResponse | null>(null);
  const inFlight = useRef(false);

  const submit = useCallback(async (payload: LeadInput, honeypot: string) => {
    if (inFlight.current) return;

    if (honeypot.trim() !== '') {
      // Бот: показываем тот же экран успеха, лид не создаём.
      setResult({ accepted: true, ticket: fakeTicket() });
      return;
    }

    inFlight.current = true;
    setPending(true);
    setError(null);
    try {
      const utm = getUtm();
      const res = await submitLead({ ...payload, ...(utm ? { utm } : {}) } as LeadPayload);
      setResult(res);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Не удалось отправить заявку. Попробуйте ещё раз.');
    } finally {
      inFlight.current = false;
      setPending(false);
    }
  }, []);

  return { pending, error, result, submit };
}
