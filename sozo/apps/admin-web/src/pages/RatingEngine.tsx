import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * Рейтинг мастеров: кто, сколько и почему.
 *
 * Формула работала с самого начала и показывалась самому мастеру, а в админке
 * на её месте стоял макет с подписью «фаза 2». Здесь тот же расчёт — по окну
 * 56 дней, по тем же пяти составляющим.
 *
 * Сортируем по возрастанию: экран открывают, чтобы найти тех, у кого плохо,
 * а не полюбоваться отличниками.
 */

interface Component {
  code: string;
  title: string;
  weight: number;
  value: number;
  note?: string;
}

interface RatingRow {
  masterId: string;
  fullName: string;
  status: string;
  score: number;
  grade: 'bronze' | 'silver' | 'gold';
  storedRating: number;
  storedGrade: string;
  drifted: boolean;
  components: Component[];
}

const GRADE: Record<string, { label: string; cls: string }> = {
  gold: { label: 'Золото', cls: 'badge badge--accent' },
  silver: { label: 'Серебро', cls: 'badge badge--muted' },
  bronze: { label: 'Бронза', cls: 'badge badge--muted' },
};

export function RatingEnginePage() {
  const { data, loading, error } = useFetch<{
    masters: RatingRow[];
    definitions: Array<{ code: string; title: string; weight: number }>;
    drifted: number;
    note: string;
  }>(() => api.get('/admin/dashboard/rating'), []);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const components = data.definitions ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Рейтинг мастеров</h1>
        <span className="muted">{data.note}</span>
      </div>

      <div className="banner">
        Составляющие и веса:{' '}
        {components.map((c) => `${c.title} — ${c.weight}%`).join(', ')}
      </div>

      {data.drifted > 0 && (
        <div className="banner banner--warning">
          У {data.drifted} мастеров сохранённый грейд отличается от расчётного: карточка
          обновляется, когда мастер сам открывает свой рейтинг. От грейда зависит доля —
          расхождение стоит денег
        </div>
      )}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Мастер</th>
              <th className="num">Расчёт</th>
              <th>Грейд</th>
              <th className="num">В карточке</th>
              {components.map((c) => (
                <th key={c.code} className="num" title={`${c.title}, вес ${c.weight}%`}>
                  {c.title}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.masters.length === 0 && <EmptyRow colSpan={4 + components.length} />}
            {data.masters.map((m) => (
              <tr key={m.masterId} className={m.score < 60 ? 'row--warning' : undefined}>
                <td>
                  <Link to={`/masters/${m.masterId}`}>{m.fullName}</Link>
                  {m.status !== 'active' && <div className="muted">{m.status}</div>}
                </td>
                <td className="num">{m.score}</td>
                <td>
                  <span className={GRADE[m.grade]?.cls ?? 'badge'}>{GRADE[m.grade]?.label ?? m.grade}</span>
                </td>
                <td className="num">
                  {m.storedRating}
                  {m.drifted && <div className="muted">разошлось</div>}
                </td>
                {components.map((c) => {
                  const v = m.components.find((x) => x.code === c.code);
                  return (
                    <td key={c.code} className="num" title={v?.note}>
                      {v === undefined ? '—' : Math.round(v.value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
