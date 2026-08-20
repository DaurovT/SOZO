import { Navigate, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { clearSession, getToken, getUser } from '../auth';
import { DISPATCHER_URL } from '../orderDicts';
import { SozoLogo, SozoMark } from './Logo';

const MENU: {
  section: string;
  links: { to: string; label: string; end?: boolean; badge?: string }[];
}[] = [
  {
    section: 'Обзор',
    links: [
      { to: '/dashboard', label: 'Дашборд' },
      { to: '/coverage', label: 'Карта проекта' },
      { to: '/map', label: 'Карта' },
      { to: '/orders', label: 'Заявки' },
      { to: '/analytics', label: 'Аналитика' },
    ],
  },
  {
    section: 'Контур «Дом»',
    links: [
      { to: '/buildings', label: 'Подключение объектов' },
      { to: '/operators', label: 'Эксплуатирующие организации' },
      { to: '/operator-billing', label: 'Подписки и расчёты' },
      { to: '/zone-types', label: 'Типы зон и допуски' },
      { to: '/observation-categories', label: 'Категории замечаний' },
    ],
  },
  { section: 'Прайс и экономика', links: [{ to: '/price-releases', label: 'Релизы прайса' }] },
  {
    section: 'Клиенты',
    links: [
      { to: '/organizations', label: 'Организации' },
      { to: '/leads', label: 'B2B-лиды' },
      { to: '/clients', label: 'Клиенты B2C' },
      { to: '/acts', label: 'Акты осмотра' },
      { to: '/representatives', label: 'Доступ к приложению' },
      { to: '/calculator', label: 'Калькулятор абонентки' },
      { to: '/techdebt', label: 'Техдолг точек' },
      { to: '/mock/utm-analytics', label: 'UTM-аналитика', badge: 'Ф2' },
    ],
  },
  {
    section: 'Люди',
    links: [
      { to: '/masters', label: 'Мастера', end: true },
      { to: '/masters/funnel', label: 'Онбординг мастеров' },
      { to: '/users', label: 'Пользователи' },
      { to: '/rating-engine', label: 'Рейтинг мастеров' },
      { to: '/referrals', label: 'Рефералка' },
      { to: '/badges', label: 'QR-бейджи' },
    ],
  },
  {
    section: 'Активы и партнёры',
    links: [
      { to: '/equipment', label: 'Оборудование' },
      { to: '/stores', label: 'Магазины' },
      { to: '/stock', label: 'Склад' },
      { to: '/mock/depreciation', label: 'Амортизация и ТО', badge: 'Ф2' },
      { to: '/mock/licensees', label: 'Лицензиаты', badge: 'Ф2' },
      { to: '/purchase-codes', label: 'Коды закупки' },
    ],
  },
  {
    section: 'Биллинг',
    links: [
      { to: '/money-flow', label: 'Где деньги' },
      { to: '/billing/accounts', label: 'Балансы и проводки' },
      { to: '/billing/invoices', label: 'Счета-фактуры' },
      { to: '/billing/payouts', label: 'Ведомости' },
      { to: '/billing/receivables', label: 'Дебиторка' },
      { to: '/billing/penalties', label: 'Пени' },
      { to: '/billing/clearing', label: 'Клиринг' },
      { to: '/billing/periods', label: 'Закрытие периода' },
      { to: '/billing/tax-registers', label: 'Налоговые регистры' },
      { to: '/billing/opening', label: 'Стартовые остатки' },
      { to: '/mock/edo', label: 'ЭДО', badge: 'Ф2' },
      { to: '/mock/bank-import', label: 'Банк-выписка', badge: 'Ф2' },
      { to: '/billing/dunning', label: 'Дунинг' },
      { to: '/mock/integrations-1c', label: '1С', badge: 'Ф2' },
    ],
  },
  {
    section: 'Справочники',
    links: [
      { to: '/promo-codes', label: 'Промокоды' },
      { to: '/consumables', label: 'Расходники' },
      { to: '/spare-parts', label: 'Запчасти' },
      { to: '/zones', label: 'Зоны' },
      { to: '/complaint-types', label: 'Типы жалоб' },
      { to: '/object-rates', label: 'Ставки м²' },
      { to: '/holidays', label: 'Календарь' },
      { to: '/tool-checklists', label: 'Инструмент' },
      { to: '/inspection-checklists', label: 'Чек-листы осмотров' },
      { to: '/cancel-reasons', label: 'Причины отмен' },
    ],
  },
  {
    section: 'Контроль',
    links: [
      { to: '/scheduler', label: 'Планировщик' },
      { to: '/parameters', label: 'Параметры' },
      { to: '/reserve-fund', label: 'Резервный фонд' },
      { to: '/complaints', label: 'Жалобы' },
      { to: '/disputes', label: 'Споры' },
      { to: '/loyalty', label: 'Баллы и ваучеры' },
      { to: '/audit', label: 'Аудит' },
      { to: '/mock/notifications', label: 'Уведомления', badge: 'Ф2' },
      { to: '/mock/campaigns', label: 'Кампании', badge: 'Ф2' },
      { to: '/pending', label: 'Ждёт ответа' },
      { to: '/app-health', label: 'Очередь и воронка' },
      { to: '/mock/tenants', label: 'Тенанты', badge: 'Ф3' },
    ],
  },
];

export function Layout() {
  const navigate = useNavigate();
  const user = getUser();

  if (!getToken()) {
    return <Navigate to="/login" replace />;
  }

  const logout = () => {
    clearSession();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar__logo">
          <SozoMark size={26} />
          <SozoLogo height={17} title="SOZO" />
          <span className="sidebar__logo-suffix">Админ</span>
        </div>
        <nav className="sidebar__nav">
          {MENU.map((group) => (
            <div key={group.section}>
              <div className="sidebar__section">{group.section}</div>
              {group.links.map((link) => (
                <NavLink
                  key={link.to}
                  to={link.to}
                  end={link.end}
                  className={({ isActive }) =>
                    isActive ? 'sidebar__link active' : 'sidebar__link'
                  }
                >
                  <span>{link.label}</span>
                  {link.badge !== undefined && (
                    <span className="sidebar__badge">{link.badge}</span>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>
        {/* Управление конвейером — в диспетчерской (PRD-03); в админке только просмотр. */}
        <a
          className="sidebar__link sidebar__link--external"
          href={DISPATCHER_URL}
          target="_blank"
          rel="noreferrer"
        >
          <span>
            Диспетчерская
            <span className="sidebar__hint">операционная панель, :5174</span>
          </span>
        </a>
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
