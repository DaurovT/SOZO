import { useEffect } from 'react';
import { api } from '../api';
import { ErrorBanner, Loading } from '../components/States';
import type { OpsKpi } from '../types';
import { useFetch } from '../useFetch';

/** Панель обновляется сама — диспетчер держит её открытой всю смену. */
const REFRESH_MS = 30_000;

export function KpiPage() {
  const { data, loading, error, reload } = useFetch(() => api.get<OpsKpi>('/dispatch/ops/kpi'), []);

  useEffect(() => {
    const timer = window.setInterval(reload, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [reload]);

  const tiles: { value: string; label: string; hint: string; alert?: boolean }[] = data
    ? [
        {
          value: `${data.newToAssignedAvgMin} мин`,
          label: 'Новая → Назначена',
          hint: 'среднее время от создания до назначения мастера',
        },
        { value: String(data.ordersTotal), label: 'Заявок всего', hint: 'за всё время' },
        { value: String(data.closedTotal), label: 'Закрыто', hint: 'закрытые и оценённые клиентом' },
        { value: String(data.cancelledTotal), label: 'Отменено', hint: 'отменённые заявки' },
        {
          value: String(data.moderationQueue),
          label: 'На модерации фото',
          hint: 'выполнены, ждут проверки фото',
        },
        {
          value: String(data.emergenciesActive),
          label: 'Аварий активных',
          hint: data.emergenciesActive > 0 ? 'требуют немедленной реакции' : 'аварий нет',
          alert: data.emergenciesActive > 0,
        },
        {
          value: String(data.activeReplacements),
          label: 'Замен активных',
          hint: 'протоколы D-12 в работе',
        },
        {
          value: `${data.replacementsResolved} из ${data.replacementsTotal}`,
          label: 'Замен решено',
          hint: 'назначена замена или протокол закрыт',
        },
        {
          value: String(data.openIncidents),
          label: 'Открытых инцидентов',
          hint: 'массовые аварии в работе',
        },
      ]
    : [];

  return (
    <>
      <div className="page-header">
        <h1>KPI смены</h1>
        <span className="muted">Обновляется автоматически каждые {REFRESH_MS / 1000} секунд</span>
      </div>

      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="tiles">
            {tiles.map((t) => (
              <div key={t.label} className={t.alert ? 'card tile--alert' : 'card'}>
                <div className="tile__value">{t.value}</div>
                <div className="tile__label">{t.label}</div>
                <div className="tile__hint">{t.hint}</div>
              </div>
            ))}
          </div>
          <div className="tab-note" style={{ marginTop: 0 }}>
            Метрики здоровья сетки (churn лент, доля заявок в окне) — фаза 2 (PRD-03 D-19)
          </div>
        </>
      )}
    </>
  );
}
