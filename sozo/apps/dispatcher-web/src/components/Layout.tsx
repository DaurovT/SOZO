import { useEffect, useState } from 'react';
import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../api';
import { clearSession, getToken, getUser } from '../auth';
import type { ClientRequest, ComplaintsResponse, Dispute, ReplacementDetect } from '../types';
import { SozoLogo, SozoMark } from './Logo';

/** Счётчики незакрытых хвостов в меню обновляются раз в 30 секунд. */
const OPS_POLL_MS = 30_000;

/** Подписи к счётчикам — что именно накопилось у пункта меню. */
const COUNTER_TITLES: Record<string, string> = {
  '/replacements': 'активных протоколов замены',
  '/client-requests': 'обращений клиентов без ответа',
  '/complaints': 'открытых жалоб',
  '/disputes': 'открытых споров',
};

const MENU: { section: string; links: { to: string; label: string }[] }[] = [
  { section: 'Обзор', links: [{ to: '/dashboard', label: 'Дашборд' }] },
  {
    section: 'Заявки',
    links: [
      { to: '/kanban', label: 'Kanban-доска' },
      { to: '/orders/new', label: 'Новая заявка (телефон)' },
      { to: '/archive', label: 'Архив' },
    ],
  },
  {
    section: 'Планирование',
    links: [
      { to: '/lanes', label: 'Ленты мастеров' },
      { to: '/capacity', label: 'Ёмкость дня' },
    ],
  },
  {
    section: 'Операции',
    links: [
      { to: '/map', label: 'Карта города' },
      { to: '/replacements', label: 'Замены' },
      { to: '/client-requests', label: 'Обращения клиентов' },
      { to: '/incidents', label: 'Инциденты' },
      { to: '/permits', label: 'Наряды-допуски' },
      { to: '/handover', label: 'Передача смены' },
      { to: '/kpi', label: 'KPI смены' },
    ],
  },
  {
    section: 'Качество',
    links: [
      { to: '/complaints', label: 'Жалобы' },
      { to: '/disputes', label: 'Споры' },
    ],
  },
];

export function Layout() {
  const navigate = useNavigate();
  const user = getUser();
  const [counters, setCounters] = useState<Record<string, number>>({});

  // Незакрытые протоколы, жалобы и споры не должны теряться, пока диспетчер на другом экране.
  useEffect(() => {
    let alive = true;
    const put = (to: string, count: number) => {
      if (alive) setCounters((prev) => ({ ...prev, [to]: count }));
    };
    const load = () => {
      if (!getToken()) return;
      // Счётчики в меню не должны ломать навигацию — ошибки глушим по одному запросу.
      api
        .get<ReplacementDetect>('/dispatch/ops/replacements/detect')
        .then((d) => put('/replacements', d.active.length))
        .catch(() => undefined);
      api
        .get<ClientRequest[]>('/dispatch/ops/client-requests')
        .then((d) => put('/client-requests', d.length))
        .catch(() => undefined);
      api
        .get<ComplaintsResponse>('/dispatch/quality/complaints')
        .then((d) => put('/complaints', d.stats.open))
        .catch(() => undefined);
      api
        .get<Dispute[]>('/dispatch/quality/disputes')
        .then((d) => put('/disputes', d.filter((x) => x.status !== 'resolved').length))
        .catch(() => undefined);
    };
    load();
    const timer = window.setInterval(load, OPS_POLL_MS);
    return () => {
      alive = false;
      window.clearInterval(timer);
    };
  }, []);

  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }

  const logout = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  const counter = (to: string): number => counters[to] ?? 0;

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__logo">
          <SozoMark size={26} />
          <SozoLogo height={17} title="SOZO" />
          <span className="sidebar__logo-suffix">Диспетчерская</span>
        </div>
        <nav className="sidebar__nav">
          {MENU.map((group) => (
            <div key={group.section}>
              <div className="sidebar__section">{group.section}</div>
              {group.links.map((link) => {
                const count = counter(link.to);
                return (
                  <NavLink
                    key={link.to}
                    to={link.to}
                    className={({ isActive }) =>
                      [
                        'sidebar__link',
                        isActive ? 'active' : null,
                        count > 0 ? 'sidebar__link--counted' : null,
                      ]
                        .filter((c) => c !== null)
                        .join(' ')
                    }
                  >
                    {link.label}
                    {count > 0 && (
                      <span className="badge badge--error" title={COUNTER_TITLES[link.to]}>
                        {count}
                      </span>
                    )}
                  </NavLink>
                );
              })}
            </div>
          ))}
        </nav>
        <div className="sidebar__footer">
          <div className="sidebar__user">{user?.fullName ?? user?.phone ?? '—'}</div>
          <button type="button" className="btn btn--link" onClick={logout}>
            Выйти
          </button>
        </div>
      </aside>
      <main className="content">
        <Outlet />
      </main>
    </div>
  );
}
