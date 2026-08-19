import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api';
import {
  DAY_PLAN_CAP,
  FREEZE_MINUTES,
  ROAD_BUFFER_PERCENT,
  SLOT_MINUTES,
} from '../dicts';
import { formatMinutes, plusDaysISO, slotsWord, todayISO } from '../format';
import type { Lane, LaneBooking, LanesResponse, ReleaseResult, WindowsResponse } from '../types';
import { ErrorBanner, Loading } from './States';
import { useToast } from './Toast';

interface SlotTabProps {
  orderId: string;
  onChanged: () => void;
}

interface BookedSlot {
  date: string;
  lane: Lane;
  booking: LaneBooking;
}

/** Заморозка и потолок дня снимаются только явным подтверждением диспетчера. */
const FORCEABLE = new Set(['LANE_FROZEN', 'DAY_PLAN_CAP']);

function errorMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : e instanceof Error ? e.message : String(e);
}

/**
 * Вкладка «Слот» карточки заявки (D-06 × D-05): бронь мастера на реально доступное окно.
 * Брони по заявке отдельного эндпоинта нет — ищем её в лентах на сегодня и завтра.
 */
export function SlotTab({ orderId, onChanged }: SlotTabProps) {
  const toast = useToast();
  const [booked, setBooked] = useState<BookedSlot | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [date, setDate] = useState(todayISO());
  const [windows, setWindows] = useState<WindowsResponse | null>(null);
  const [lanes, setLanes] = useState<Lane[]>([]);
  const [startMin, setStartMin] = useState<number | null>(null);
  const [masterId, setMasterId] = useState('');

  const findBooking = useCallback(async (): Promise<BookedSlot | null> => {
    for (const d of [todayISO(), plusDaysISO(todayISO(), 1)]) {
      const res = await api.get<LanesResponse>(`/dispatch/scheduling/lanes?date=${d}`);
      for (const lane of res.lanes) {
        const booking = lane.bookings.find((b) => b.orderId === orderId);
        if (booking) return { date: d, lane, booking };
      }
    }
    return null;
  }, [orderId]);

  const reloadBooking = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setBooked(await findBooking());
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setLoading(false);
    }
  }, [findBooking]);

  useEffect(() => {
    void reloadBooking();
  }, [reloadBooking]);

  // Окна и ленты выбранной даты нужны только когда брони ещё нет.
  useEffect(() => {
    if (booked !== null || loading) return undefined;
    let cancelled = false;
    setStartMin(null);
    setMasterId('');
    Promise.all([
      api.get<WindowsResponse>(`/dispatch/scheduling/windows?orderId=${orderId}&date=${date}`),
      api.get<LanesResponse>(`/dispatch/scheduling/lanes?date=${date}`),
    ])
      .then(([w, l]) => {
        if (cancelled) return;
        setWindows(w);
        setLanes(l.lanes);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(errorMessage(e));
      });
    return () => {
      cancelled = true;
    };
  }, [orderId, date, booked, loading]);

  const book = async (force: boolean) => {
    if (startMin === null || masterId === '') return;
    setBusy(true);
    setError(null);
    try {
      await api.post('/dispatch/scheduling/bookings', {
        orderId,
        masterId,
        date,
        startMin,
        ...(force ? { force: true } : {}),
      });
      toast(`Забронировано на ${date}, ${formatMinutes(startMin)}`);
      await reloadBooking();
      onChanged();
    } catch (e) {
      const code = e instanceof ApiError ? e.code : undefined;
      if (!force && code !== undefined && FORCEABLE.has(code)) {
        const ok = window.confirm(
          `${errorMessage(e)}\n\nВы трогаете горячую зону. Забронировать всё равно?`,
        );
        if (ok) {
          setBusy(false);
          await book(true);
          return;
        }
      }
      // NO_SHIFT | OUT_OF_SHIFT | SLOT_BUSY | ALREADY_BOOKED — красная плашка с message.
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const release = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await api.del<ReleaseResult>(`/dispatch/scheduling/bookings/${orderId}`);
      toast(
        res.nextCandidate
          ? `Слот освободился, предложить ${res.nextCandidate.orderNumber}`
          : 'Бронь снята',
      );
      await reloadBooking();
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const addToWaitlist = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post('/dispatch/scheduling/waitlist', { orderId });
      toast('Заявка в листе ожидания');
      onChanged();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;

  // Окно, выбранное диспетчером — его 2-часовую подпись увидит клиент.
  const selectedWindow =
    startMin === null ? null : (windows?.windows.find((w) => w.startMin === startMin) ?? null);

  return (
    <>
      {error !== null && <ErrorBanner message={error} />}

      {booked !== null ? (
        <>
          <div className="banner">
            Забронировано: {booked.lane.masterName}, {booked.date} {booked.booking.start}–
            {booked.booking.end}, окно клиента {booked.booking.clientWindowText}
          </div>
          <dl className="kv">
            <dt>Нормо-часы</dt>
            <dd>
              {booked.booking.normHours} ч · дорожный буфер {booked.booking.bufferMin} мин · слотов{' '}
              {booked.booking.slots}
            </dd>
            <dt>Тип брони</dt>
            <dd>{booked.booking.anchored ? 'якорная (жёсткое окно)' : 'гибкая'}</dd>
            <dt>Зона мастера</dt>
            <dd>{booked.lane.zone ?? '—'}</dd>
          </dl>
          <div className="actions-row" style={{ marginTop: 'var(--s16)' }}>
            <button type="button" className="btn" disabled={busy} onClick={release}>
              Снять бронь
            </button>
          </div>
          <div className="tab-note">
            Подтверждённая бронь не ломается автоматикой — только руками диспетчера (ТЗ 17.3).
          </div>
        </>
      ) : (
        <>
          <div className="actions-row">
            <button type="button" className="btn" onClick={() => setDate(todayISO())}>
              Сегодня
            </button>
            <button
              type="button"
              className="btn"
              onClick={() => setDate(plusDaysISO(todayISO(), 1))}
            >
              Завтра
            </button>
            <div className="field">
              <input
                type="date"
                aria-label="Дата брони"
                value={date}
                onChange={(e) => setDate(e.target.value || todayISO())}
              />
            </div>
          </div>

          {windows !== null && (
            <>
              <div className="slot-calc">
                Работа {windows.normHours} ч + буфер {ROAD_BUFFER_PERCENT}% ={' '}
                {windows.slotsNeeded * SLOT_MINUTES} мин → {windows.slotsNeeded}{' '}
                {slotsWord(windows.slotsNeeded)} по {SLOT_MINUTES} мин
                {windows.normHoursAssumed && (
                  <span className="badge badge--warning" style={{ marginLeft: 'var(--s8)' }}>
                    нормо-часы в прайсе не заполнены, взята оценка {windows.normHours} ч
                  </span>
                )}
              </div>

              <div className="section-title">Доступные окна на {windows.date}</div>
              {windows.windows.length === 0 ? (
                <div className="slot-empty">
                  <div>Свободных окон нет. Возможные причины:</div>
                  <ul className="slot-empty__list">
                    <li>нет смен на дату (создайте на экране «Ленты мастеров»)</li>
                    <li>
                      все ленты загружены до потолка {Math.round(DAY_PLAN_CAP * 100)}%
                    </li>
                    <li>
                      остаток дня в зоне заморозки {FREEZE_MINUTES / 60} ч
                    </li>
                    <li>ночное время: с 22:00 до 07:00 плановые не бронируются</li>
                  </ul>
                  <div className="muted">
                    Что можно сделать: выбрать другую дату или поставить заявку в лист ожидания
                  </div>
                </div>
              ) : (
                <div className="slot-windows">
                  {windows.windows.map((w) => (
                    <button
                      key={w.startMin}
                      type="button"
                      className={
                        startMin === w.startMin ? 'btn slot-window slot-window--active' : 'btn slot-window'
                      }
                      onClick={() => setStartMin(w.startMin)}
                    >
                      <span className="slot-window__label">{w.label}</span>
                      <span className="slot-window__hint">
                        свободно мастеров: {w.mastersAvailable}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {startMin !== null && (
                <div className="form-grid" style={{ marginTop: 'var(--s16)' }}>
                  <div className="field">
                    <label htmlFor="slot-master">Мастер (со сменой на {date})</label>
                    <select
                      id="slot-master"
                      value={masterId}
                      onChange={(e) => setMasterId(e.target.value)}
                    >
                      <option value="">— выберите мастера —</option>
                      {lanes.map((l) => (
                        <option key={l.masterId} value={l.masterId} disabled={l.capReached}>
                          {l.masterName} — загрузка {l.loadPercent}%
                          {l.capReached ? ' · потолок' : ''}
                          {l.isDuty ? ' · дежурный' : ''} · {l.zone ?? 'зона не указана'}
                        </option>
                      ))}
                    </select>
                    <div className="tab-note">
                      Ленты, упёршиеся в потолок {Math.round(DAY_PLAN_CAP * 100)}% смены, недоступны
                      для новых плановых заявок
                    </div>
                  </div>
                  <div className="actions-row">
                    <button
                      type="button"
                      className="btn btn--primary"
                      disabled={busy || masterId === ''}
                      onClick={() => book(false)}
                    >
                      Забронировать {formatMinutes(startMin)}
                    </button>
                  </div>
                  <div className="tab-note" style={{ marginTop: 0 }}>
                    Клиент увидит окно {selectedWindow?.label ?? formatMinutes(startMin)}; мастер
                    получит бронь на {windows.slotsNeeded} {slotsWord(windows.slotsNeeded)}
                  </div>
                </div>
              )}
            </>
          )}

          <div className="section-title">Лист ожидания</div>
          <div className="actions-row">
            <button type="button" className="btn" disabled={busy} onClick={addToWaitlist}>
              В лист ожидания
            </button>
            <span className="muted">
              бесплатное ожидание свободной ёмкости (ТЗ 17.3)
            </span>
          </div>
        </>
      )}
    </>
  );
}
