import { FormEvent, useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDate, formatDateTime, formatSoums, soumsToTiyin } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { LoyaltyAccount, LoyaltyOperation, Voucher } from '../types';

const KIND_LABELS: Record<LoyaltyOperation['kind'], string> = {
  accrual: 'Начисление',
  voucher: 'Ваучер',
  storno: 'Сторно',
};

function lastOperation(acc: LoyaltyAccount): LoyaltyOperation | undefined {
  return acc.history[acc.history.length - 1];
}

/** A-36: баллы персонала точек и пул ваучеров (ТЗ 17.14). */
export function LoyaltyPage() {
  const toast = useToast();
  const accounts = useFetch<LoyaltyAccount[]>(() =>
    api.get<LoyaltyAccount[]>('/admin/loyalty/accounts'),
  );
  const vouchers = useFetch<Voucher[]>(() => api.get<Voucher[]>('/admin/loyalty/vouchers'));

  const [historyAccount, setHistoryAccount] = useState<LoyaltyAccount | null>(null);
  const [voucherModalOpen, setVoucherModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [vCode, setVCode] = useState('');
  const [vNominal, setVNominal] = useState('100000');
  const [vExpiresAt, setVExpiresAt] = useState('');

  const submitVoucher = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/loyalty/vouchers', {
        code: vCode.trim(),
        nominalTiyin: soumsToTiyin(Number(vNominal)),
        expiresAt: vExpiresAt,
      });
      toast('Ваучер добавлен в пул');
      setVoucherModalOpen(false);
      setVCode('');
      setVNominal('100000');
      setVExpiresAt('');
      vouchers.reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (accounts.loading || vouchers.loading) return <Loading />;
  if (accounts.error !== null) return <ErrorBanner message={accounts.error} />;
  if (vouchers.error !== null) return <ErrorBanner message={vouchers.error} />;

  const accountRows = accounts.data ?? [];
  const voucherRows = vouchers.data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>Баллы и ваучеры</h1>
      </div>

      <div className="banner">
        1% от базы работ закрытых B2B-заявок — только при включённой опции в договоре организации
        (ТЗ 17.14). Авто-выдача ваучера по FEFO при достижении номинала.
      </div>

      <div className="section-title">Счета баллов</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Телефон</th>
              <th className="num">Баланс</th>
              <th>Последняя операция</th>
            </tr>
          </thead>
          <tbody>
            {accountRows.length === 0 && <EmptyRow colSpan={3} />}
            {accountRows.map((acc) => {
              const last = lastOperation(acc);
              return (
                <tr
                  key={acc.phone}
                  className="row--clickable"
                  onClick={() => setHistoryAccount(acc)}
                >
                  <td className="num">{acc.phone}</td>
                  <td className="num semibold">{formatSoums(acc.balanceTiyin)}</td>
                  <td>
                    {last
                      ? `${KIND_LABELS[last.kind] ?? last.kind} · ${last.note} · ${formatDateTime(last.at)}`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="page-header" style={{ marginTop: 'var(--s24)' }}>
        <div className="section-title" style={{ margin: 0 }}>
          Пул ваучеров
        </div>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setFormError(null);
            setVoucherModalOpen(true);
          }}
        >
          + Ваучер
        </button>
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Код</th>
              <th className="num">Номинал</th>
              <th className="num">Годен до</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {voucherRows.length === 0 && <EmptyRow colSpan={4} />}
            {voucherRows.map((v) => (
              <tr key={v.id}>
                <td className="mono semibold">{v.code}</td>
                <td className="num">{formatSoums(v.nominalTiyin)}</td>
                <td className="num">{formatDate(v.expiresAt)}</td>
                <td>
                  {v.status === 'free' ? (
                    <span className="badge badge--success">Свободен</span>
                  ) : (
                    <span className="badge badge--muted">
                      Выдан{v.issuedToPhone ? ` · ${v.issuedToPhone}` : ''}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {historyAccount !== null && (
        <Modal
          title={`История баллов · ${historyAccount.phone}`}
          onClose={() => setHistoryAccount(null)}
          wide
        >
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Тип</th>
                  <th className="num">Сумма</th>
                  <th>Примечание</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {historyAccount.history.length === 0 && <EmptyRow colSpan={4} />}
                {[...historyAccount.history].reverse().map((op, i) => (
                  <tr key={op.id ?? i}>
                    <td>{KIND_LABELS[op.kind] ?? op.kind}</td>
                    <td className={op.amountTiyin < 0 ? 'num neg' : 'num'}>
                      {op.amountTiyin > 0 ? '+' : ''}
                      {formatSoums(op.amountTiyin)}
                    </td>
                    <td>{op.note}</td>
                    <td className="num">{formatDateTime(op.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Modal>
      )}

      {voucherModalOpen && (
        <Modal title="Новый ваучер" onClose={() => setVoucherModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={submitVoucher}>
            <div className="field">
              <label htmlFor="v-code">Код ваучера</label>
              <input
                id="v-code"
                value={vCode}
                onChange={(e) => setVCode(e.target.value)}
                placeholder="KRZ-0004"
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="v-nominal">Номинал, сум</label>
              <input
                id="v-nominal"
                type="number"
                min={1}
                value={vNominal}
                onChange={(e) => setVNominal(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="v-expires">Годен до</label>
              <input
                id="v-expires"
                type="date"
                value={vExpiresAt}
                onChange={(e) => setVExpiresAt(e.target.value)}
                required
              />
            </div>
            <div className="modal__actions">
              <button
                type="button"
                className="btn"
                onClick={() => setVoucherModalOpen(false)}
              >
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Добавить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
