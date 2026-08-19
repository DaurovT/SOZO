export type BarVariant = 'accent' | 'success' | 'warning' | 'error';

/** Полоса-бар: доля от максимума. Ширина в процентах, цвет — токен палитры. */
export function Bar({ percent, variant = 'accent' }: { percent: number; variant?: BarVariant }) {
  const width = Math.max(0, Math.min(100, percent));
  return (
    <span className="bar">
      <span className={`bar__fill bar__fill--${variant}`} style={{ width: `${width}%` }} />
    </span>
  );
}

/** Строка диаграммы: подпись, полоса, значение справа (NPS F-008, типы жалоб). */
export function BarRow({
  label,
  percent,
  value,
  variant,
}: {
  label: string;
  percent: number;
  value: string;
  variant?: BarVariant;
}) {
  return (
    <div className="bar-row">
      <span className="bar-row__label">{label}</span>
      <Bar percent={percent} variant={variant} />
      <span className="bar-row__value">{value}</span>
    </div>
  );
}
