import { useEffect, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums, plural } from '../format';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { ObjectTypeRate } from '../types';

interface CalcRow {
  key: number;
  rateId: string;
  areaM2: number;
}

/** Округление абонентки до 100 000 сум вверх (для красоты КП). */
function roundUpTiyin(tiyin: number): number {
  return Math.ceil(tiyin / 10_000_000) * 10_000_000;
}

/** A-08: калькулятор абонентки для КП (ТЗ 17.2). Без записи на бэкенд. */
export function CalculatorPage() {
  const toast = useToast();
  const { data, loading, error } = useFetch<ObjectTypeRate[]>(() =>
    api.get<ObjectTypeRate[]>('/admin/registry/object-type-rates'),
  );
  const [rows, setRows] = useState<CalcRow[]>([]);
  const [nextKey, setNextKey] = useState(1);

  const rates = data ?? [];

  // Первая строка — как только загрузился справочник
  useEffect(() => {
    if (rates.length > 0 && rows.length === 0) {
      setRows([{ key: 0, rateId: rates[0].id, areaM2: rates[0].typicalAreaM2 }]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rates.length]);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const rateById = (id: string): ObjectTypeRate | undefined => rates.find((r) => r.id === id);

  const lineTotal = (row: CalcRow): number => {
    const rate = rateById(row.rateId);
    return rate ? Math.round(rate.ratePerM2Tiyin * row.areaM2) : 0;
  };

  const rawTotal = rows.reduce((s, r) => s + lineTotal(r), 0);
  const subscription = rawTotal > 0 ? roundUpTiyin(rawTotal) : 0;
  // Разовая цена: абонентка без НДС × 1.3 (те же работы разовыми +30%)
  const oneOff = Math.round((subscription / 1.17) * 1.3);
  const benefit = oneOff - subscription;
  const benefitPercent = oneOff > 0 ? Math.round((benefit / oneOff) * 100) : 0;

  const addRow = () => {
    if (rates.length === 0) return;
    setRows((prev) => [
      ...prev,
      { key: nextKey, rateId: rates[0].id, areaM2: rates[0].typicalAreaM2 },
    ]);
    setNextKey((k) => k + 1);
  };

  const removeRow = (key: number) => {
    setRows((prev) => prev.filter((r) => r.key !== key));
  };

  const changeType = (key: number, rateId: string) => {
    const rate = rateById(rateId);
    setRows((prev) =>
      prev.map((r) =>
        r.key === key ? { ...r, rateId, areaM2: rate?.typicalAreaM2 ?? r.areaM2 } : r,
      ),
    );
  };

  const changeArea = (key: number, areaM2: number) => {
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, areaM2 } : r)));
  };

  const copyForProposal = async () => {
    const lines = rows.map((r) => {
      const rate = rateById(r.rateId);
      return `— ${rate?.objectType ?? '?'}, ${r.areaM2} м²: ${formatSoums(lineTotal(r))}/мес`;
    });
    const text = [
      `Расчёт абонентского обслуживания (${plural(rows.length, 'точка', 'точки', 'точек')}):`,
      ...lines,
      '',
      `Абонентка/мес: ${formatSoums(subscription)}`,
      `Те же работы разовыми (+30%): ${formatSoums(oneOff)}`,
      `Выгода клиента: ${formatSoums(benefit)} (${benefitPercent}%)`,
      '',
      'Ориентировочно. Точный расчёт — после аудита объекта.',
    ].join('\n');
    try {
      await navigator.clipboard.writeText(text);
      toast('Расчёт скопирован для КП');
    } catch {
      toast('Не удалось скопировать — разрешите доступ к буферу обмена');
    }
  };

  return (
    <>
      <div className="page-header">
        <h1>Калькулятор абонентки</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={copyForProposal}
          disabled={rows.length === 0 || subscription === 0}
        >
          Скопировать расчёт для КП
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Тип объекта</th>
              <th className="num">Ставка, сум за м²</th>
              <th className="num">Площадь, м²</th>
              <th className="num">За точку/мес</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="muted">
                  Добавьте первую точку
                </td>
              </tr>
            )}
            {rows.map((row) => {
              const rate = rateById(row.rateId);
              return (
                <tr key={row.key}>
                  <td>
                    <select
                      className="cell-select"
                      value={row.rateId}
                      onChange={(e) => changeType(row.key, e.target.value)}
                    >
                      {rates.map((r) => (
                        <option key={r.id} value={r.id}>
                          {r.objectType}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="num">{rate ? formatSoums(rate.ratePerM2Tiyin) : '—'}</td>
                  <td className="num">
                    <input
                      className="cell-input"
                      type="number"
                      min={1}
                      value={row.areaM2}
                      onChange={(e) => changeArea(row.key, Number(e.target.value))}
                    />
                  </td>
                  <td className="num semibold">{formatSoums(lineTotal(row))}</td>
                  <td className="num">
                    <button
                      type="button"
                      className="btn btn--link"
                      onClick={() => removeRow(row.key)}
                    >
                      Удалить
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div style={{ marginTop: 'var(--s12)' }}>
        <button type="button" className="btn" onClick={addRow}>
          + точка
        </button>
      </div>

      <div className="tiles" style={{ marginTop: 'var(--s16)' }}>
        <div className="card">
          <div className="tile__value tile__value--sm">{formatSoums(subscription)}</div>
          <div className="tile__label">Абонентка/мес</div>
          <div className="tile__hint">округление до 100 000 сум вверх</div>
        </div>
        <div className="card">
          <div className="tile__value tile__value--sm">{formatSoums(oneOff)}</div>
          <div className="tile__label">Те же работы разовыми (+30%)</div>
        </div>
        <div className="card">
          <div className="tile__value tile__value--sm">
            {formatSoums(benefit)} ({benefitPercent}%)
          </div>
          <div className="tile__label">Выгода клиента</div>
        </div>
      </div>

      <p className="muted" style={{ fontSize: 12 }}>
        Ставки — справочник «Ставки м²»; калькулятор для КП (ТЗ 17.2), договор фиксируется в
        карточке организации.
      </p>
    </>
  );
}
