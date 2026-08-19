import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { downloadCsv } from '../csv';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * Технический долг точек.
 *
 * Дефекты, которые нашли на осмотре и не устранили: заказчик отклонил или
 * не ответил в срок. Клиент видит долг по своей точке, а платформа не видела
 * его вовсе — при том, что это одновременно накопленный риск аварии и самая
 * очевидная воронка продаж, какая у сервисной компании бывает.
 *
 * Продавать отсюда нельзя и не нужно: решение по дефекту принимает заказчик,
 * а этот экран — повод для разговора, а не кнопка «выставить счёт».
 */

interface DebtItem {
  id: string;
  actNumber: string;
  category: string;
  description: string;
  severity: 'low' | 'medium' | 'high';
  estimateTiyin: number | null;
  declineReason: string | null;
  reason: string;
  days: number;
}

interface DebtLocation {
  locationId: string;
  locationName: string;
  organizationId: string;
  items: DebtItem[];
  totalTiyin: number;
  oldestDays: number;
}

interface DebtData {
  locations: DebtLocation[];
  totalTiyin: number;
  itemsTotal: number;
  staleLocations: number;
}

const SEVERITY: Record<string, { label: string; cls: string }> = {
  high: { label: 'Критичный', cls: 'badge badge--error' },
  medium: { label: 'Средний', cls: 'badge badge--warning' },
  low: { label: 'Низкий', cls: 'badge badge--muted' },
};

export function TechDebtPage() {
  const [openId, setOpenId] = useState<string | null>(null);
  const { data, loading, error } = useFetch<DebtData>(() => api.get<DebtData>('/admin/acts/debt'), []);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const rows = data.locations;
  const open = rows.find((r) => r.locationId === openId) ?? null;

  return (
    <>
      <div className="page-header">
        <h1>Технический долг точек</h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--s16)' }}>
          <span className="num total">{formatSoums(data.totalTiyin)}</span>
          <button
            type="button"
            className="btn"
            disabled={rows.length === 0}
            onClick={() =>
              downloadCsv(
                'tech-debt.csv',
                ['Точка', 'Акт', 'Категория', 'Дефект', 'Важность', 'Оценка', 'Причина', 'Дней'],
                rows.flatMap((r) =>
                  r.items.map((i) => [
                    r.locationName,
                    i.actNumber,
                    i.category,
                    i.description,
                    SEVERITY[i.severity]?.label ?? i.severity,
                    i.estimateTiyin === null ? '' : String(Math.round(i.estimateTiyin / 100)),
                    i.reason,
                    String(i.days),
                  ]),
                ),
              )
            }
          >
            Скачать CSV
          </button>
        </div>
      </div>

      <div className="banner">
        Сюда попадает то, что заказчик отклонил или на что не ответил в срок. Решение по дефекту
        принимает он же — это повод для разговора, а не для счёта
      </div>

      <div className="tiles">
        <div className="card">
          <div className="tile__value">{data.itemsTotal}</div>
          <div className="tile__label">неустранённых дефектов</div>
        </div>
        <div className={data.staleLocations > 0 ? 'card card--warning' : 'card'}>
          <div className="tile__value">{data.staleLocations}</div>
          <div className="tile__label">точек с долгом старше 60 дней</div>
        </div>
        <div className="card">
          <div className="tile__value tile__value--sm">{formatSoums(data.totalTiyin)}</div>
          <div className="tile__label">оценка устранения</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Точка</th>
              <th className="num">Дефектов</th>
              <th className="num">Оценка</th>
              <th className="num">Старший</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5} />}
            {rows.map((r) => (
              <tr key={r.locationId} className={r.oldestDays >= 60 ? 'row--warning' : undefined}>
                <td>
                  {r.locationName}
                  <div className="muted">
                    <Link to={`/organizations/${r.organizationId}`}>карточка организации</Link>
                  </div>
                </td>
                <td className="num">{r.items.length}</td>
                <td className="num">{formatSoums(r.totalTiyin)}</td>
                <td className="num">{r.oldestDays} дн.</td>
                <td>
                  <button
                    type="button"
                    className="btn btn--secondary"
                    onClick={() => setOpenId(openId === r.locationId ? null : r.locationId)}
                  >
                    {openId === r.locationId ? 'Свернуть' : 'Дефекты'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {open && (
        <>
          <div className="section-title">Дефекты точки {open.locationName}</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Акт</th>
                  <th>Категория</th>
                  <th>Что нашли</th>
                  <th>Важность</th>
                  <th className="num">Оценка</th>
                  <th>Почему в долге</th>
                  <th className="num">Дней</th>
                </tr>
              </thead>
              <tbody>
                {open.items.map((i) => (
                  <tr key={i.id}>
                    <td className="mono">{i.actNumber}</td>
                    <td>{i.category}</td>
                    <td>{i.description}</td>
                    <td>
                      <span className={SEVERITY[i.severity]?.cls ?? 'badge'}>
                        {SEVERITY[i.severity]?.label ?? i.severity}
                      </span>
                    </td>
                    <td className="num">
                      {i.estimateTiyin === null ? <span className="muted">считает офис</span> : formatSoums(i.estimateTiyin)}
                    </td>
                    <td>
                      {i.reason}
                      {i.declineReason !== null && <div className="muted">{i.declineReason}</div>}
                    </td>
                    <td className="num">{i.days}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
