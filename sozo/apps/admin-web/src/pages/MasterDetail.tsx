import { FormEvent, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDate, formatSoums, plural } from '../format';
import { StatusBadge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { GRADE_LABELS, TAX_LABELS } from './Masters';
import type { Master, MasterCard, MasterDocument, MasterStatus } from '../types';

const TRANSPORT_LABELS: Record<Master['transport'], string> = {
  own_car: 'Свой автомобиль',
  public: 'Общественный транспорт',
  none: 'Нет',
};

const DOC_STATUS: Record<MasterDocument['status'], { label: string; variant: string }> = {
  verified: { label: 'Проверен', variant: 'success' },
  uploaded: { label: 'Загружен', variant: 'warning' },
  missing: { label: 'Отсутствует', variant: 'error' },
};

const STATUS_OPTIONS: Array<{ value: MasterStatus; label: string }> = [
  { value: 'candidate', label: 'Кандидат' },
  { value: 'checking', label: 'Проверка' },
  { value: 'training', label: 'Обучение' },
  { value: 'active', label: 'Активен' },
  { value: 'blocked', label: 'Заблокирован' },
  { value: 'offboarding', label: 'Офбординг' },
];

const ORDER_STATUS_RU: Record<string, string> = {
  new: 'Новая', estimated: 'Оценена', pending_approval: 'На утверждении', approved: 'Утверждена',
  assigned: 'Назначена', master_departed: 'Мастер выехал', in_progress: 'В работе',
  addwork_approval: 'Доп-согласование', completed: 'Выполнена', verified: 'Проверена',
  awaiting_payment: 'Ожидает оплаты', closed: 'Закрыта', rated: 'Оценена клиентом',
  cancelled: 'Отменена', dispute: 'Спор',
};

/** Веса формулы рейтинга (ТЗ 7.4) по-русски */
const FORMULA_LABELS: Record<string, string> = {
  punctuality: 'Пунктуальность',
  clientRatings: 'Оценки клиентов',
  photoQuality: 'Качество фото до/после',
  noRedo: 'Отсутствие переделок',
  offerDiscipline: 'Дисциплина офферов',
};

const TABS = [
  { key: 'profile', label: 'Профиль' },
  { key: 'documents', label: 'Документы' },
  { key: 'skills', label: 'Skill-теги и экзамены' },
  { key: 'orders', label: 'Заявки' },
  { key: 'money', label: 'Деньги' },
  { key: 'rating', label: 'Рейтинг' },
] as const;

type TabKey = (typeof TABS)[number]['key'];

function initials(fullName: string): string {
  return fullName
    .split(/\s+/)
    .filter((w) => /^[А-ЯЁA-Z]/u.test(w))
    .slice(0, 2)
    .map((w) => w[0])
    .join('');
}

/** A-11: полная карточка мастера — табы поверх BFF-агрегата */
export function MasterDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<MasterCard>(
    () => api.get<MasterCard>(`/admin/dashboard/masters/${id}/card`),
    [id],
  );
  const [tab, setTab] = useState<TabKey>('profile');
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [examOpen, setExamOpen] = useState(false);
  const [examSkill, setExamSkill] = useState('');

  const [ratingText, setRatingText] = useState<string | null>(null);
  const [gphText, setGphText] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const { master: m, alerts, orders, money, ratingBreakdown } = data;

  const saveMaster = async (patch: Partial<Master>, message: string) => {
    setBusy(true);
    setActionError(null);
    try {
      await api.put(`/admin/masters/${m.id}`, patch);
      toast(message);
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const commitRating = async () => {
    if (ratingText === null) return;
    const n = Number(ratingText);
    setRatingText(null);
    if (Number.isNaN(n) || n < 0 || n > 100 || n === m.rating) return;
    await saveMaster({ rating: Math.round(n) }, 'Рейтинг обновлён');
  };

  const commitGph = async () => {
    if (gphText === null) return;
    const next = gphText === '' ? null : gphText;
    setGphText(null);
    if (next === m.gphContractUntil) return;
    await saveMaster({ gphContractUntil: next }, 'Дата ГПХ-договора сохранена');
  };

  const submitExam = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/masters/${m.id}/skill-exam`, { skill: examSkill.trim() });
      toast('Экзамен проведён — тег добавлен');
      setExamOpen(false);
      setExamSkill('');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const offboard = async () => {
    const ok = window.confirm(
      'Офбординг мастера (ТЗ 8.6): снятие с линии, заморозка выплат до акта сверки, взаимозачёт наличного долга. Продолжить?',
    );
    if (!ok) return;
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/masters/${m.id}/offboard`, {});
      toast('Офбординг запущен');
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const debtShare =
    money.cashDebtLimitTiyin > 0 ? money.cashDebtTiyin / money.cashDebtLimitTiyin : 0;
  const debtDanger = debtShare > 0.8;

  return (
    <>
      <div className="page-header">
        <h1>
          {m.fullName} <StatusBadge status={m.status} />
        </h1>
        <button type="button" className="btn" onClick={() => navigate('/masters')}>
          К списку
        </button>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      {m.offboardingNote && <div className="banner banner--warning">{m.offboardingNote}</div>}

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            className={tab === t.key ? 'tab active' : 'tab'}
            onClick={() => setTab(t.key)}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'profile' && (
        <>
          {alerts.gphExpiring && (
            <div className="banner banner--error">
              Договор ГПХ истекает через {plural(alerts.gphDaysLeft ?? 0, 'день', 'дня', 'дней')} —
              продлите (ТЗ A-11)
            </div>
          )}
          {alerts.documentsMissing > 0 && (
            <div className="banner banner--warning">
              Не хватает документов: {alerts.documentsMissing} — см. вкладку «Документы»
            </div>
          )}

          <div className="card" style={{ marginBottom: 'var(--s16)' }}>
            <div style={{ display: 'flex', gap: 'var(--s16)', alignItems: 'center', marginBottom: 'var(--s16)' }}>
              <div className="avatar">{initials(m.fullName)}</div>
              <div>
                <div className="semibold" style={{ fontSize: 16 }}>
                  {m.fullName}
                </div>
                <div className="muted num" style={{ textAlign: 'left' }}>
                  {m.phone}
                </div>
              </div>
            </div>
            <dl className="kv">
              <dt>Статус</dt>
              <dd>
                <StatusBadge status={m.status} />
              </dd>
              <dt>Грейд</dt>
              <dd>{GRADE_LABELS[m.grade] ?? m.grade}</dd>
              <dt>Налоговый режим</dt>
              <dd>{TAX_LABELS[m.taxMode] ?? m.taxMode}</dd>
              <dt>Зоны</dt>
              <dd>
                {m.zones.length === 0
                  ? '—'
                  : m.zones.map((z) => (
                      <span className="chip" key={z}>
                        {z}
                      </span>
                    ))}
              </dd>
              <dt>Транспорт</dt>
              <dd>{TRANSPORT_LABELS[m.transport] ?? m.transport}</dd>
              <dt>Реферер</dt>
              <dd>{m.referrerName ?? '—'}</dd>
              <dt>QR-бейдж</dt>
              <dd>
                <span className="mono">{m.qrBadgeCode}</span>{' '}
                <Link to="/mock/badges">макет бейджа</Link>
              </dd>
              <dt>Оборудование</dt>
              <dd className="muted">
                {data.equipment.length === 0
                  ? 'не выдано (акты выдачи — A-13)'
                  : data.equipment.map((eq) => `${eq.inventoryNumber} ${eq.name}`).join(', ')}
              </dd>
              <dt>В системе с</dt>
              <dd>{formatDate(m.createdAt)}</dd>
            </dl>
          </div>

          <div className="section-title">Управление</div>
          <div className="card">
            <dl className="kv">
              <dt>Рейтинг (0–100, вручную в MVP)</dt>
              <dd>
                <input
                  className="cell-input"
                  style={{ width: 72 }}
                  type="number"
                  min={0}
                  max={100}
                  disabled={busy}
                  value={ratingText ?? String(m.rating)}
                  onChange={(e) => setRatingText(e.target.value)}
                  onBlur={() => void commitRating()}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  }}
                />
              </dd>
              <dt>Статус</dt>
              <dd>
                <select
                  className="cell-select"
                  disabled={busy}
                  value={m.status}
                  onChange={(e) =>
                    void saveMaster({ status: e.target.value as MasterStatus }, 'Статус обновлён')
                  }
                >
                  {STATUS_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </dd>
              <dt>ГПХ-договор до</dt>
              <dd>
                <input
                  className="cell-input"
                  style={{ width: 160 }}
                  type="date"
                  disabled={busy}
                  value={gphText ?? m.gphContractUntil ?? ''}
                  onChange={(e) => setGphText(e.target.value)}
                  onBlur={() => void commitGph()}
                />
              </dd>
            </dl>
          </div>
        </>
      )}

      {tab === 'documents' && (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Документ</th>
                <th>Статус</th>
              </tr>
            </thead>
            <tbody>
              {m.documents.length === 0 && <EmptyRow colSpan={2} />}
              {m.documents.map((d) => (
                <tr key={d.name}>
                  <td>{d.name}</td>
                  <td>
                    <span className={`badge badge--${DOC_STATUS[d.status].variant}`}>
                      {DOC_STATUS[d.status].label}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {tab === 'skills' && (
        <>
          <div className="page-header">
            <h1 style={{ fontSize: 16 }}>Текущие skill-теги</h1>
            <button type="button" className="btn btn--primary" onClick={() => setExamOpen(true)}>
              Провести экзамен
            </button>
          </div>
          <div className="card" style={{ marginBottom: 'var(--s16)' }}>
            {m.skillTags.length === 0 ? (
              <span className="muted">Тегов нет — новые теги только через экзамен (ТЗ 17.1)</span>
            ) : (
              m.skillTags.map((tag) => (
                <span className="chip" key={tag}>
                  {tag}
                </span>
              ))
            )}
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Skill</th>
                  <th>Дата экзамена</th>
                  <th>Экзаменатор</th>
                </tr>
              </thead>
              <tbody>
                {m.skillExams.length === 0 && <EmptyRow colSpan={3} />}
                {m.skillExams.map((ex, i) => (
                  <tr key={`${ex.skill}-${i}`}>
                    <td>{ex.skill}</td>
                    <td className="num">{formatDate(ex.passedAt)}</td>
                    <td>{ex.examiner}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'orders' && (
        <>
          <div className="tiles">
            <div className="card">
              <div className="tile__value tile__value--sm">{orders.total}</div>
              <div className="tile__label">Всего заявок</div>
            </div>
            <div className="card">
              <div className="tile__value tile__value--sm">{orders.active}</div>
              <div className="tile__label">Активные</div>
            </div>
            <div className="card">
              <div className="tile__value tile__value--sm">{orders.closed}</div>
              <div className="tile__label">Закрытые</div>
            </div>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Заявка</th>
                  <th>Статус</th>
                  <th>Адрес</th>
                  <th className="num">Сумма</th>
                  <th>Дата</th>
                </tr>
              </thead>
              <tbody>
                {orders.recent.length === 0 && <EmptyRow colSpan={5} />}
                {orders.recent.map((o) => (
                  <tr key={o.id}>
                    <td className="mono">{o.number}</td>
                    <td>{ORDER_STATUS_RU[o.status] ?? o.status}</td>
                    <td>{o.address}</td>
                    <td className="num">{formatSoums(o.totalFromTiyin)}</td>
                    <td className="num">{formatDate(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {tab === 'money' && (
        <>
          <div className="tiles">
            <div className="card">
              <div className="tile__value tile__value--sm">{formatSoums(money.accruedTiyin)}</div>
              <div className="tile__label">Начислено</div>
            </div>
            <div className="card">
              <div className="tile__value tile__value--sm">{formatSoums(money.paidTiyin)}</div>
              <div className="tile__label">Выплачено</div>
            </div>
            <div className="card">
              <div className="tile__value tile__value--sm">{formatSoums(money.dueTiyin)}</div>
              <div className="tile__label">К выплате</div>
            </div>
          </div>
          <div className={debtDanger ? 'card card--outline-error' : 'card'}>
            <div className="tile__label" style={{ marginBottom: 'var(--s8)' }}>
              Наличный долг (лимит {formatSoums(money.cashDebtLimitTiyin)})
            </div>
            <div className={debtDanger ? 'tile__value tile__value--sm neg' : 'tile__value tile__value--sm'}>
              {formatSoums(money.cashDebtTiyin)}
            </div>
            <div className="progress" style={{ marginTop: 'var(--s8)' }}>
              <div
                className={debtDanger ? 'progress__fill progress__fill--danger' : 'progress__fill'}
                style={{ width: `${Math.min(100, Math.round(debtShare * 100))}%` }}
              />
            </div>
            <div className="tile__hint">
              {Math.round(debtShare * 100)}% лимита
              {debtDanger ? ' — блокировка распределения близко' : ''}
            </div>
          </div>
          <p className="muted" style={{ marginTop: 'var(--s12)' }}>
            Выплаты еженедельно, ведомость — A-17 «Выплаты мастерам».
          </p>
        </>
      )}

      {tab === 'rating' && (
        <>
          <div className="tiles">
            <div className="card">
              <div className="tile__value">{ratingBreakdown.current}</div>
              <div className="tile__label">Текущий рейтинг</div>
            </div>
            <div className="card">
              <div className="tile__value">{GRADE_LABELS[ratingBreakdown.grade] ?? ratingBreakdown.grade}</div>
              <div className="tile__label">Грейд</div>
            </div>
          </div>
          <div className="card">
            <div className="tile__label" style={{ marginBottom: 'var(--s8)' }}>
              Формула весов (ТЗ 7.4)
            </div>
            <dl className="kv">
              {Object.entries(ratingBreakdown.formula).map(([key, weight]) => (
                <div key={key} style={{ display: 'contents' }}>
                  <dt>{FORMULA_LABELS[key] ?? key}</dt>
                  <dd>{weight}%</dd>
                </div>
              ))}
            </dl>
            <p className="muted" style={{ marginBottom: 0, marginTop: 'var(--s12)' }}>
              {ratingBreakdown.note}
            </p>
          </div>
        </>
      )}

      {m.status !== 'offboarding' && (
        <div style={{ marginTop: 'var(--s24)' }}>
          <button type="button" className="btn btn--danger" disabled={busy} onClick={() => void offboard()}>
            Офбординг
          </button>
        </div>
      )}

      {examOpen && (
        <Modal title="Провести экзамен" onClose={() => setExamOpen(false)}>
          <form className="form-grid" onSubmit={submitExam}>
            <div className="field">
              <label htmlFor="exam-skill">Skill-тег</label>
              <input
                id="exam-skill"
                value={examSkill}
                onChange={(e) => setExamSkill(e.target.value)}
                placeholder="например, кондиционеры"
                required
                autoFocus
              />
            </div>
            <p className="muted" style={{ margin: 0 }}>
              Новые skill-теги присваиваются только через экзамен (ТЗ 17.1). Тег добавится к
              профилю после сохранения.
            </p>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setExamOpen(false)}>
                Отмена
              </button>
              <button type="submit" className="btn btn--primary" disabled={busy}>
                Экзамен сдан
              </button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
