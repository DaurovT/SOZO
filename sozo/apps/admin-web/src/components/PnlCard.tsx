import { formatSoums } from '../format';
import type { AnalyticsPnl } from '../types';

/**
 * F-007 — P&L построчно: выручка работ минус прямые расходы даёт валовую прибыль,
 * минус резервный фонд и амортизация — операционную. Суммы приходят в тийинах.
 * Один и тот же расчёт на дашборде (компактно) и в «Аналитике» (крупно).
 */
export function PnlCard({ pnl, large = false }: { pnl: AnalyticsPnl; large?: boolean }) {
  const lines: { label: string; tiyin: number; hint?: string }[] = [
    { label: 'Выручка работ', tiyin: pnl.revenueTiyin },
    { label: 'минус Доли мастеров', tiyin: pnl.masterShareTiyin },
    { label: 'минус Комиссии провайдеров', tiyin: pnl.providerFeesTiyin },
  ];

  const afterGross: { label: string; tiyin: number; hint?: string }[] = [
    { label: 'минус Резервный фонд', tiyin: pnl.reserveFundTiyin },
    {
      label: 'минус Амортизация',
      tiyin: pnl.depreciationTiyin,
      hint: pnl.depreciationTiyin === 0 ? 'фаза 2' : undefined,
    },
  ];

  return (
    <div className="card">
      <div className={large ? 'pnl pnl--lg' : 'pnl'}>
        {lines.map((l) => (
          <Row key={l.label} {...l} />
        ))}
        <Total
          label="Валовая прибыль"
          tiyin={pnl.grossTiyin}
          marginPercent={pnl.grossMarginPercent}
        />
        {afterGross.map((l) => (
          <Row key={l.label} {...l} />
        ))}
        <Total
          label="Операционная прибыль"
          tiyin={pnl.operatingTiyin}
          marginPercent={pnl.operatingMarginPercent}
        />
      </div>
      <div className="card-note">{pnl.note}</div>
    </div>
  );
}

function Row({ label, tiyin, hint }: { label: string; tiyin: number; hint?: string }) {
  return (
    <div className="pnl__row">
      <span className="pnl__label">
        {label}
        {hint !== undefined && <span className="pnl__hint">{hint}</span>}
      </span>
      <span className={tiyin < 0 ? 'pnl__value neg' : 'pnl__value'}>{formatSoums(tiyin)}</span>
    </div>
  );
}

function Total({
  label,
  tiyin,
  marginPercent,
}: {
  label: string;
  tiyin: number;
  marginPercent: number;
}) {
  return (
    <div className="pnl__row pnl__row--total">
      <span className="pnl__label">{label}</span>
      <span className={tiyin < 0 ? 'pnl__value neg' : 'pnl__value'}>
        {formatSoums(tiyin)}
        <span className={marginPercent < 0 ? 'pnl__margin neg' : 'pnl__margin'}>
          маржа {marginPercent} %
        </span>
      </span>
    </div>
  );
}
