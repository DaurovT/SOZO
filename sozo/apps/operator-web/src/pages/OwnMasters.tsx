import { useState } from 'react';
import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { request } from '../api';
import { Empty, ErrorState, Loading } from '../components/States';

/**
 * U-05. Свои мастера.
 *
 * Экран отвечает на два вопроса, и оба задают утром: кого сегодня можно
 * нагрузить и кто не выйдет. Поэтому загрузка и отсутствие смены — не
 * дополнительные колонки, а то, ради чего экран открывают.
 *
 * Мастер здесь — тот же мастер платформы, а не отдельная сущность: приложение
 * «Мастер» не форкается (DEV-15 §7.1). Оператор владеет не человеком, а
 * договором с ним, и договоров у человека может быть несколько.
 */

interface MastersData {
  total: number;
  active: number;
  withoutShift: number;
  rows: Array<{
    masterId: string;
    fullName: string;
    phone: string | null;
    platformStatus: string | null;
    status: 'active' | 'suspended' | 'terminated';
    suspendReason: string | null;
    since: string;
    until: string | null;
    skillTags: string[];
    hourlyCostTiyin: number;
    load: {
      date: string;
      hasShift: boolean;
      bookings: number;
      busyMin: number;
      loadPercent: number;
      capReached: boolean;
    };
  }>;
}

const STATUS: Record<string, string> = {
  active: 'работает',
  suspended: 'приостановлен',
  terminated: 'договор прекращён',
};

const sum = (t: number) => `${Math.round(t / 100).toLocaleString('ru-RU')} сум/ч`;

export function OwnMasters() {
  const org = getOrgId();
  const { data, loading, error, reload } = useFetch<MastersData>(org ? `/operator/${org}/masters` : null);
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ fullName: '', phone: '', hourlyCostTiyin: '' });

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  const act = async (path: string, body?: unknown) => {
    setBusy(path);
    setFailed(null);
    try {
      await request(path, { method: 'POST', body: body ?? {} });
      reload();
    } catch (e) {
      setFailed(e instanceof Error ? e.message : 'не получилось');
    } finally {
      setBusy(null);
    }
  };

  const suspend = (masterId: string) => {
    // Причина обязательна и на сервере: приостановленный мастер не выйдет на
    // заявку, и он должен знать, что исправить
    const reason = window.prompt('Причина приостановки — её увидит мастер:');
    if (!reason?.trim()) return;
    void act(`/operator/${org}/masters/${masterId}/suspend`, { reason });
  };

  const hire = async () => {
    await act(`/operator/${org}/masters`, {
      fullName: form.fullName,
      phone: form.phone,
      hourlyCostTiyin: form.hourlyCostTiyin ? Number(form.hourlyCostTiyin) * 100 : 0,
    });
    setForm({ fullName: '', phone: '', hourlyCostTiyin: '' });
    setAdding(false);
  };

  // Работающие сверху, прекращённые вниз: реестр читают ради тех, кто выйдет
  const order = { active: 0, suspended: 1, terminated: 2 } as const;
  const rows = [...data.rows].sort((a, b) => order[a.status] - order[b.status] || a.fullName.localeCompare(b.fullName));

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 'var(--s16)' }}>
        <div style={{ flex: 1 }}>
          <h1 className="h1">Свои мастера</h1>
          <div className="cap" style={{ marginTop: 'var(--s4)' }}>
            {data.active} работают из {data.total}
          </div>
        </div>
        <button type="button" onClick={() => setAdding((v) => !v)}>
          {adding ? 'Отмена' : 'Завести мастера'}
        </button>
      </div>

      {failed && (
        <div className="card" style={{ padding: 'var(--s16)', background: 'rgba(220,50,50,.06)', border: '1px solid rgba(220,50,50,.3)' }}>
          <div className="dense">{failed}</div>
        </div>
      )}

      {adding && (
        <div className="card" style={{ padding: 'var(--s16)' }}>
          <h2 className="h2">Новый мастер</h2>
          <div className="dense cap" style={{ marginTop: 'var(--s4)' }}>
            Если этот телефон уже есть в платформе, человек не заводится заново — к нему
            добавляется договор с вами. Мастер может работать у двух операторов сразу.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 'var(--s16)', marginTop: 'var(--s16)' }}>
            <label className="dense">
              Имя
              <input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="Фамилия Имя"
                style={{ width: '100%' }}
              />
            </label>
            <label className="dense">
              Телефон
              <input
                value={form.phone}
                onChange={(e) => setForm({ ...form, phone: e.target.value })}
                placeholder="+998901234567"
                style={{ width: '100%' }}
              />
            </label>
            <label className="dense">
              Себестоимость часа, сум
              <input
                value={form.hourlyCostTiyin}
                onChange={(e) => setForm({ ...form, hourlyCostTiyin: e.target.value.replace(/\D/g, '') })}
                placeholder="30000"
                style={{ width: '100%' }}
              />
            </label>
          </div>
          <div className="dense cap" style={{ marginTop: 'var(--s8)' }}>
            Ставка нужна платформе только для расчёта себестоимости работ — оклад платите вы.
          </div>
          <button type="button" onClick={() => void hire()} disabled={busy !== null} style={{ marginTop: 'var(--s16)' }}>
            Завести
          </button>
        </div>
      )}

      {data.withoutShift > 0 && (
        <div className="card" style={{ padding: 'var(--s16)', background: 'rgba(240,140,30,.06)', border: '1px solid rgba(240,140,30,.3)' }}>
          <div className="dense">
            <b>У {data.withoutShift} мастеров нет смены на сегодня.</b> Без смены заявка на них
            не встанет — планировщик их просто не увидит.
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        {rows.length === 0 ? (
          <Empty text="Своих мастеров пока нет — заявки по общему имуществу выполнять некому" />
        ) : (
          <table>
            <thead>
              <tr>
                <th>Мастер</th><th>Навыки</th><th>Ставка</th><th>Загрузка сегодня</th><th>Статус</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.masterId}>
                  <td>
                    <div style={{ fontWeight: 600 }}>{r.fullName}</div>
                    <div className="cap">{r.phone ?? '—'}</div>
                  </td>
                  <td className="dense">{r.skillTags.length ? r.skillTags.join(', ') : '—'}</td>
                  <td className="num">{r.hourlyCostTiyin ? sum(r.hourlyCostTiyin) : '—'}</td>
                  <td>
                    {!r.load.hasShift ? (
                      <span style={{ color: 'var(--error)' }}>нет смены</span>
                    ) : (
                      <span style={{ color: r.load.capReached ? 'var(--error)' : undefined }}>
                        {r.load.loadPercent}% · {r.load.bookings} зая{r.load.bookings === 1 ? 'вка' : 'вок'}
                      </span>
                    )}
                  </td>
                  <td>
                    {STATUS[r.status]}
                    {r.status === 'suspended' && r.suspendReason && (
                      <div className="cap">{r.suspendReason}</div>
                    )}
                  </td>
                  <td>
                    {r.status === 'active' && (
                      <button type="button" onClick={() => suspend(r.masterId)} disabled={busy !== null}>
                        Приостановить
                      </button>
                    )}
                    {r.status === 'suspended' && (
                      <button
                        type="button"
                        onClick={() => void act(`/operator/${org}/masters/${r.masterId}/resume`)}
                        disabled={busy !== null}
                      >
                        Вернуть
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
