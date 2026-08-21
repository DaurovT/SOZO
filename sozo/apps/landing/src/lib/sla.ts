import { useI18n } from '../i18n';

/**
 * Срок обратного звонка словами: «10 минут», «4 рабочих часов», «2 рабочих дней».
 *
 * Бэкенд отдаёт `slaMinutes`: 10 (B2C), 240 (B2B), 2880 (кандидат) — одно
 * число на все три формы, потому что порог зависит от типа лида, а не от
 * текста. Единицу выбираем здесь, а форму слова — `tn` по правилам языка.
 */
export function useSla() {
  const { tn } = useI18n();
  return (slaMinutes: number | undefined, fallbackMinutes: number): string => {
    const m = slaMinutes ?? fallbackMinutes;
    if (m < 60) return tn('sla.minutes', m);
    if (m < 60 * 24) return tn('sla.hours', Math.round(m / 60));
    return tn('sla.days', Math.round(m / (60 * 24)));
  };
}
