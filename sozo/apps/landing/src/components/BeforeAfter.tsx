import { useCallback, useRef, useState } from 'react';

/**
 * Слайдер «до / после»: тянешь ручку — открывается вторая фотография.
 *
 * Позиция живёт в CSS-переменной --ba-pos, поэтому перерисовку делает
 * композитор браузера (clip-path), а React не трогает DOM на каждое движение.
 * Работает мышью, пальцем и стрелками с клавиатуры.
 */
export default function BeforeAfter(props: {
  before: string;
  after: string;
  alt: string;
  labelBefore?: string;
  labelAfter?: string;
}) {
  const { before, after, alt, labelBefore = 'До', labelAfter = 'После' } = props;
  const boxRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState(50);

  const move = useCallback((clientX: number) => {
    const box = boxRef.current;
    if (!box) return;
    const rect = box.getBoundingClientRect();
    const next = ((clientX - rect.left) / rect.width) * 100;
    setPos(Math.min(100, Math.max(0, next)));
  }, []);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    move(e.clientX);
  };

  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.buttons !== 1) return;
    move(e.clientX);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowLeft') setPos((p) => Math.max(0, p - 5));
    if (e.key === 'ArrowRight') setPos((p) => Math.min(100, p + 5));
  };

  return (
    <div
      ref={boxRef}
      className="ba"
      style={{ ['--ba-pos' as string]: `${pos}%` }}
      role="slider"
      tabIndex={0}
      aria-label={`${alt}: сравнение до и после`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(pos)}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onKeyDown={onKeyDown}
    >
      <img src={before} alt={`${alt} — до работы`} loading="lazy" decoding="async" />
      <img
        className="ba-after"
        src={after}
        alt={`${alt} — после работы`}
        loading="lazy"
        decoding="async"
      />
      <span className="ba-label ba-label--before">{labelBefore}</span>
      <span className="ba-label ba-label--after">{labelAfter}</span>
      <div className="ba-handle" aria-hidden="true">
        <span className="ba-knob">⇆</span>
      </div>
    </div>
  );
}
