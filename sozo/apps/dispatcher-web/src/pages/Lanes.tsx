import { useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import { Modal } from '../components/Modal';
import { OrderModal } from '../components/OrderModal';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import {
  DAY_PLAN_CAP,
  FREEZE_MINUTES,
  NIGHT_END_MIN,
  NIGHT_START_MIN,
  SCHEDULING_RULES,
  laneCapacityLeftMin,
  priorityLabel,
  priorityTone,
} from '../dicts';
import { formatDuration, formatMinutes, minutesFromTime, plusDaysISO, todayISO } from '../format';
import type { DispatchMaster, Lane, LanesResponse, Shift } from '../types';
import { useFetch } from '../useFetch';

/**
 * Шкала ленты: 06:00–23:00 — рабочее окно 07:00–22:00 плюс полосы ночи по краям,
 * чтобы диспетчер видел запрет на плановые ночью (ТЗ 17.3).
 */
const DAY_START_MIN = 6 * 60;
const DAY_END_MIN = 23 * 60;
const DAY_SPAN_MIN = DAY_END_MIN - DAY_START_MIN;
const HOURS = Array.from({ length: DAY_SPAN_MIN / 60 + 1 }, (_, i) => DAY_START_MIN / 60 + i);

/** Подпись потолка плана дня: 80%. */
const CAP_PERCENT = Math.round(DAY_PLAN_CAP * 100);

/** Минуты от полуночи → позиция в процентах на шкале 06:00–23:00. */
function toPercent(min: number): number {
  return ((min - DAY_START_MIN) / DAY_SPAN_MIN) * 100;
}

function clamp(percent: number): number {
  return Math.max(0, Math.min(100, percent));
}

function nowMinutes(): number {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

/** Панель активных ограничений: правила видны до действия, а не только в тексте ошибки. */
function RulesPanel() {
  return (
    <details className="rules" open>
      <summary className="rules__summary">Правила планирования (ТЗ 17.3)</summary>
      <div className="rules__grid">
        {SCHEDULING_RULES.map((r) => (
          <span key={r.text} className="rules__item">
            <span className={`rules__dot tone--${r.tone}`} />
            {r.text}
          </span>
        ))}
      </div>
      <div className="rules__note">
        Правила проверяются на сервере — обойти через интерфейс нельзя (ТЗ 17.3)
      </div>
    </details>
  );
}

const LEGEND: { priority: number }[] = [
  { priority: 1 },
  { priority: 2 },
  { priority: 3 },
  { priority: 5 },
  { priority: 6 },
];

interface ShiftFormProps {
  date: string;
  masters: DispatchMaster[];
  onClose: () => void;
  onCreated: () => void;
}

/** Модал «+ Смена»: время вводится как input[type=time], на бэкенд уходят минуты. */
function ShiftForm({ date, masters, onClose, onCreated }: ShiftFormProps) {
  const toast = useToast();
  const [masterId, setMasterId] = useState('');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('18:00');
  const [isDuty, setIsDuty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post<Shift>('/dispatch/scheduling/shifts', {
        masterId,
        date,
        startMin: minutesFromTime(start),
        endMin: minutesFromTime(end),
        isDuty,
      });
      toast('Смена добавлена');
      onCreated();
      onClose();
    } catch (e) {
      // SHIFT_EXISTS | SHIFT_RANGE_INVALID | MASTER_NOT_FOUND — показываем message.
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Смена на ${date}`} onClose={onClose}>
      {error !== null && <ErrorBanner message={error} />}
      <div className="form-grid">
        <div className="field">
          <label htmlFor="sh-master">Мастер</label>
          <select id="sh-master" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
            <option value="">— выберите мастера —</option>
            {masters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName} · {m.skillTags.join(', ')}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="sh-start">Начало смены</label>
          <input id="sh-start" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
        </div>
        <div className="field">
          <label htmlFor="sh-end">Конец смены</label>
          <input id="sh-end" type="time" value={end} onChange={(e) => setEnd(e.target.value)} />
        </div>
        <label className="field--checkbox">
          <input type="checkbox" checked={isDuty} onChange={(e) => setIsDuty(e.target.checked)} />
          Дежурный (плановые заявки не бронируются)
        </label>
      </div>
      <div className="modal__actions">
        <button type="button" className="btn btn--link" onClick={onClose}>
          Отмена
        </button>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy || masterId === '' || minutesFromTime(end) <= minutesFromTime(start)}
          onClick={submit}
        >
          Добавить смену
        </button>
      </div>
    </Modal>
  );
}

/** Одна лента: шкала 07:00–22:00, интервал смены, брони, заморозка и полоса «сейчас». */
function LaneRow({
  lane,
  isToday,
  now,
  onOpenOrder,
  onRemoveShift,
}: {
  lane: Lane;
  isToday: boolean;
  now: number;
  onOpenOrder: (orderId: string) => void;
  onRemoveShift: (() => void) | null;
}) {
  const freezeFrom = clamp(toPercent(now));
  const freezeTo = clamp(toPercent(now + FREEZE_MINUTES));
  const showFreeze = isToday && freezeTo > freezeFrom;
  const showNow = isToday && now >= DAY_START_MIN && now <= DAY_END_MIN;
  // Остаток до потолка плана дня: 80% смены минус занятые минуты броней.
  const capacityLeftMin = laneCapacityLeftMin(lane);
  const capReached = lane.capReached || capacityLeftMin <= 0;

  return (
    <div className="lanes__row">
      <div className="lanes__name">
        <div className="lanes__title">
          {lane.masterName}
          {lane.isDuty && (
            <span
              className="badge badge--warning"
              title="дежурный: плановые заявки не бронируются, только аварии и замены"
            >
              дежурный
            </span>
          )}
        </div>
        <div className="lanes__zone">
          {lane.zone ?? 'зона не указана'} · смена {lane.shift.start}–{lane.shift.end}
        </div>
        <div className="lane-load" title={`Засечка — потолок плана дня ${CAP_PERCENT}% смены`}>
          <div
            className={lane.capReached ? 'lane-load__bar lane-load__bar--cap' : 'lane-load__bar'}
            style={{ width: `${clamp(lane.loadPercent)}%` }}
          />
          <div className="lane-load__cap-mark" style={{ left: `${CAP_PERCENT}%` }} />
        </div>
        <div
          className={capReached ? 'lane-capacity lane-capacity--full' : 'lane-capacity'}
          title={`Потолок плана дня — ${CAP_PERCENT}% смены (ТЗ 17.3)`}
        >
          {capReached
            ? `потолок ${CAP_PERCENT}% достигнут`
            : `свободно до потолка: ${formatDuration(capacityLeftMin)}`}
        </div>
        <div className="lanes__foot">
          <span className="lane-load__text">
            {lane.loadPercent}%{lane.capReached ? ' · потолок дня' : ''}
          </span>
          {onRemoveShift !== null && (
            <button type="button" className="btn btn--link" onClick={onRemoveShift}>
              Снять смену
            </button>
          )}
        </div>
      </div>
      <div className="lanes__track">
        <div
          className="lane-night"
          style={{ left: '0%', width: `${clamp(toPercent(NIGHT_END_MIN))}%` }}
          title="Ночь 22:00–07:00: плановые не бронируются"
        />
        <div
          className="lane-night"
          style={{
            left: `${clamp(toPercent(NIGHT_START_MIN))}%`,
            width: `${100 - clamp(toPercent(NIGHT_START_MIN))}%`,
          }}
          title="Ночь 22:00–07:00: плановые не бронируются"
        />
        {HOURS.map((h) => (
          <div key={h} className="lanes__tick" style={{ left: `${clamp(toPercent(h * 60))}%` }} />
        ))}
        <div
          className="lane-shift"
          style={{
            left: `${clamp(toPercent(lane.shift.startMin))}%`,
            width: `${clamp(toPercent(lane.shift.endMin)) - clamp(toPercent(lane.shift.startMin))}%`,
          }}
        />
        {showFreeze && (
          <div
            className="lane-freeze"
            style={{ left: `${freezeFrom}%`, width: `${freezeTo - freezeFrom}%` }}
            title={`Ближайшие ${FREEZE_MINUTES / 60} ч ленты заморожены до ${formatMinutes(
              now + FREEZE_MINUTES,
            )} — правка только с подтверждением (ТЗ 17.3)`}
          >
            заморожено до {formatMinutes(now + FREEZE_MINUTES)}
          </div>
        )}
        {showNow && <div className="lane-now" style={{ left: `${clamp(toPercent(now))}%` }} />}
        {lane.bookings.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`lane-booking tone--${priorityTone(b.priority)}`}
            style={{
              left: `${clamp(toPercent(b.startMin))}%`,
              width: `${clamp(toPercent(b.endMin)) - clamp(toPercent(b.startMin))}%`,
            }}
            title={[
              `${b.orderNumber} · ${priorityLabel(b.priority)}`,
              `Время: ${b.start}–${b.end}`,
              `Окно клиента: ${b.clientWindowText}`,
              `Нормо-часы: ${b.normHours} ч · буфер ${b.bufferMin} мин · слотов ${b.slots}`,
              b.anchored ? 'Якорная бронь (жёсткое окно)' : 'Гибкая бронь',
            ].join('\n')}
            onClick={() => onOpenOrder(b.orderId)}
          >
            {b.orderNumber}
          </button>
        ))}
      </div>
    </div>
  );
}

export function LanesPage() {
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [openId, setOpenId] = useState<string | null>(null);
  const [shiftFormOpen, setShiftFormOpen] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(nowMinutes);

  // Полоса «сейчас» и зона заморозки должны двигаться без перезагрузки страницы.
  useEffect(() => {
    const timer = window.setInterval(() => setNow(nowMinutes()), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const { data, loading, error, reload } = useFetch(async () => {
    const [lanesRes, shifts] = await Promise.all([
      api.get<LanesResponse>(`/dispatch/scheduling/lanes?date=${date}`),
      api.get<Shift[]>(`/dispatch/scheduling/shifts?date=${date}`),
    ]);
    return { lanes: lanesRes.lanes, shifts };
  }, [date]);

  const masters = useFetch(() => api.get<DispatchMaster[]>('/dispatch/masters'), []);

  const seedDay = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<{ created: number; shifts: Shift[] }>(
        '/dispatch/scheduling/shifts/seed-day',
        { date },
      );
      toast(`Создано ${res.created} смен`);
      reload();
    } catch (e) {
      setActionError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const removeShift = async (id: string) => {
    setActionError(null);
    try {
      await api.del(`/dispatch/scheduling/shifts/${id}`);
      toast('Смена снята');
      reload();
    } catch (e) {
      // SHIFT_HAS_BOOKINGS — сначала нужно переназначить заявки.
      setActionError(errorMessage(e));
    }
  };

  const isToday = date === todayISO();
  const shiftByMaster = new Map((data?.shifts ?? []).map((s) => [s.masterId, s]));

  return (
    <>
      <div className="page-header">
        <h1>Ленты мастеров</h1>
        <span className="muted">
          План дня ≤ {CAP_PERCENT}% смены, ближайшие {FREEZE_MINUTES / 60} часа заморожены (ТЗ 17.3)
        </span>
      </div>

      <RulesPanel />

      <div className="toolbar">
        <div className="field">
          <label htmlFor="lanes-date">Дата</label>
          <input
            id="lanes-date"
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
        <button type="button" className="btn" disabled={busy} onClick={seedDay}>
          Заполнить смены дня
        </button>
        <button type="button" className="btn btn--primary" onClick={() => setShiftFormOpen(true)}>
          + Смена
        </button>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}
      {error !== null && <ErrorBanner message={error} />}
      {loading && !data && <Loading />}

      {data && (
        <>
          <div className="lanes">
            <div className="lanes__row lanes__row--head">
              <div className="lanes__name muted">Мастер · загрузка</div>
              <div className="lanes__track lanes__track--head">
                {HOURS.map((h) => (
                  <div key={h} className="lanes__tick" style={{ left: `${clamp(toPercent(h * 60))}%` }}>
                    {/* Подпись последнего часа упёрлась бы в правый край шкалы. */}
                    {h * 60 < DAY_END_MIN && <span className="lanes__tick-label">{h}:00</span>}
                  </div>
                ))}
              </div>
            </div>
            {data.lanes.length === 0 && (
              <div className="lanes__empty">
                На {date} смен нет — нажмите «Заполнить смены дня» или добавьте смену вручную
              </div>
            )}
            {data.lanes.map((lane) => {
              const shift = shiftByMaster.get(lane.masterId);
              return (
                <LaneRow
                  key={lane.masterId}
                  lane={lane}
                  isToday={isToday}
                  now={now}
                  onOpenOrder={setOpenId}
                  onRemoveShift={shift ? () => removeShift(shift.id) : null}
                />
              );
            })}
          </div>

          <div className="legend">
            {LEGEND.map((l) => (
              <span key={l.priority} className="legend__item">
                <span className={`legend__swatch tone--${priorityTone(l.priority)}`} />
                {l.priority}. {priorityLabel(l.priority)}
              </span>
            ))}
            <span className="legend__item">
              <span className="legend__swatch legend__swatch--freeze" />
              заморожено ({FREEZE_MINUTES / 60} ч)
            </span>
            <span className="legend__item">
              <span className="legend__swatch legend__swatch--night" />
              ночь: плановые не бронируются
            </span>
          </div>
        </>
      )}

      {shiftFormOpen && (
        <ShiftForm
          date={date}
          masters={masters.data ?? []}
          onClose={() => setShiftFormOpen(false)}
          onCreated={reload}
        />
      )}
      {openId !== null && (
        <OrderModal orderId={openId} onClose={() => setOpenId(null)} onChanged={reload} />
      )}
    </>
  );
}
