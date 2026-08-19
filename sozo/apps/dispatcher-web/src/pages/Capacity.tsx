import { useState } from 'react';
import { api, ApiError } from '../api';
import { OrderModal } from '../components/OrderModal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import {
  FREEZE_MINUTES,
  NIGHT_END_MIN,
  NIGHT_START_MIN,
  QUEUE_LEVELS,
  priorityLabel,
  priorityTone,
} from '../dicts';
import { formatDateTime, formatMinutes, plusDaysISO, todayISO } from '../format';
import type { DayCapacity, WaitlistEntry } from '../types';
import { useFetch } from '../useFetch';

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

/** Конец зоны заморозки: «сейчас» + 2 часа (только для сегодняшней даты). */
function freezeUntilMin(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes() + FREEZE_MINUTES;
}

export function CapacityPage() {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [openId, setOpenId] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const { data, loading, error, reload } = useFetch(async () => {
    const [capacity, waitlist] = await Promise.all([
      api.get<DayCapacity>(`/dispatch/scheduling/capacity?date=${date}`),
      api.get<WaitlistEntry[]>('/dispatch/scheduling/waitlist'),
    ]);
    return { capacity, waitlist };
  }, [date]);

  const removeFromWaitlist = async (orderId: string) => {
    setActionError(null);
    try {
      await api.del(`/dispatch/scheduling/waitlist/${orderId}`);
      toast('Заявка убрана из листа ожидания');
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    }
  };

  const cap = data?.capacity ?? null;
  const overCap = cap !== null && cap.loadPercent > cap.capPercent;
  const isToday = date === todayISO();
  const freezeUntil = freezeUntilMin();
  const maxColumn = Math.max(1, ...(cap?.byHour ?? []).map((h) => h.busy + h.free));

  const tiles: { value: string; label: string; hint: string; warning?: boolean }[] = cap
    ? [
        {
          value: String(cap.masters),
          label: 'Мастеров в смене',
          hint: `перегружено лент: ${cap.overloaded}`,
        },
        {
          value: `${cap.loadPercent}%`,
          label: 'Загрузка дня',
          hint: `потолок плана ${cap.capPercent}% смены`,
          warning: overCap,
        },
        {
          value: String(cap.overloaded),
          label: 'Перегружено лент',
          hint: 'ленты, упёршиеся в потолок дня',
          warning: cap.overloaded > 0,
        },
        {
          value: String(cap.waitlist),
          label: 'В листе ожидания',
          hint: 'ждут освободившийся слот',
        },
      ]
    : [];

  return (
    <>
      <div className="page-header">
        <h1>Ёмкость дня</h1>
        <span className="muted">Резерв 20% смены — под аварии и задержки (ТЗ 17.3)</span>
      </div>

      <div className="toolbar">
        <div className="field">
          <label htmlFor="cap-date">Дата</label>
          <input
            id="cap-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value || todayISO())}
          />
        </div>
        <button type="button" className="btn" onClick={() => setDate(todayISO())}>
          Сегодня
        </button>
        <button type="button" className="btn" onClick={() => setDate(plusDaysISO(todayISO(), 1))}>
          Завтра
        </button>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}
      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && cap && (
        <>
          <div className="tiles">
            {tiles.map((t) => (
              <div key={t.label} className={t.warning ? 'card card--warning' : 'card'}>
                <div className="tile__value">{t.value}</div>
                <div className="tile__label">{t.label}</div>
                <div className="tile__hint">{t.hint}</div>
              </div>
            ))}
          </div>

          <div className="tab-note" style={{ marginTop: 0, marginBottom: 'var(--s16)' }}>
            Потолок {cap.capPercent}% — резерв под аварии, задержки и срочные заявки (ТЗ 17.3).
            Перегруженные ленты новые плановые заявки не принимают.
          </div>

          <div className="section-title" style={{ marginTop: 0 }}>
            Занятость по часам
          </div>
          <div className="histogram">
            {cap.byHour.map((h) => {
              const total = h.busy + h.free;
              // Час без свободных мастеров — узкое место дня.
              const full = total > 0 && h.free === 0;
              // Ночью плановые не бронируются, в зоне заморозки — только с подтверждением.
              const night = h.hour * 60 >= NIGHT_START_MIN || h.hour * 60 < NIGHT_END_MIN;
              const frozen = !night && isToday && h.hour * 60 < freezeUntil;
              const note = night ? 'ночь' : frozen ? 'заморожено' : null;
              const classes = ['histogram__col'];
              if (full) classes.push('histogram__col--full');
              if (night) classes.push('histogram__col--night');
              else if (frozen) classes.push('histogram__col--frozen');
              return (
                <div
                  key={h.hour}
                  className={classes.join(' ')}
                  title={[
                    `${h.hour}:00 — занято ${h.busy}, свободно ${h.free}`,
                    night ? 'ночь 22:00–07:00: плановые не бронируются' : null,
                    frozen ? `заморожено до ${formatMinutes(freezeUntil)}` : null,
                  ]
                    .filter((s) => s !== null)
                    .join('\n')}
                >
                  <div className="histogram__plot">
                    <div className="histogram__stack" style={{ height: `${(total / maxColumn) * 100}%` }}>
                      <div className="histogram__free" style={{ flex: h.free }} />
                      <div className="histogram__busy" style={{ flex: h.busy }} />
                    </div>
                  </div>
                  <div className="histogram__hour">{h.hour}</div>
                  <div className="histogram__note">{note}</div>
                </div>
              );
            })}
          </div>
          <div className="tab-note">
            Тёмная часть столбика — занятые мастера, светлая — свободные. Красным отмечены часы без
            свободной ёмкости; серым — часы в зоне заморозки {FREEZE_MINUTES / 60} ч и ночные часы,
            когда плановые заявки не бронируются.
          </div>

          <div className="section-title">Приоритеты очереди</div>
          <div className="queue-levels">
            {QUEUE_LEVELS.map((q) => (
              <div key={q.priority} className="queue-levels__item">
                <span className={`queue-levels__dot tone--${priorityTone(q.priority)}`} />
                <span className="queue-levels__num">{q.priority}</span>
                {q.label}
              </div>
            ))}
          </div>
          <div className="tab-note">
            Слот освобождается — предлагается по этому порядку (ТЗ 17.3).
          </div>

          <div className="section-title">Лист ожидания (D-18)</div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Номер</th>
                  <th>Приоритет</th>
                  <th className="num">Нормо-часы</th>
                  <th>Добавлен</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.waitlist.length === 0 && <EmptyRow colSpan={5} />}
                {data.waitlist.map((w) => (
                  <tr key={w.orderId} className="row--clickable" onClick={() => setOpenId(w.orderId)}>
                    <td className="mono">{w.orderNumber}</td>
                    <td>
                      {w.priority}. {priorityLabel(w.priority)}
                    </td>
                    <td className="num">{w.normHours}</td>
                    <td>{formatDateTime(w.at)}</td>
                    <td className="num">
                      <button
                        type="button"
                        className="btn btn--link"
                        onClick={(e) => {
                          e.stopPropagation();
                          void removeFromWaitlist(w.orderId);
                        }}
                      >
                        Убрать
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="tab-note">
            Ожидание бесплатно: заявка получает слот, как только он освободится (ТЗ 17.3).
          </div>
        </>
      )}

      {openId !== null && (
        <OrderModal orderId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      )}
    </>
  );
}
