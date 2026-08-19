import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { downloadCsv } from '../csv';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';

/**
 * QR-бейджи мастеров.
 *
 * Код на бейдже клиент сверяет на пороге — так он понимает, что перед ним
 * тот, кого прислали, а не случайный человек. Код есть у каждого мастера
 * с момента заведения карточки и показывается в его приложении; здесь
 * не хватало только списка для печати.
 *
 * Сам QR не рисуем: печать и выдача бейджей — вне системы, а картинка,
 * которую нельзя напечатать нормальным тиражом, только создаёт иллюзию.
 */

interface Badge {
  masterId: string;
  fullName: string;
  phone: string;
  status: string;
  grade: string;
  qrBadgeCode: string;
  skillTags: string[];
}

const GRADE: Record<string, string> = { gold: 'Золото', silver: 'Серебро', bronze: 'Бронза' };

export function BadgesPage() {
  const [q, setQ] = useState('');
  const { data, loading, error } = useFetch<{ badges: Badge[]; note: string }>(
    () => api.get('/admin/master-ops/badges'),
    [],
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const needle = q.trim().toLowerCase();
  const rows = needle
    ? data.badges.filter((b) => `${b.fullName} ${b.phone} ${b.qrBadgeCode}`.toLowerCase().includes(needle))
    : data.badges;

  return (
    <>
      <div className="page-header">
        <h1>QR-бейджи мастеров</h1>
        <button
          type="button"
          className="btn"
          disabled={rows.length === 0}
          onClick={() =>
            downloadCsv(
              'badges.csv',
              ['ФИО', 'Телефон', 'Код бейджа', 'Грейд', 'Навыки'],
              rows.map((b) => [b.fullName, b.phone, b.qrBadgeCode, GRADE[b.grade] ?? b.grade, b.skillTags.join(', ')]),
            )
          }
        >
          Скачать для печати
        </button>
      </div>

      <div className="banner">{data.note}</div>

      <div className="form-grid">
        <div className="field">
          <label htmlFor="badge-q">Поиск</label>
          <input
            id="badge-q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="фамилия, телефон или код бейджа"
          />
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Мастер</th>
              <th>Телефон</th>
              <th>Код бейджа</th>
              <th>Грейд</th>
              <th>Навыки</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && <EmptyRow colSpan={5} />}
            {rows.map((b) => (
              <tr key={b.masterId}>
                <td>
                  <Link to={`/masters/${b.masterId}`}>{b.fullName}</Link>
                  {b.status !== 'active' && <div className="muted">{b.status}</div>}
                </td>
                <td className="mono">{b.phone}</td>
                <td className="mono">{b.qrBadgeCode}</td>
                <td>{GRADE[b.grade] ?? b.grade}</td>
                <td className="muted">{b.skillTags.join(', ')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
