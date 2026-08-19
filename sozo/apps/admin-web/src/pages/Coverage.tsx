import { Fragment } from 'react';
import { Link } from 'react-router-dom';

type CoverageStatus = 'works' | 'mock2' | 'mock3' | 'infra' | 'scaffold' | 'none';

const STATUS: Record<CoverageStatus, { label: string; variant: string }> = {
  works: { label: 'Работает (dev)', variant: 'success' },
  mock2: { label: 'Макет Ф2', variant: 'warning' },
  mock3: { label: 'Макет Ф3', variant: 'muted' },
  infra: { label: 'Ждёт инфраструктуру', variant: 'accent' },
  scaffold: { label: 'Каркас создан', variant: 'muted' },
  none: { label: 'Не начато', variant: 'error' },
};

interface Row {
  block: string;
  scope: string;
  status: CoverageStatus;
  link?: string;
  basis: string;
}

interface Group {
  title: string;
  rows: Row[];
}

const GROUPS: Group[] = [
  {
    title: 'Ядро платформы',
    rows: [
      { block: 'Статусные машины', scope: '8 типов заявок с гейтами переходов', status: 'works', basis: 'DEV-10' },
      { block: 'Биллинг', scope: 'Двойная запись + баланс-чекер', status: 'works', link: '/billing/accounts', basis: 'ТЗ 8, DEV-04' },
      { block: 'Релизы прайса', scope: 'Excel-каталог, 136 позиций', status: 'works', link: '/price-releases', basis: 'ТЗ 6' },
      { block: 'Параметры системы', scope: '123 параметра с историей изменений', status: 'works', link: '/parameters', basis: 'ТЗ 16' },
      { block: 'Аудит', scope: 'Append-only журнал действий', status: 'works', link: '/audit', basis: 'ТЗ 17.6' },
      { block: 'Персистентность данных', scope: 'файловое хранилище состояния; PostgreSQL+Prisma — следующий шаг', status: 'works', basis: 'DEV-02' },
      { block: 'Планировщик таймеров', scope: '7 групп таймеров из 54 (PRD-05 §8)', status: 'works', link: '/scheduler', basis: 'PRD-05 §8' },
      { block: 'Публичный API лендингов', scope: 'Цены «от» по категориям, ставки типов объектов, верификация бейджа, приём лидов с SLA и антиспамом', status: 'works', basis: 'PRD-05 §12.8, ТЗ 17.15' },
      { block: 'Авто-распределение', scope: 'Фильтры skill/зона/загрузка/оборудование/чёрный список, ранжирование по закреплению, грейду и рейтингу, авто-назначение с обоснованием', status: 'works', basis: 'ТЗ 7.3, PRD-05 §3' },
      { block: 'Планировщик слотов', scope: 'Сетка 30 мин, дорожный буфер 20%, план дня ≤80%, заморозка 2 ч, 8 приоритетов очереди, лист ожидания', status: 'works', basis: 'ТЗ 17.3, PRD-05 §2' },
      { block: 'Фотофиксация', scope: 'Загрузка снимков, серверный таймштамп, доступ по токену, фото в акте', status: 'works', basis: 'PRD-05 §9' },
      { block: 'Печатные документы', scope: 'Акт с фото, отчёт по объекту, журнал ТО, акт сверки, счёт-фактура', status: 'works', link: '/mock/documents', basis: 'PRD-05 §13' },
    ],
  },
  {
    title: 'Админка',
    rows: [
      { block: 'Дашборд', scope: 'Заявки, финансы, люди, прайс', status: 'works', link: '/dashboard', basis: 'PRD-04' },
      { block: 'Аналитика бизнеса', scope: 'P&L, NPS, упущенный спрос, follow-up, парные', status: 'works', link: '/analytics', basis: 'PRD-04 A-01 F-003…F-008' },
      { block: 'Жалобы и споры', scope: 'Дашборд с SLA и паттернами; управление в диспетчерской', status: 'works', link: '/complaints', basis: 'ТЗ 17.10, 4.2' },
      { block: 'Карта клиентов', scope: 'Точки и объекты на карте города', status: 'works', link: '/map', basis: 'PRD-04 A-01' },
      { block: 'Реестр заявок', scope: 'Просмотр всей операционки: статусы, сметы, материалы, фото, журнал; управление — в диспетчерской', status: 'works', link: '/orders', basis: 'PRD-04 A-01' },
      { block: 'Организации', scope: 'B2B: договоры, точки, абонентка', status: 'works', link: '/organizations', basis: 'PRD-04' },
      { block: 'B2C-клиенты', scope: 'Профили, блокировка', status: 'works', link: '/clients', basis: 'PRD-04' },
      { block: 'Лиды', scope: 'B2B-воронка', status: 'works', link: '/leads', basis: 'PRD-04 A-37' },
      { block: 'Мастера', scope: 'Реестр + онбординг-воронка', status: 'works', link: '/masters', basis: 'PRD-04 A-12' },
      { block: 'Карточка мастера (глубокая)', scope: 'Профиль, документы и ГПХ с алертом за 14 дней, skill-экзамены, заявки, деньги и наличный долг, рейтинг, офбординг', status: 'works', link: '/masters', basis: 'PRD-04 A-11, ТЗ 17.1' },
      { block: 'Паспорт точки', scope: 'м², санузлы, кондиционеры, щитки; график доступа и контакт ТСЖ; закреплённый мастер и чёрный список', status: 'works', link: '/organizations', basis: 'PRD-04 A-09, ТЗ 3.2' },
      { block: 'Финансы организации', scope: 'Баланс абонентки, прогноз «хватит до ~N числа», признак сверхлимита, режим заморозки цен', status: 'works', link: '/organizations', basis: 'ТЗ 8.3' },
      { block: 'История точки', scope: 'Хронология работ объекта; выгрузка отчёта с фото и журнала ТО (печатные формы работают)', status: 'works', link: '/organizations', basis: 'ТЗ 9.2' },
      { block: 'Активы', scope: 'Оборудование, магазины, склад', status: 'works', link: '/equipment', basis: 'PRD-04' },
      { block: 'Биллинг-экраны', scope: 'СФ, ведомости, дебиторка, клиринг, периоды, налоговые регистры, стартовые остатки', status: 'works', link: '/billing/invoices', basis: 'ТЗ 8' },
      { block: 'Резервный фонд', scope: 'Движения и остаток фонда', status: 'works', link: '/reserve-fund', basis: 'ТЗ 8.8' },
      { block: 'Промокоды', scope: 'Выпуск и статистика', status: 'works', link: '/promo-codes', basis: 'ТЗ 9' },
      { block: 'Баллы и ваучеры', scope: 'Лояльность B2C', status: 'works', link: '/loyalty', basis: 'ТЗ 9' },
      { block: 'Калькулятор абонентки', scope: 'Расчёт КП для B2B', status: 'works', link: '/calculator', basis: 'ТЗ 4' },
      { block: 'Справочники', scope: '9 справочников: зоны, расходники, запчасти, чек-листы и др.', status: 'works', link: '/zones', basis: 'PRD-04' },
    ],
  },
  {
    title: 'Диспетчерская (PRD-03)',
    rows: [
      { block: 'Кабинет диспетчера', scope: 'Дашборд смены, Kanban 12 колонок, телефонная заявка D-08, архив (отдельное приложение, localhost:5174)', status: 'works', basis: 'PRD-03' },
      { block: 'Карточка заявки D-06 (глубокая)', scope: 'Вкладки: сводка с промокодом, журнал переходов, сметы (вынужденная vs апсейл), фото, материалы с правилами чеков и вилок, отмена с предпросмотром денег по матрице 4.4, переназначение с причиной', status: 'works', basis: 'PRD-03 D-06, ТЗ 4.4/4.5/8.4' },
      { block: 'Карта города D-03', scope: 'Мастера на визите: точка из приложения мастера, при устаревшей отметке — адрес заявки (гео только на время заявки, ТЗ 17.5)', status: 'works', basis: 'PRD-03 D-03' },
      { block: 'Ёмкость дня D-04', scope: 'Загрузка по часам, перегруженные ленты, лист ожидания (тепловая карта по зонам — фаза 2)', status: 'works', basis: 'PRD-03 D-04' },
      { block: 'Ленты мастеров D-05', scope: 'Таймлайн смен и броней, смены дня, бронирование из карточки с проверкой ёмкости и заморозки', status: 'works', basis: 'PRD-03 D-05, ТЗ 17.3' },
      { block: 'Протокол замены D-12', scope: 'Детект рисков срыва, бродкаст-оффер 120 сек, кандидаты, эскалация, квалификация невыхода с авто-санкцией', status: 'works', basis: 'PRD-03 D-12, ТЗ 17.3' },
      { block: 'Жалобы D-10', scope: 'Регистрация, SLA первого ответа и резолюции, плейбук методов, подтверждение вины и влияние на рейтинг, паттерн-детект по мастеру', status: 'works', link: '/complaints', basis: 'PRD-03 D-10, ТЗ 17.10' },
      { block: 'Споры D-11', scope: 'Окно 72 ч после «Выполнена», блокировка доли мастера, эскалация «диспетчер не судит свои заявки», возврат через refund-API со сторно', status: 'works', link: '/disputes', basis: 'PRD-03 D-11, ТЗ 4.2' },
      { block: 'Инциденты D-13', scope: 'Детект кластеров по зонам за час, открытие инцидента, привязка заявок, закрытие', status: 'works', basis: 'PRD-03 D-13' },
      { block: 'Handover D-17', scope: 'Автосборка незакрытого, приём каждого пункта явной отметкой — без этого смена не сдана', status: 'works', basis: 'PRD-03 D-17' },
      { block: 'KPI D-19', scope: 'Новая→Назначена, модерация, замены, инциденты, аварии (метрики здоровья сетки — фаза 2)', status: 'works', basis: 'PRD-03 D-19' },
    ],
  },
  {
    title: 'Фаза 2 (макеты в админке)',
    rows: [
      { block: 'ЭДО', scope: 'didox.uz / faktura.uz, подписание СФ', status: 'mock2', link: '/mock/edo', basis: 'ТЗ 8' },
      { block: 'Банковская выписка', scope: 'Импорт MT940/Excel, авторазнесение FIFO', status: 'mock2', link: '/mock/bank-import', basis: 'ТЗ 8' },
      { block: 'Дунинг-центр', scope: 'Этапы B2B и B2C по производственному календарю', status: 'mock2', link: '/mock/dunning', basis: 'ТЗ 8.9' },
      { block: 'Экспорт в 1С', scope: 'Проводки, СФ, ведомости', status: 'mock2', link: '/mock/integrations-1c', basis: 'ТЗ 8' },
      { block: 'Рейтинговый движок', scope: 'Авто-пересчёт грейдов, окно 56 дней', status: 'mock2', link: '/mock/rating-engine', basis: 'ТЗ 7.4, PRD-05 §16' },
      { block: 'Рефералка мастеров', scope: 'Бонус после 20 закрытых заявок приведённого', status: 'works', link: '/referrals', basis: 'ТЗ 18-п.11' },
      { block: 'Амортизация и ТО', scope: 'Линейная амортизация, график ТО', status: 'mock2', link: '/mock/depreciation', basis: 'ТЗ 17.9' },
      { block: 'Лицензиаты', scope: 'Газ и лифты через партнёров', status: 'mock2', link: '/mock/licensees', basis: 'ТЗ 17.8' },
      { block: 'Коды закупки', scope: 'Закупка материалов в партнёрских магазинах', status: 'mock2', link: '/mock/purchase-codes', basis: 'ТЗ 8.4.2' },
      { block: 'Техдолг точек', scope: 'Дефекты, пакетное утверждение', status: 'mock2', link: '/mock/techdebt', basis: 'ТЗ 10' },
      { block: 'UTM-аналитика', scope: 'Сквозная: от источника до выручки', status: 'mock2', link: '/mock/utm-analytics', basis: 'ТЗ 17.15' },
      { block: 'Таймеры', scope: '54 таймера и эскалации', status: 'mock2', link: '/mock/timers', basis: 'PRD-05 §8' },
      { block: 'Матрица уведомлений', scope: 'Каналы, профили доставки, гигиена', status: 'mock2', link: '/mock/notifications', basis: 'PRD-05 §6' },
      { block: 'Кампании', scope: 'Сервисные касания, сезонные волны', status: 'mock2', link: '/mock/campaigns', basis: 'ТЗ 17.12' },
    ],
  },
  {
    title: 'Инфраструктура',
    rows: [
      { block: 'PostgreSQL + Prisma', scope: 'Схема 22 моделей готова', status: 'infra', basis: 'DEV-02' },
      { block: 'Планировщик BullMQ', scope: 'Движок таймеров и очередей — dev: setInterval; прод: BullMQ', status: 'works', link: '/scheduler', basis: 'PRD-05 §8' },
      { block: 'PDF-генератор', scope: 'Печатные документы: акт по заявке, отчёт по точке, журнал ТО, акт сверки, счёт-фактура (HTML→PDF; серверный PDF-рендер и S3 — фаза 2)', status: 'works', link: '/mock/documents', basis: 'PRD-05 §13' },
      { block: 'Платёжки Payme / Click', scope: 'Приём платежей + refund; нужны мерчант-договоры', status: 'infra', basis: 'DEV-05' },
      { block: 'SMS-шлюз Eskiz', scope: 'OTP и уведомления', status: 'infra', basis: 'PRD-05 §6' },
      { block: 'Геокодер Yandex / Google', scope: 'Сейчас заглушка', status: 'infra', basis: 'DEV-07' },
      { block: 'ОФД-фискализация', scope: 'Чеки по B2C-платежам', status: 'infra', basis: 'ТЗ 8' },
      { block: 'Мониторинг Sentry', scope: 'Ошибки, метрики, алерты', status: 'infra', link: '/mock/monitoring', basis: 'PRD-05 §15' },
      { block: 'SaaS-тенанты', scope: 'Мультигородность, фича-флаги', status: 'mock3', link: '/mock/tenants', basis: 'ТЗ 17.13' },
    ],
  },
  {
    title: 'Мобильные приложения',
    rows: [
      { block: 'Приложение «Клиент»', scope: 'Flutter, 50 экранов + веб-карточка заявки', status: 'scaffold', basis: 'PRD-01, DEV-08' },
      { block: 'Приложение «Мастер»', scope: 'Flutter, 42 экрана, офлайн-first', status: 'scaffold', basis: 'PRD-02, DEV-09' },
    ],
  },
  {
    title: 'Лендинги (PRD-06)',
    rows: [
      { block: 'Лендинги', scope: '8 страниц L-01…L-08: B2C, форма заявки, B2B, калькулятор, «Мастерам», анкета, верификация бейджа, оферта; лид→операционный контур с SLA', status: 'works', link: undefined, basis: 'PRD-06' },
    ],
  },
];

export function CoveragePage() {
  const all = GROUPS.flatMap((g) => g.rows);
  const count = (s: CoverageStatus[]) => all.filter((r) => s.includes(r.status)).length;

  const tiles = [
    { value: count(['works']), label: 'Работает (dev)' },
    { value: count(['mock2', 'mock3']), label: 'Макетов' },
    { value: count(['infra']), label: 'Ждёт инфраструктуру' },
    { value: count(['none']), label: 'Не начато' },
  ];

  return (
    <>
      <div className="page-header">
        <h1>Карта проекта</h1>
        <span className="muted">полное покрытие ТЗ: что работает, что в макетах, что впереди</span>
      </div>

      <div className="tiles">
        {tiles.map((t) => (
          <div className="card" key={t.label}>
            <div className="tile__value">{t.value}</div>
            <div className="tile__label">{t.label}</div>
          </div>
        ))}
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Блок</th>
              <th>Что входит</th>
              <th>Статус</th>
              <th>Ссылка</th>
              <th>Основание</th>
            </tr>
          </thead>
          <tbody>
            {GROUPS.map((g) => (
              <Fragment key={g.title}>
                <tr className="row--category">
                  <td colSpan={5}>{g.title}</td>
                </tr>
                {g.rows.map((r) => (
                  <tr key={`${g.title}:${r.block}`}>
                    <td className="semibold">{r.block}</td>
                    <td>{r.scope}</td>
                    <td>
                      <span className={`badge badge--${STATUS[r.status].variant}`}>
                        {STATUS[r.status].label}
                      </span>
                    </td>
                    <td>{r.link !== undefined ? <Link to={r.link}>Открыть</Link> : '—'}</td>
                    <td className="muted">{r.basis}</td>
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
