import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums, soumsToTiyin } from '../format';
import { postWithSecondAdmin } from '../secondAdmin';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { BillingAccount, DamageCase, DamageCaseStatus, Master } from '../types';

const STATUS_META: Record<DamageCaseStatus, { label: string; variant: string }> = {
  filed: { label: 'Подано', variant: 'warning' },
  review: { label: 'Разбор', variant: 'warning' },
  approved: { label: 'Утверждено', variant: 'accent' },
  rejected: { label: 'Отклонено', variant: 'muted' },
  paid: { label: 'Выплачено', variant: 'success' },
};

interface PageData {
  cases: DamageCase[];
  fundTiyin: number;
}

/** A-20: резервный фонд ущербов (ТЗ 17.7) — дела, резолюции, выплаты с регрессом ≤30%. */
export function ReserveFundPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<PageData>(async () => {
    const [cases, accounts] = await Promise.all([
      api.get<DamageCase[]>('/admin/reserve-fund/cases'),
      api.get<BillingAccount[]>('/admin/billing/accounts'),
    ]);
    return {
      cases,
      fundTiyin: accounts.find((a) => a.code === 'reserve_fund')?.balanceTiyin ?? 0,
    };
  });
  const { data: masters } = useFetch<Master[]>(() => api.get<Master[]>('/admin/masters'));

  const [actionError, setActionError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [createOpen, setCreateOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [claimantName, setClaimantName] = useState('');
  const [amountSoums, setAmountSoums] = useState('');
  const [masterId, setMasterId] = useState('');

  const [resolveCase, setResolveCase] = useState<DamageCase | null>(null);
  const [approve, setApprove] = useState(true);
  const [regressSoums, setRegressSoums] = useState('');
  const [resolution, setResolution] = useState('');

  const createCase = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const master = masters?.find((m) => m.id === masterId);
      await api.post('/admin/reserve-fund/cases', {
        description: description.trim(),
        claimantName: claimantName.trim(),
        amountTiyin: soumsToTiyin(Number(amountSoums) || 0),
        ...(masterId !== '' ? { masterId, masterName: master?.fullName } : {}),
      });
      toast('Дело заведено');
      setCreateOpen(false);
      setDescription('');
      setClaimantName('');
      setAmountSoums('');
      setMasterId('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitResolve = async (e: FormEvent) => {
    e.preventDefault();
    if (!resolveCase) return;
    setBusy(true);
    setFormError(null);
    try {
      await api.post(`/admin/reserve-fund/cases/${resolveCase.id}/resolve`, {
        approve,
        ...(approve ? { regressTiyin: soumsToTiyin(Number(regressSoums) || 0) } : {}),
        resolution: resolution.trim(),
      });
      toast(approve ? 'Дело утверждено' : 'Дело отклонено');
      setResolveCase(null);
      setRegressSoums('');
      setResolution('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pay = async (c: DamageCase) => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await postWithSecondAdmin(
        `/admin/reserve-fund/cases/${c.id}/pay`,
        {},
        'Выплата из фонда ущербов требует двойного подтверждения. Подтвердить?',
      );
      if (res !== null) {
        toast(`Выплачено ${formatSoums(c.amountTiyin)}`);
        reload();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  return (
    <>
      <div className="page-header">
        <h1>Резервный фонд ущербов</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setFormError(null);
            setCreateOpen(true);
          }}
        >
          Новое дело
        </button>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      <div className="tiles">
        <div className="card">
          <div className="tile__value">{formatSoums(data.fundTiyin)}</div>
          <div className="tile__label">Резервный фонд</div>
          <div className="tile__hint">Копится проводкой 1.5% от выручки</div>
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Описание</th>
              <th>Заявитель</th>
              <th className="num">Сумма</th>
              <th className="num">Регресс</th>
              <th>Мастер</th>
              <th>Статус</th>
              <th>Резолюция</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.cases.length === 0 && <EmptyRow colSpan={9} />}
            {data.cases.map((c) => (
              <tr key={c.id}>
                <td className="num">{formatDateTime(c.createdAt)}</td>
                <td>{c.description}</td>
                <td>{c.claimantName || '—'}</td>
                <td className="num">{formatSoums(c.amountTiyin)}</td>
                <td className="num">{c.regressTiyin > 0 ? formatSoums(c.regressTiyin) : '—'}</td>
                <td>{c.masterName ?? '—'}</td>
                <td>
                  <span className={`badge badge--${STATUS_META[c.status].variant}`}>
                    {STATUS_META[c.status].label}
                  </span>
                </td>
                <td className="muted">{c.resolution || '—'}</td>
                <td className="num">
                  {(c.status === 'filed' || c.status === 'review') && (
                    <button
                      type="button"
                      className="btn btn--link"
                      onClick={() => {
                        setFormError(null);
                        setApprove(true);
                        setRegressSoums('');
                        setResolution('');
                        setResolveCase(c);
                      }}
                    >
                      Резолюция
                    </button>
                  )}
                  {c.status === 'approved' && (
                    <button
                      type="button"
                      className="btn btn--link"
                      disabled={busy}
                      onClick={() => void pay(c)}
                    >
                      Выплатить
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {createOpen && (
        <Modal title="Новое дело об ущербе" onClose={() => setCreateOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={createCase}>
            <div className="field">
              <label htmlFor="rf-desc">Описание</label>
              <textarea
                id="rf-desc"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="rf-claimant">Заявитель</label>
              <input
                id="rf-claimant"
                value={claimantName}
                onChange={(e) => setClaimantName(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="rf-amount">Сумма ущерба, сум</label>
              <input
                id="rf-amount"
                inputMode="numeric"
                value={amountSoums}
                onChange={(e) => setAmountSoums(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="rf-master">Мастер (опционально)</label>
              <select id="rf-master" value={masterId} onChange={(e) => setMasterId(e.target.value)}>
                <option value="">— не указан —</option>
                {(masters ?? []).map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.fullName}
                  </option>
                ))}
              </select>
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Завести дело
              </button>
            </div>
          </form>
        </Modal>
      )}

      {resolveCase !== null && (
        <Modal
          title={`Резолюция: ${formatSoums(resolveCase.amountTiyin)}`}
          onClose={() => setResolveCase(null)}
        >
          {formError !== null && <ErrorBanner message={formError} />}
          <p className="muted" style={{ marginTop: 0 }}>
            {resolveCase.description}
          </p>
          <form className="form-grid" onSubmit={submitResolve}>
            <div className="field field--checkbox">
              <input
                id="rf-approve"
                type="radio"
                name="rf-decision"
                checked={approve}
                onChange={() => setApprove(true)}
              />
              <label htmlFor="rf-approve" style={{ margin: 0 }}>
                Утвердить выплату
              </label>
            </div>
            <div className="field field--checkbox">
              <input
                id="rf-reject"
                type="radio"
                name="rf-decision"
                checked={!approve}
                onChange={() => setApprove(false)}
              />
              <label htmlFor="rf-reject" style={{ margin: 0 }}>
                Отклонить
              </label>
            </div>
            {approve && (
              <div className="field">
                <label htmlFor="rf-regress">Регресс к мастеру, сум</label>
                <input
                  id="rf-regress"
                  inputMode="numeric"
                  value={regressSoums}
                  onChange={(e) => setRegressSoums(e.target.value.replace(/[^\d]/g, ''))}
                />
                <div className="muted" style={{ fontSize: 12, marginTop: 'var(--s4)' }}>
                  Не более 30% суммы — сервер ограничит (ТЗ 17.7)
                </div>
              </div>
            )}
            <div className="field">
              <label htmlFor="rf-resolution">Текст резолюции</label>
              <textarea
                id="rf-resolution"
                value={resolution}
                onChange={(e) => setResolution(e.target.value)}
                required
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setResolveCase(null)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Сохранить резолюцию
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
