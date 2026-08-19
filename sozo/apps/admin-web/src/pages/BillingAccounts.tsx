import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums, soumsToTiyin } from '../format';
import { postWithSecondAdmin } from '../secondAdmin';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { AccountKind, BalanceCheck, BillingAccount, BillingTransaction } from '../types';

const KIND_LABELS: Record<AccountKind, string> = {
  asset: 'Актив',
  liability: 'Обязательство',
  income: 'Доход',
  expense: 'Расход',
};

interface PageData {
  accounts: BillingAccount[];
  transactions: BillingTransaction[];
}

export function BillingAccountsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<PageData>(async () => {
    const [accounts, transactions] = await Promise.all([
      api.get<BillingAccount[]>('/admin/billing/accounts'),
      api.get<BillingTransaction[]>('/admin/billing/transactions'),
    ]);
    return { accounts, transactions };
  });

  const [check, setCheck] = useState<BalanceCheck | null>(null);
  const [checkBusy, setCheckBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [manualOpen, setManualOpen] = useState(false);
  const [manualDebit, setManualDebit] = useState('');
  const [manualCredit, setManualCredit] = useState('');
  const [manualSoums, setManualSoums] = useState('');
  const [manualComment, setManualComment] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [stornoTx, setStornoTx] = useState<BillingTransaction | null>(null);
  const [stornoComment, setStornoComment] = useState('');

  const runCheck = async () => {
    setCheckBusy(true);
    setActionError(null);
    try {
      setCheck(await api.get<BalanceCheck>('/admin/billing/balance-check'));
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setCheckBusy(false);
    }
  };

  const submitManual = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const done = await postWithSecondAdmin(
        '/admin/billing/transactions',
        {
          debit: manualDebit,
          credit: manualCredit,
          amountTiyin: soumsToTiyin(Number(manualSoums) || 0),
          comment: manualComment.trim(),
        },
        'Ручная проводка требует двойного подтверждения. Подтвердить?',
      );
      if (done !== null) {
        toast('Проводка создана');
        setManualOpen(false);
        setManualDebit('');
        setManualCredit('');
        setManualSoums('');
        setManualComment('');
        reload();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const submitStorno = async (e: FormEvent) => {
    e.preventDefault();
    if (!stornoTx) return;
    setBusy(true);
    setFormError(null);
    try {
      const done = await postWithSecondAdmin(
        `/admin/billing/transactions/${stornoTx.id}/storno`,
        { comment: stornoComment.trim() },
        'Сторнирование проводки требует двойного подтверждения. Подтвердить?',
      );
      if (done !== null) {
        toast('Проводка сторнирована');
        setStornoTx(null);
        setStornoComment('');
        reload();
      }
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { accounts, transactions } = data;
  const accountNames = new Map(accounts.map((a) => [a.code, a.name]));
  const accName = (code: string) => accountNames.get(code) ?? code;
  const reversedIds = new Set(
    transactions.filter((t) => t.reversedTxId != null).map((t) => t.reversedTxId as string),
  );

  return (
    <>
      <div className="page-header">
        <h1>Балансы и проводки</h1>
        <div style={{ display: 'flex', gap: 'var(--s8)' }}>
          <button type="button" className="btn" disabled={checkBusy} onClick={() => void runCheck()}>
            Проверить сейчас
          </button>
          <button type="button" className="btn btn--primary" onClick={() => setManualOpen(true)}>
            Ручная проводка
          </button>
        </div>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      {check !== null &&
        (check.ok ? (
          <div className="banner banner--success">
            Баланс сходится: Дт {formatSoums(check.totalDebitTiyin)} = Кт{' '}
            {formatSoums(check.totalCreditTiyin)} · проводок: {check.txCount} · проверено{' '}
            {formatDateTime(check.checkedAt)}
          </div>
        ) : (
          <div className="banner banner--error">
            РАСХОЖДЕНИЕ {formatSoums(check.discrepancyTiyin)}: Дт{' '}
            {formatSoums(check.totalDebitTiyin)} ≠ Кт {formatSoums(check.totalCreditTiyin)} ·
            проводок: {check.txCount} · проверено {formatDateTime(check.checkedAt)}
          </div>
        ))}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Код</th>
              <th>Название</th>
              <th>Тип</th>
              <th className="num">Баланс</th>
            </tr>
          </thead>
          <tbody>
            {accounts.length === 0 && <EmptyRow colSpan={4} />}
            {accounts.map((a) => (
              <tr key={a.code}>
                <td className="mono">{a.code}</td>
                <td>{a.name}</td>
                <td className="muted">{KIND_LABELS[a.kind] ?? a.kind}</td>
                <td className={a.balanceTiyin < 0 ? 'num neg' : 'num'}>
                  {formatSoums(a.balanceTiyin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Журнал проводок</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Время</th>
              <th>Тип</th>
              <th>Дт → Кт</th>
              <th className="num">Сумма</th>
              <th>Комментарий</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {transactions.length === 0 && <EmptyRow colSpan={6} />}
            {transactions.map((t) => (
              <tr key={t.id}>
                <td className="num">{formatDateTime(t.createdAt)}</td>
                <td className="mono">{t.type}</td>
                <td>
                  {accName(t.debit)} → {accName(t.credit)}
                </td>
                <td className="num">{formatSoums(t.amountTiyin)}</td>
                <td>
                  {t.isStorno && (
                    <span className="badge badge--error" style={{ marginRight: 'var(--s4)' }}>
                      Сторно
                    </span>
                  )}
                  {t.comment}
                </td>
                <td>
                  {!t.isStorno && !reversedIds.has(t.id) && (
                    <button
                      type="button"
                      className="btn btn--link"
                      onClick={() => {
                        setFormError(null);
                        setStornoComment('');
                        setStornoTx(t);
                      }}
                    >
                      Сторно
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {manualOpen && (
        <Modal title="Ручная проводка" onClose={() => setManualOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submitManual}>
            <div className="field">
              <label htmlFor="tx-debit">Дебет</label>
              <select
                id="tx-debit"
                value={manualDebit}
                onChange={(e) => setManualDebit(e.target.value)}
                required
              >
                <option value="" disabled>
                  — выберите счёт —
                </option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name} ({a.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tx-credit">Кредит</label>
              <select
                id="tx-credit"
                value={manualCredit}
                onChange={(e) => setManualCredit(e.target.value)}
                required
              >
                <option value="" disabled>
                  — выберите счёт —
                </option>
                {accounts.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name} ({a.code})
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label htmlFor="tx-amount">Сумма, сум</label>
              <input
                id="tx-amount"
                inputMode="numeric"
                value={manualSoums}
                onChange={(e) => setManualSoums(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="tx-comment">Комментарий</label>
              <input
                id="tx-comment"
                value={manualComment}
                onChange={(e) => setManualComment(e.target.value)}
                required
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setManualOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Провести
              </button>
            </div>
          </form>
        </Modal>
      )}

      {stornoTx !== null && (
        <Modal title={`Сторно проводки ${formatSoums(stornoTx.amountTiyin)}`} onClose={() => setStornoTx(null)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <p className="muted" style={{ marginTop: 0 }}>
            {accName(stornoTx.debit)} → {accName(stornoTx.credit)} · {stornoTx.comment}
          </p>
          <form className="form-grid" onSubmit={submitStorno}>
            <div className="field">
              <label htmlFor="storno-comment">Причина сторно</label>
              <input
                id="storno-comment"
                value={stornoComment}
                onChange={(e) => setStornoComment(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setStornoTx(null)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Сторнировать
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
