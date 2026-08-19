import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDate, soumsToTiyin } from '../format';
import { Modal } from '../components/Modal';
import { ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import type { Lead, LeadStage } from '../types';

const STAGES: Array<{ key: LeadStage; label: string }> = [
  { key: 'new', label: 'Новый' },
  { key: 'demo', label: 'Демо' },
  { key: 'audit', label: 'Аудит' },
  { key: 'proposal', label: 'КП' },
  { key: 'contract', label: 'Договор' },
  { key: 'rejected', label: 'Отказ' },
];

const STAGE_LABELS: Record<LeadStage, string> = Object.fromEntries(
  STAGES.map((s) => [s.key, s.label]),
) as Record<LeadStage, string>;

/** Стадии, с которых доступна конвертация в организацию (≥ КП). */
const CONVERTIBLE: LeadStage[] = ['proposal', 'contract'];

/** A-37: воронка B2B-лидов — лид → демо → аудит → КП → договор; отказ только с причиной. */
export function LeadsPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<Lead[]>(() => api.get<Lead[]>('/admin/leads'));

  const [selected, setSelected] = useState<Lead | null>(null);
  const [stage, setStage] = useState<LeadStage>('new');
  const [rejectReason, setRejectReason] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [convertOpen, setConvertOpen] = useState(false);
  const [inn, setInn] = useState('');
  const [subSoums, setSubSoums] = useState('');

  const [createOpen, setCreateOpen] = useState(false);
  const [company, setCompany] = useState('');
  const [contactName, setContactName] = useState('');
  const [phone, setPhone] = useState('+998');
  const [pointsCount, setPointsCount] = useState('1');
  const [objectType, setObjectType] = useState('');
  const [utmSource, setUtmSource] = useState('');
  const [note, setNote] = useState('');

  const openLead = (lead: Lead) => {
    setSelected(lead);
    setStage(lead.stage);
    setRejectReason(lead.rejectReason ?? '');
    setFormError(null);
  };

  const saveStage = async () => {
    if (!selected) return;
    if (stage === 'rejected' && rejectReason.trim() === '') {
      setFormError('Для отказа обязательна причина (REASON_REQUIRED)');
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      const updated = await api.put<Lead>(`/admin/leads/${selected.id}/stage`, {
        stage,
        ...(stage === 'rejected' ? { rejectReason: rejectReason.trim() } : {}),
      });
      toast(`Стадия: ${STAGE_LABELS[updated.stage]}`);
      setSelected(updated);
      reload();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const convert = async (e: FormEvent) => {
    e.preventDefault();
    if (!selected) return;
    setBusy(true);
    setFormError(null);
    try {
      const res = await api.post<{ lead: Lead; organization: { id: string; name: string } }>(
        `/admin/leads/${selected.id}/convert`,
        {
          inn: inn.trim(),
          ...(subSoums !== '' ? { subscriptionTiyin: soumsToTiyin(Number(subSoums)) } : {}),
        },
      );
      toast(`Лид конвертирован: ${res.organization.name}`);
      setConvertOpen(false);
      setInn('');
      setSubSoums('');
      setSelected(res.lead);
      setStage(res.lead.stage);
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const createLead = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.post('/admin/leads', {
        company: company.trim(),
        contactName: contactName.trim(),
        phone: '+' + phone.replace(/\D/g, ''),
        pointsCount: Number(pointsCount) || 1,
        objectType: objectType.trim() || undefined,
        note: note.trim() || undefined,
        ...(utmSource.trim() !== '' ? { utm: { utm_source: utmSource.trim() } } : {}),
      });
      toast('Лид создан');
      setCreateOpen(false);
      setCompany('');
      setContactName('');
      setPhone('+998');
      setPointsCount('1');
      setObjectType('');
      setUtmSource('');
      setNote('');
      reload();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const leads = data ?? [];

  return (
    <>
      <div className="page-header">
        <h1>B2B-лиды</h1>
        <button
          type="button"
          className="btn btn--primary"
          onClick={() => {
            setFormError(null);
            setCreateOpen(true);
          }}
        >
          Новый лид
        </button>
      </div>

      <div className="funnel">
        {STAGES.map((s) => {
          const inStage = leads.filter((l) => l.stage === s.key);
          return (
            <div key={s.key} className="funnel-col">
              <div className="funnel-col__title">
                <span>{s.label}</span>
                <span>{inStage.length}</span>
              </div>
              {inStage.length === 0 && <div className="funnel-card__meta">Пусто</div>}
              {inStage.map((l) => (
                <div key={l.id} className="funnel-card" onClick={() => openLead(l)}>
                  <div className="semibold">{l.company}</div>
                  <div>{l.contactName || '—'}</div>
                  <div className="muted">{l.phone}</div>
                  <div className="funnel-card__meta">
                    Точек: {l.pointsCount}
                    {l.utm?.utm_source ? ` · ${l.utm.utm_source}` : ''}
                  </div>
                </div>
              ))}
            </div>
          );
        })}
      </div>

      {selected !== null && !convertOpen && (
        <Modal title={selected.company} onClose={() => setSelected(null)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <dl className="kv" style={{ marginBottom: 'var(--s16)' }}>
            <dt>Контакт</dt>
            <dd>
              {selected.contactName || '—'} · {selected.phone}
            </dd>
            <dt>Точек</dt>
            <dd>{selected.pointsCount}</dd>
            <dt>Тип объекта</dt>
            <dd>{selected.objectType ?? '—'}</dd>
            <dt>UTM</dt>
            <dd className="muted">
              {selected.utm ? Object.values(selected.utm).join(' · ') : '—'}
            </dd>
            <dt>Заметка</dt>
            <dd>{selected.note ?? '—'}</dd>
            <dt>Создан</dt>
            <dd>{formatDate(selected.createdAt)}</dd>
            {selected.rejectReason && (
              <>
                <dt>Причина отказа</dt>
                <dd className="neg">{selected.rejectReason}</dd>
              </>
            )}
            {selected.organizationId && (
              <>
                <dt>Организация</dt>
                <dd>
                  <Link to={`/organizations/${selected.organizationId}`}>Открыть организацию</Link>
                </dd>
              </>
            )}
          </dl>

          <div className="form-grid">
            <div className="field">
              <label htmlFor="lead-stage">Стадия</label>
              <select
                id="lead-stage"
                value={stage}
                onChange={(e) => setStage(e.target.value as LeadStage)}
              >
                {STAGES.map((s) => (
                  <option key={s.key} value={s.key}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            {stage === 'rejected' && (
              <div className="field">
                <label htmlFor="lead-reject">Причина отказа (обязательно)</label>
                <textarea
                  id="lead-reject"
                  value={rejectReason}
                  onChange={(e) => setRejectReason(e.target.value)}
                  required
                />
              </div>
            )}
          </div>

          <div className="modal__actions">
            {CONVERTIBLE.includes(selected.stage) && !selected.organizationId && (
              <button
                type="button"
                className="btn"
                disabled={busy}
                onClick={() => {
                  setFormError(null);
                  setConvertOpen(true);
                }}
              >
                Конвертировать в организацию
              </button>
            )}
            <button type="button" className="btn" onClick={() => setSelected(null)}>
              Закрыть
            </button>
            <button
              type="button"
              className="btn btn--primary"
              disabled={busy || stage === selected.stage}
              onClick={() => void saveStage()}
            >
              Сохранить стадию
            </button>
          </div>
        </Modal>
      )}

      {selected !== null && convertOpen && (
        <Modal title={`Конвертация: ${selected.company}`} onClose={() => setConvertOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={convert}>
            <div className="field">
              <label htmlFor="conv-inn">ИНН</label>
              <input
                id="conv-inn"
                inputMode="numeric"
                value={inn}
                onChange={(e) => setInn(e.target.value.replace(/[^\d]/g, ''))}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="conv-sub">Абонентка, сум в месяц (опционально)</label>
              <input
                id="conv-sub"
                inputMode="numeric"
                value={subSoums}
                onChange={(e) => setSubSoums(e.target.value.replace(/[^\d]/g, ''))}
                placeholder="Пусто — разовый договор"
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setConvertOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Конвертировать
              </button>
            </div>
          </form>
        </Modal>
      )}

      {createOpen && (
        <Modal title="Новый лид" onClose={() => setCreateOpen(false)}>
          {formError !== null && <ErrorBanner message={formError} />}
          <form className="form-grid" onSubmit={createLead}>
            <div className="field">
              <label htmlFor="l-company">Компания</label>
              <input
                id="l-company"
                value={company}
                onChange={(e) => setCompany(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="l-contact">Контактное лицо</label>
              <input
                id="l-contact"
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
              />
            </div>
            <div className="field">
              <label htmlFor="l-phone">Телефон</label>
              <input
                id="l-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+998 90 123 45 67"
                required
              />
            </div>
            <div className="field">
              <label htmlFor="l-points">Количество точек</label>
              <input
                id="l-points"
                inputMode="numeric"
                value={pointsCount}
                onChange={(e) => setPointsCount(e.target.value.replace(/[^\d]/g, ''))}
              />
            </div>
            <div className="field">
              <label htmlFor="l-object">Тип объекта</label>
              <input
                id="l-object"
                value={objectType}
                onChange={(e) => setObjectType(e.target.value)}
                placeholder="офис, кафе, аптека…"
              />
            </div>
            <div className="field">
              <label htmlFor="l-utm">UTM-источник</label>
              <input
                id="l-utm"
                value={utmSource}
                onChange={(e) => setUtmSource(e.target.value)}
                placeholder="instagram, telegram…"
              />
            </div>
            <div className="field">
              <label htmlFor="l-note">Заметка</label>
              <textarea id="l-note" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setCreateOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Создать
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
