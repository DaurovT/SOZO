import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, plural } from '../format';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';

/** Срабатывание таймера (PRD-05 §8) */
interface TimerRun {
  id: string;
  timer: string;
  title: string;
  result: string;
  affected: number;
  at: string;
  simulated: boolean;
}

interface SchedulerState {
  dayOffset: number;
  virtualNow: string;
  runsTotal: number;
  lastRunAt: string | null;
  runs: TimerRun[];
}

const RUNS_WORD = ['таймер', 'таймера', 'таймеров'] as const;
const DAYS_WORD = ['день', 'дня', 'дней'] as const;

/** A-34: движок таймеров — состояние виртуальных часов, ручной прогон, симуляция дней, история. */
export function SchedulerPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<SchedulerState>(() =>
    api.get<SchedulerState>('/admin/scheduler'),
  );

  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [days, setDays] = useState('7');

  const runNow = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const runs = await api.post<TimerRun[]>('/admin/scheduler/run');
      toast(`Сработало ${plural(runs.length, ...RUNS_WORD)}`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const simulate = async () => {
    const n = Math.max(1, Math.min(Number(days) || 1, 60));
    setBusy(true);
    setActionError(null);
    try {
      const res = await api.post<{ days: number; runs: TimerRun[] }>('/admin/scheduler/simulate', {
        days: n,
      });
      toast(
        `Симуляция ${plural(res.days, ...DAYS_WORD)}: сработало ${plural(res.runs.length, ...RUNS_WORD)}`,
      );
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const resetClock = async () => {
    if (!window.confirm('Сбросить виртуальные часы к реальному времени?')) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post('/admin/scheduler/reset-clock');
      toast('Часы сброшены');
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const simulation = data.dayOffset > 0;

  return (
    <>
      <div className="page-header">
        <h1>Планировщик</h1>
        <span className="muted">движок таймеров и эскалаций (PRD-05 §8)</span>
      </div>

      <div className="banner">
        Движок таймеров PRD-05 §8 (54 таймера). Реализованы: снятие наценки «Срочно» через 3 ч (#22),
        эскалация утверждений T+24/48 и авто-отмена T+72 (#7–9), напоминания об оплате T+24/72
        (#13–14), начисление абоненток 1-го числа (#15), приостановка при неоплате к 10-му, дунинг
        T+3/7/10/30/60 (#15–17), баланс-чекер (#42). В проде — BullMQ с ретраями и DLQ.
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      <div className="tiles">
        <div className="card">
          <div className="tile__value tile__value--sm">
            {formatDateTime(data.virtualNow).replace(',', '')}
          </div>
          <div className="tile__label">Виртуальная дата</div>
        </div>
        <div className={simulation ? 'card card--warning' : 'card'}>
          <div className="tile__value">{plural(data.dayOffset, ...DAYS_WORD)}</div>
          <div className="tile__label">Смещение</div>
          {simulation && <div className="tile__hint">включена симуляция времени</div>}
        </div>
        <div className="card">
          <div className="tile__value">{data.runsTotal}</div>
          <div className="tile__label">Всего срабатываний</div>
        </div>
        <div className="card">
          <div className="tile__value tile__value--sm">{formatDateTime(data.lastRunAt)}</div>
          <div className="tile__label">Последний прогон</div>
        </div>
      </div>

      <div className="card">
        <div
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--s8)', flexWrap: 'wrap' }}
        >
          <button
            type="button"
            className="btn btn--primary"
            disabled={busy}
            onClick={() => void runNow()}
          >
            Прогнать таймеры сейчас
          </button>
          <label htmlFor="sch-days" className="muted" style={{ marginLeft: 'var(--s8)' }}>
            дней
          </label>
          <input
            id="sch-days"
            className="cell-input"
            style={{ width: 64 }}
            type="number"
            min={1}
            max={60}
            value={days}
            onChange={(e) => setDays(e.target.value)}
          />
          <button type="button" className="btn" disabled={busy} onClick={() => void simulate()}>
            Симулировать {Math.max(1, Math.min(Number(days) || 1, 60))} дней
          </button>
          <button
            type="button"
            className="btn btn--secondary"
            disabled={busy}
            onClick={() => void resetClock()}
          >
            Сбросить часы
          </button>
        </div>
      </div>

      <div className="section-title">История срабатываний</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Таймер</th>
              <th>Название</th>
              <th>Результат</th>
              <th className="num">Затронуто</th>
              <th>Время</th>
              <th>Режим</th>
            </tr>
          </thead>
          <tbody>
            {data.runs.length === 0 && <EmptyRow colSpan={6} />}
            {data.runs.map((r) => (
              <tr key={r.id}>
                <td className="mono">{r.timer}</td>
                <td>{r.title}</td>
                <td className="muted">{r.result}</td>
                <td className={r.affected > 0 ? 'num semibold' : 'num'}>{r.affected}</td>
                <td className="num">{formatDateTime(r.at)}</td>
                <td>
                  {r.simulated && <span className="badge badge--muted">симуляция</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="muted" style={{ marginTop: 'var(--s12)' }}>
        <Link to="/mock/timers">Полный список 54 таймеров</Link>
      </p>
    </>
  );
}
