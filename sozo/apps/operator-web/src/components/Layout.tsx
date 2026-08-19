import { NavLink, useNavigate } from 'react-router-dom';
import { clearSession, getUser } from '../auth';

const NAV = [
  { to: '/', label: 'Дашборд', end: true },
  { to: '/permits', label: 'Наряды-допуски' },
  { to: '/first-refusal', label: 'Первая рука' },
  { to: '/observations', label: 'Замечания' },
  { to: '/shutdowns', label: 'Отключения' },
  { to: '/finance', label: 'Финансы' },
  { to: '/settings', label: 'Настройки объекта' },
];

export function Layout({ children, plan }: { children: React.ReactNode; plan?: string }) {
  const nav = useNavigate();
  const user = getUser();

  return (
    <div style={{ display: 'flex', minHeight: '100vh' }}>
      <div className="sidebar" style={{ padding: 'var(--s16)', display: 'flex', flexDirection: 'column', gap: 'var(--s24)' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Кабинет эксплуатации</div>
          <div className="cap">{user?.fullName ?? user?.phone ?? ''}</div>
        </div>

        <nav style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s4)' }}>
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) => `sidebar__item${isActive ? ' sidebar__item--active' : ''}`}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>

        {/* Тариф показываем всегда: от него зависит, начисляется ли сервисный сбор */}
        <div className="card" style={{ marginTop: 'auto', padding: 'var(--s12)', background: 'var(--bg)', borderStyle: 'dashed' }}>
          <div className="cap" style={{ color: 'var(--text)', fontWeight: 600 }}>
            Тариф: {plan === 'free' || !plan ? 'Доступ' : 'Подписка'}
          </div>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            {plan === 'free' || !plan
              ? 'Подключение бесплатно. Вы получаете 5% с частных заявок жителей.'
              : 'Вы платите подписку. Заявки мастерам платформы сбор не приносят.'}
          </div>
        </div>

        <button
          className="btn btn--secondary"
          onClick={() => {
            clearSession();
            nav('/');
            window.location.reload();
          }}
        >
          Выйти
        </button>
      </div>

      <div style={{ flexGrow: 1, padding: 'var(--s24)', display: 'flex', flexDirection: 'column', gap: 'var(--s24)' }}>
        {children}
      </div>
    </div>
  );
}
