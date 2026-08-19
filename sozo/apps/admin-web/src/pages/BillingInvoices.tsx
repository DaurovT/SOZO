import { FormEvent, useState } from 'react';
import { api, openDocument } from '../api';
import { useFetch } from '../useFetch';
import { formatDate, formatSoums } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { Invoice, Organization } from '../types';

export function invoiceKindLabel(kind: string): string {
  return kind === 'subscription' ? 'Абонентка' : kind;
}

interface PageData {
  invoices: Invoice[];
  organizations: Organization[];
}

export function BillingInvoicesPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<PageData>(async () => {
    const [invoices, organizations] = await Promise.all([
      api.get<Invoice[]>('/admin/billing/invoices'),
      api.get<Organization[]>('/admin/organizations'),
    ]);
    return { invoices, organizations };
  });

  const [actionError, setActionError] = useState<string | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [orgId, setOrgId] = useState('');

  const issueSubscription = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/billing/invoices/subscription', { organizationId: orgId });
      toast('Счёт-фактура выставлена');
      setModalOpen(false);
      setOrgId('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const markPaid = async (inv: Invoice) => {
    setActionError(null);
    try {
      await api.post(`/admin/billing/invoices/${inv.id}/mark-paid`);
      toast(`СФ ${inv.number} оплачена`);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const invoices = data.invoices;
  const subscriptionOrgs = data.organizations.filter(
    (o) => o.subscriptionTiyin != null && o.subscriptionTiyin > 0,
  );

  return (
    <>
      <div className="page-header">
        <h1>Счета-фактуры</h1>
        <button type="button" className="btn btn--primary" onClick={() => setModalOpen(true)}>
          Выставить СФ на абонентку
        </button>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Номер</th>
              <th>Организация</th>
              <th>Тип</th>
              <th className="num">Сумма</th>
              <th className="num">в т.ч. НДС</th>
              <th>Статус</th>
              <th>Выставлена</th>
              <th>Оплачена</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {invoices.length === 0 && <EmptyRow colSpan={9} />}
            {invoices.map((inv) => (
              <tr key={inv.id}>
                <td className="mono">{inv.number}</td>
                <td>{inv.organizationName}</td>
                <td className="muted">{invoiceKindLabel(inv.kind)}</td>
                <td className="num">{formatSoums(inv.amountTiyin)}</td>
                <td className="num">
                  {/* Пени НДС не облагаются — там честный прочерк, а не ноль */}
                  {inv.vatTiyin > 0 ? (
                    <>
                      {formatSoums(inv.vatTiyin)}
                      <div className="muted">{inv.vatRatePercent}%</div>
                    </>
                  ) : (
                    <span className="muted">без НДС</span>
                  )}
                </td>
                <td>
                  {inv.status === 'paid' ? (
                    <span className="badge badge--success">Оплачена</span>
                  ) : (
                    <span className="badge badge--warning">Выставлена</span>
                  )}
                </td>
                <td className="num">{formatDate(inv.issuedAt)}</td>
                <td className="num">{formatDate(inv.paidAt)}</td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--s12)' }}>
                    {inv.status === 'issued' && (
                      <button
                        type="button"
                        className="btn btn--link"
                        onClick={() => void markPaid(inv)}
                      >
                        Отметить оплату
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--link"
                      onClick={() => openDocument(`/documents/invoices/${inv.id}`)}
                    >
                      Печать СФ
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <Modal title="Выставить СФ на абонентку" onClose={() => setModalOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={issueSubscription}>
            <div className="field">
              <label htmlFor="inv-org">Организация</label>
              <select id="inv-org" value={orgId} onChange={(e) => setOrgId(e.target.value)} required>
                <option value="" disabled>
                  — выберите организацию —
                </option>
                {subscriptionOrgs.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.name} — {formatSoums(o.subscriptionTiyin)}/мес
                  </option>
                ))}
              </select>
            </div>
            {subscriptionOrgs.length === 0 && (
              <div className="muted">Нет организаций с абонентской платой</div>
            )}
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setModalOpen(false)}>
                Отмена
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={busy || subscriptionOrgs.length === 0}
              >
                Выставить
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
