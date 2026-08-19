import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import type { ObjectTypeRate } from '../types';

/** A-29a: ставки сум/м² по типам объектов. */
export function ObjectRatesPage() {
  const { data, loading, error } = useFetch<ObjectTypeRate[]>(() =>
    api.get<ObjectTypeRate[]>('/admin/registry/object-type-rates'),
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const rates = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Ставки за м²</h1>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Тип объекта</th>
              <th className="num">Ставка, сум за м²</th>
              <th className="num">Типовая площадь, м²</th>
            </tr>
          </thead>
          <tbody>
            {rates.length === 0 && <EmptyRow colSpan={3} />}
            {rates.map((r) => (
              <tr key={r.id}>
                <td>{r.objectType}</td>
                <td className="num">{formatSoums(r.ratePerM2Tiyin)}</td>
                <td className="num">{r.typicalAreaM2}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ fontSize: 12 }}>
        Источник калькулятора абонентки (ТЗ 17.2).
      </p>
    </>
  );
}
