import { useEffect, useRef, useState } from 'react';

/**
 * Число, которое «докручивается» до значения, когда блок появился на экране.
 * Считаем через requestAnimationFrame, без таймеров и без библиотек.
 */
export default function Counter(props: {
  to: number;
  suffix?: string;
  prefix?: string;
  duration?: number;
  format?: (v: number) => string;
}) {
  const { to, suffix = '', prefix = '', duration = 1100, format } = props;
  const ref = useRef<HTMLSpanElement>(null);
  const [value, setValue] = useState(0);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;

    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced || !('IntersectionObserver' in window)) {
      setValue(to);
      return;
    }

    let raf = 0;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        io.disconnect();
        const start = performance.now();
        const tick = (now: number) => {
          const p = Math.min((now - start) / duration, 1);
          const eased = 1 - Math.pow(1 - p, 3); // ease-out-cubic
          setValue(Math.round(to * eased));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );

    io.observe(node);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [to, duration]);

  return (
    <span ref={ref}>
      {prefix}
      {format ? format(value) : value}
      {suffix}
    </span>
  );
}
