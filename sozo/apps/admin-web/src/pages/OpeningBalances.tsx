import { FormEvent, useState } from 'react';
import { api, ApiError } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime, formatSoums, soumsToTiyin } from '../format';
import { postWithSecondAdmin } from '../secondAdmin';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { BillingAccount, OpeningBalancesResult } from '../types';

interface EntryRow {
  account: string;
  side: 'debit' | 'credit';
  soums: string;
  comment: string;
}

const EMPTY_ROW: EntryRow = { account: '', side: 'debit', soums: '', comment: '' };

/** A-32: стартовые остатки — однократно, двойное подтверждение (админ + бухгалтер). */
export function OpeningBalancesPage() {
  const toast = useToast();
  const { data: accounts, loading, error } = useFetch<BillingAccount[]>(() =>
    api.get<BillingAccount[]>('/admin/billing/accounts'),
  );
  const [rows, setRows] = useState<EntryRow[]>([{ ...EMPTY_ROW }]);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [result, setResult] = useState<OpeningBalancesResult | null>(null);

  const setRow = (idx: number, patch: Partial<EntryRow>) => {
    setRows((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const totalBy = (side: 'debit' | 'credit') =>
    rows
      .filter((r) => r.side === side)
      .reduce((s, r) => s + soumsToTiyin(Number(r.soums) || 0), 0);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const entries = rows
      .filter((r) => r.account !== '' && (Number(r.soums) || 0) > 0)
      .map((r) => ({
        account: r.account,
        side: r.side,
        amountTiyin: soumsToTiyin(Number(r.soums)),
        comment: r.comment.trim() || undefined,
      }));
    if (entries.length === 0) {
      setActionError('Добавьте хотя бы одну строку со счётом и суммой');
      return;
    }
    setBusy(true);
    setActionError(null);
    try {
      const res = await postWithSecondAdmin<OpeningBalancesResult>(
        '/admin/billing/opening-balances',
        { entries },
        'Стартовые остатки вносятся однократно и требуют подтверждения второго админа (бухгалтера). Подтвердить?',
      );
      if (res !== null) {
        setResult(res);
        toast('Стартовые остатки внесены');
      }
    } catch (err) {
      if (err instanceof ApiError && err.code === 'OPENING_ALREADY_DONE') {
        setActionError('Остатки уже внесены');
      } else {
        setActionError(err instanceof Error ? err.message : String(err));
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const accs = accounts ?? [];
  const totalDebit = totalBy('debit');
  const totalCredit = totalBy('credit');

  return (
    <>
      <div className="page-header">
        <h1>Стартовые остатки</h1>
      </div>

      <div className="banner">
        Вносятся однократно при запуске (идемпотентность A-32). Каждая строка — проводка против
        технического счёта «opening».
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      {result !== null && (
        <div className={result.balanceCheck.ok ? 'banner banner--success' : 'banner banner--error'}>
          Остатки внесены (строк: {result.entries}). Баланс-чекер:{' '}
          {result.balanceCheck.ok
            ? `сходится, Дт ${formatSoums(result.balanceCheck.totalDebitTiyin)} = Кт ${formatSoums(result.balanceCheck.totalCreditTiyin)}`
            : `РАСХОЖДЕНИЕ ${formatSoums(result.balanceCheck.discrepancyTiyin)}`}{' '}
          · проводок: {result.balanceCheck.txCount} · проверено{' '}
          {formatDateTime(result.balanceCheck.checkedAt)}
        </div>
      )}

      <form className="card" onSubmit={submit}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--s8)' }}>
          {rows.map((r, idx) => (
            <div
              key={idx}
              style={{ display: 'flex', alignItems: 'center', gap: 'var(--s8)', flexWrap: 'wrap' }}
            >
              <select
                className="cell-select"
                style={{ minWidth: 260 }}
                value={r.account}
                onChange={(e) => setRow(idx, { account: e.target.value })}
                aria-label="Счёт"
              >
                <option value="" disabled>
                  — выберите счёт —
                </option>
                {accs.map((a) => (
                  <option key={a.code} value={a.code}>
                    {a.name} ({a.code})
                  </option>
                ))}
              </select>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
                <input
                  type="radio"
                  name={`side-${idx}`}
                  checked={r.side === 'debit'}
                  onChange={() => setRow(idx, { side: 'debit' })}
                />
                Дт
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 'var(--s4)' }}>
                <input
                  type="radio"
                  name={`side-${idx}`}
                  checked={r.side === 'credit'}
                  onChange={() => setRow(idx, { side: 'credit' })}
                />
                Кт
              </label>
              <input
                className="cell-input"
                inputMode="numeric"
                placeholder="Сумма, сум"
                value={r.soums}
                onChange={(e) => setRow(idx, { soums: e.target.value.replace(/[^\d]/g, '') })}
              />
              <input
                className="cell-input"
                style={{ width: 240 }}
                placeholder="Комментарий"
                value={r.comment}
                onChange={(e) => setRow(idx, { comment: e.target.value })}
              />
              {rows.length > 1 && (
                <button
                  type="button"
                  className="btn btn--link"
                  onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}
                >
                  Убрать
                </button>
              )}
            </div>
          ))}
        </div>

        <div style={{ marginTop: 'var(--s12)' }}>
          <button
            type="button"
            className="btn btn--link"
            onClick={() => setRows((prev) => [...prev, { ...EMPTY_ROW }])}
          >
            + строка
          </button>
        </div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginTop: 'var(--s16)',
          }}
        >
          <div className="num">
            Итого Дт: <span className="semibold">{formatSoums(totalDebit)}</span> · Итого Кт:{' '}
            <span className="semibold">{formatSoums(totalCredit)}</span>
          </div>
          <button type="submit" className="btn btn--primary" disabled={busy || result !== null}>
            Внести остатки
          </button>
        </div>
      </form>
    </>
  );
}
