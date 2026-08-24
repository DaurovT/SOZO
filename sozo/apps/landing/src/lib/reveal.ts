import { useEffect } from 'react';

/**
 * Появление блоков при скролле.
 *
 * **Текст виден всегда, анимация — украшение.** Раньше было наоборот:
 * `[data-reveal]` прятался в CSS, а показывал его скрипт. Стоило наблюдателю
 * не сработать — и секция навсегда оставалась пустым белым прямоугольником,
 * в котором виден только тот элемент, которому забыли поставить `data-reveal`.
 * На узком экране, где секции складываются в длинные колонки, так и выходило.
 *
 * Поэтому прятать разрешено только после того, как скрипт подтвердил, что
 * умеет показать обратно: класс `js-reveal` на `<html>` ставит `main.tsx` до
 * первого рендера, а правило `opacity: 0` в styles.css написано под этот
 * класс. Нет скрипта, упал бандл, старый браузер — страница показывается
 * целиком.
 *
 * Уважает prefers-reduced-motion: там наблюдение не нужно вовсе.
 */

/** Через сколько показать всё, что наблюдатель так и не показал */
const SAFETY_MS = 2500;

export function useReveal(deps: unknown[] = []): void {
  useEffect(() => {
    const root = document.documentElement;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)'));

    if (reduced || !('IntersectionObserver' in window)) {
      root.classList.remove('js-reveal');
      nodes.forEach((n) => n.classList.add('is-in'));
      return;
    }

    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add('is-in');
          io.unobserve(entry.target); // анимация одноразовая — не дёргаем при обратном скролле
        }
      },
      // threshold 0, а не доля площади: секция на узком экране бывает выше
      // экрана в разы, и требование «видно 8% блока» она может не выполнить
      // никогда — блок так и останется невидимым
      { rootMargin: '0px 0px -10% 0px', threshold: 0 },
    );

    nodes.forEach((n) => io.observe(n));

    // Страховка. Что бы ни случилось с наблюдателем — через SAFETY_MS
    // непоказанное показывается. Пустой страницы у посетителя быть не может
    const safety = window.setTimeout(() => {
      for (const n of nodes) n.classList.add('is-in');
      io.disconnect();
    }, SAFETY_MS);

    return () => {
      window.clearTimeout(safety);
      io.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Ступенчатая задержка появления для элементов списка. */
export function revealDelay(index: number, step = 70, max = 320): React.CSSProperties {
  return { ['--reveal-delay' as string]: `${Math.min(index * step, max)}ms` };
}
