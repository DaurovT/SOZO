import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { api } from '../api';
import { formatDateTime, formatSoums } from '../format';
import { useFetch } from '../useFetch';

/**
 * D-07. Очередь проверки фото и чеков.
 *
 * Гейты приложения проверяют, что снимок есть, а не что на нём. Это
 * единственный контроль качества, который без человека не работает, — и до
 * сих пор его никто не делал, потому что очереди не существовало.
 *
 * Две вещи выделены отдельно, и обе про деньги: запчасть без чека по ТЗ 8.4
 * не принимается вовсе, а отметка диспетчера с телефона — не фотография, и
 * закрывать по ней оплату нельзя.
 */

interface ReviewRow {
  id: string;
  number: string;
  status: string;
  masterName: string | null;
  address: string;
  totalMaterialTiyin: number;
  photosAfter: number;
  photosAfterWithFile: number;
  receipts: number;
  partsWithoutReceipt: number;
  geoMissing: boolean;
  completedAt: string | null;
}

interface Review {
  total: number;
  needsAttention: number;
  rows: ReviewRow[];
}

export function PhotoReview() {
  const { data, loading, error } = useFetch<Review>(() => api.get('/dispatch/ops/photo-review'));

  if (loading) return <Loading />;
  if (error) return <ErrorBanner message={error} />;

  return (
    <>
      <div className="page-header">
        <h1>Проверка фото и чеков</h1>
      </div>

      <div className="banner">
        Гейты приложения проверяют, что снимок есть, а не что на нём. Это единственный контроль
        качества, который без человека не работает. Запчасть без чека по ТЗ 8.4 не принимается,
        а отметка диспетчера с телефона — не фотография: закрывать по ней оплату нельзя.
      </div>

      <div className="banner">{data?.total ?? 0} заявок ждут проверки</div>

      {(data?.needsAttention ?? 0) > 0 && (
        <div className="banner banner--warning">
          Требуют внимания: {data!.needsAttention} — там нечего смотреть или нет чека
        </div>
      )}

      <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Заявка</th>
            <th>Мастер</th>
            <th>Фото «после»</th>
            <th>Чеки</th>
            <th>Материалы</th>
            <th>Выполнена</th>
          </tr>
        </thead>
        <tbody>
          {(data?.rows.length ?? 0) === 0 && <EmptyRow colSpan={6} />}
          {(data?.rows ?? []).map((r) => (
            <tr key={r.id}>
              <td>
                <strong>{r.number}</strong>
                <div className="muted">{r.address}</div>
              </td>
              <td>{r.masterName ?? '—'}</td>
              <td>
                {r.photosAfterWithFile === 0 ? (
                  <span className="tone--error">
                    {r.photosAfter > 0 ? 'только отметка диспетчера' : 'нет'}
                  </span>
                ) : (
                  <span>{r.photosAfterWithFile} шт.</span>
                )}
                {r.geoMissing && <div className="muted">без геометки</div>}
              </td>
              <td>{r.receipts || '—'}</td>
              <td>
                {formatSoums(r.totalMaterialTiyin)}
                {r.partsWithoutReceipt > 0 && (
                  <div className="tone--error">запчастей без чека: {r.partsWithoutReceipt}</div>
                )}
              </td>
              <td className="muted">{r.completedAt ? formatDateTime(r.completedAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}
