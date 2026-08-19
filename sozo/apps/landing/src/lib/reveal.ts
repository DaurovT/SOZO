import { useEffect } from 'react';

/**
 * Появление блоков при скролле.
 *
 * Один IntersectionObserver на страницу вместо обработчика scroll: браузер сам
 * считает пересечения, главный поток свободен. Элемент помечается атрибутом
 * `data-reveal`, класс `.is-in` включает переход из styles.css.
 *
 * Уважает prefers-reduced-motion: там CSS сразу показывает всё, наблюдение не нужно.
 */
export function useReveal(deps: unknown[] = []): void {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const nodes = Array.from(document.querySelectorAll<HTMLElement>('[data-reveal]:not(.is-in)'));
    if (reduced || !('IntersectionObserver' in window)) {
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
      { rootMargin: '0px 0px -12% 0px', threshold: 0.08 },
    );

    nodes.forEach((n) => io.observe(n));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/** Ступенчатая задержка появления для элементов списка. */
export function revealDelay(index: number, step = 70, max = 320): React.CSSProperties {
  return { ['--reveal-delay' as string]: `${Math.min(index * step, max)}ms` };
}
