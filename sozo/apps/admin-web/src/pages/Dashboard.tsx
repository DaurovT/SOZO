import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatSoums } from '../format';
import { PnlCard } from '../components/PnlCard';
import { ErrorBanner, Loading } from '../components/States';
import type { AdminAnalytics, AdminDashboard, DisputesResponse } from '../types';

const REFRESH_MS = 15000;

interface Tile {
  value: string | number;
  label: string;
  hint?: string;
  money?: boolean;
  cardClass?: string;
  /** Плитка ведёт на свой экран — блок заявок открывает реестр A-01. */
  link?: string;
}

function TileRow({ title, tiles }: { title: string; tiles: Tile[] }) {
  return (
    <>
      <div className="section-title">{title}</div>
      <div className="tiles">
        {tiles.map((t) => {
          const body = (
            <>
              <div className={t.money ? 'tile__value tile__value--sm' : 'tile__value'}>
                {t.value}
              </div>
              <div className="tile__label">{t.label}</div>
              {t.hint !== undefined && <div className="tile__hint">{t.hint}</div>}
            </>
          );
          const className = t.cardClass ? `card ${t.cardClass}` : 'card';
          return t.link !== undefined ? (
            <Link className={`${className} card--link`} to={t.link} key={t.label}>
              {body}
            </Link>
          ) : (
            <div className={className} key={t.label}>
              {body}
            </div>
          );
        })}
      </div>
    </>
  );
}

export function DashboardPage() {
  const { data, loading, error, setData } = useFetch<AdminDashboard>(() =>
    api.get<AdminDashboard>('/admin/dashboard'),
  );
  // Аналитика (F-003…F-008) и споры — отдельными запросами: сбой одного из них
  // не должен гасить основной дашборд.
  const { data: analytics, setData: setAnalytics } = useFetch<AdminAnalytics>(() =>
    api.get<AdminAnalytics>('/admin/analytics'),
  );
  const { data: disputes, setData: setDisputes } = useFetch<DisputesResponse>(() =>
    api.get<DisputesResponse>('/admin/quality/disputes'),
  );

  // Автообновление каждые 15 секунд, без мигания «Загрузка…»
  useEffect(() => {
    const timer = window.setInterval(() => {
      api
        .get<AdminDashboard>('/admin/dashboard')
        .then((d) => setData(() => d))
        .catch(() => undefined);
      api
        .get<AdminAnalytics>('/admin/analytics')
        .then((d) => setAnalytics(() => d))
        .catch(() => undefined);
      api
        .get<DisputesResponse>('/admin/quality/disputes')
        .then((d) => setDisputes(() => d))
        .catch(() => undefined);
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [setData, setAnalytics, setDisputes]);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { orders, finance, people, pricing } = data;

  // Каждая плитка блока — вход в реестр заявок (A-01).
  const orderTiles: Tile[] = [
    {
      value: orders.total,
      label: 'Заявок всего',
      hint: `отменено: ${orders.cancelled}`,
      link: '/orders',
    },
    { value: orders.active, label: 'Активные', link: '/orders' },
    { value: orders.unassigned, label: 'Неназначенные', link: '/orders' },
    {
      // Зависшие отделены от неназначенных: рядом с новой заявкой, созданной
      // минуту назад, заявка часовой давности теряется, а тревожит именно она
      value: orders.stuck,
      label: 'Без мастера больше часа',
      hint: orders.stuck > 0 ? 'никто не взял — разобрать вручную' : undefined,
      cardClass: orders.stuck > 0 ? 'card--warning' : undefined,
      link: '/orders',
    },
    {
      value: orders.slaOverdue,
      label: 'Сорван срок по авариям',
      hint: orders.slaOverdue > 0 ? 'договорный срок выезда прошёл' : undefined,
      cardClass: orders.slaOverdue > 0 ? 'card--outline-error' : undefined,
      link: '/pending',
    },
    {
      value: orders.emergencies,
      label: 'Аварийные',
      cardClass: orders.emergencies > 0 ? 'card--outline-error' : undefined,
      link: '/orders',
    },
    { value: orders.closedToday, label: 'Закрыто сегодня', link: '/orders' },
  ];

  // «Что горит» — отдельным блоком над всем остальным: среди двадцати плиток
  // просроченное обращение неотличимо от справочной цифры
  const urgent = data.urgent;
  const urgentTiles: Tile[] = [
    {
      value: urgent.clientRequestsOverdue,
      label: 'Обращений просрочено',
      hint: 'по оценке 1–2 обещан звонок за 2 часа',
      cardClass: urgent.clientRequestsOverdue > 0 ? 'card--outline-error' : undefined,
      link: '/pending',
    },
    { value: urgent.clientRequests, label: 'Обращений в работе', link: '/pending' },
    {
      value: urgent.actsExpired,
      label: 'Актов просрочено',
      hint: 'точка молчит дольше срока',
      cardClass: urgent.actsExpired > 0 ? 'card--warning' : undefined,
      link: '/acts',
    },
    {
      value: urgent.partsToBuy,
      label: 'Запчастей не куплено',
      hint: 'мастер приедет без детали',
      cardClass: urgent.partsToBuy > 0 ? 'card--warning' : undefined,
      link: '/pending',
    },
  ];

  const financeTiles: Tile[] = [
    { value: formatSoums(finance.revenueTiyin), label: 'Выручка', money: true },
    { value: formatSoums(finance.avgCheckTiyin), label: 'Средний чек', money: true },
    { value: formatSoums(finance.masterPayableTiyin), label: 'Кредиторка мастерам', money: true },
    { value: formatSoums(finance.reserveFundTiyin), label: 'Резервный фонд', money: true },
    { value: formatSoums(finance.arTiyin), label: 'Дебиторка', money: true },
  ];

  const peopleTiles: Tile[] = [
    { value: people.mastersActive, label: 'Мастеров активных' },
    { value: people.mastersCandidates, label: 'Кандидатов' },
    { value: people.organizations, label: 'Организаций B2B' },
  ];

  const pricingTiles: Tile[] = [
    {
      value: pricing.itemsCount,
      label:
        pricing.activeReleaseNumber != null
          ? `Позиций в прайсе — релиз №${pricing.activeReleaseNumber}`
          : 'Позиций в прайсе — активного релиза нет',
      hint: `без нормо-часов: ${pricing.itemsWithoutNormHours}`,
      cardClass: pricing.itemsWithoutNormHours > 0 ? 'card--warning' : undefined,
    },
  ];

  // Аналитика бизнеса: сводные показатели, каждый — вход в свой разбор.
  const analyticsTiles: Tile[] = [];
  if (analytics) {
    const { nps, demandMiss, followUp, pairs, complaints } = analytics;
    analyticsTiles.push(
      {
        value: nps.nps ?? 'нет оценок',
        label: 'NPS',
        hint: `оценок ${nps.ratedCount} из ${nps.closedCount} закрытых`,
        money: nps.nps === null,
        link: '/analytics',
      },
      {
        value: demandMiss.total,
        label: 'Упущенный спрос',
        hint: 'сигнал найма',
        link: '/analytics',
      },
      {
        value: `${followUp.repeatSharePercent} %`,
        label: 'Повторные клиенты',
        hint: `выручка повторных: ${formatSoums(followUp.repeatRevenueTiyin)}`,
        link: '/analytics',
      },
      {
        value: `${pairs.pairedSharePercent} %`,
        label: 'Доля парных заявок',
        hint: `${pairs.pairedOrders} из ${pairs.ordersTotal}`,
        link: '/analytics',
      },
      {
        value: complaints.open,
        label: 'Открытых жалоб',
        hint:
          complaints.overdueFirstResponse > 0
            ? `просрочен первый ответ: ${complaints.overdueFirstResponse}`
            : `всего: ${complaints.total}`,
        cardClass: complaints.overdueFirstResponse > 0 ? 'card--outline-error' : undefined,
        link: '/complaints',
      },
    );
  }
  if (disputes) {
    analyticsTiles.push({
      value: disputes.stats.open,
      label: 'Открытых споров',
      hint: `возвращено: ${formatSoums(disputes.stats.refundTotalTiyin)}`,
      link: '/disputes',
    });
  }

  return (
    <>
      <div className="page-header">
        <h1>Дашборд</h1>
        <span className="muted">обновляется каждые 15 сек</span>
      </div>
      {finance.balanceCheckOk ? (
        <div className="banner banner--success">Баланс сходится</div>
      ) : (
        <div className="banner banner--error">РАСХОЖДЕНИЕ — баланс-чекер обнаружил ошибку</div>
      )}
      <TileRow title="Что горит" tiles={urgentTiles} />
      <TileRow title="Заявки" tiles={orderTiles} />
      <TileRow title="Финансы" tiles={financeTiles} />
      <TileRow title="Люди" tiles={peopleTiles} />
      <TileRow title="Прайс" tiles={pricingTiles} />
      {analytics && (
        <>
          <div className="section-title">P&amp;L — прибыль и рентабельность</div>
          <PnlCard pnl={analytics.pnl} />
        </>
      )}
      {analyticsTiles.length > 0 && <TileRow title="Аналитика и качество" tiles={analyticsTiles} />}
    </>
  );
}
