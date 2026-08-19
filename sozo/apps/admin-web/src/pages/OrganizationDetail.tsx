import { FormEvent, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, openDocument, photoUrl } from '../api';
import { useFetch } from '../useFetch';
import { formatDate, formatSoums, soumsToTiyin } from '../format';
import { postWithSecondAdmin } from '../secondAdmin';
import { StatusBadge } from '../components/Badge';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { contractKindLabel, contractTypeLabel } from './Organizations';
import type {
  ContractTerms,
  Master,
  ObjectTypeRate,
  OrgFinance,
  OrgLocation,
  OrganizationDetail,
} from '../types';

/** История точки (ТЗ 9.2): заявки объекта — основа месячного отчёта с фото */
interface LocationHistory {
  orders: Array<{
    id: string;
    number: string;
    status: string;
    urgency: string;
    description: string;
    totalFromTiyin: number;
    masterName?: string;
    createdAt: string;
    /** Снимает приложение мастера (M-13/M-27); файл появляется после загрузки */
    photos?: Array<{ id?: string; stage: 'before' | 'during' | 'after' | 'receipt'; file?: string; at: string }>;
  }>;
  totals: { count: number; closed: number; spentTiyin: number };
}

const HISTORY_STATUS_RU: Record<string, string> = {
  new: 'Новая', estimated: 'Оценена', pending_approval: 'На утверждении', approved: 'Утверждена',
  assigned: 'Назначена', master_departed: 'Мастер выехал', in_progress: 'В работе',
  addwork_approval: 'Доп-согласование', completed: 'Выполнена', verified: 'Проверена',
  awaiting_payment: 'Ожидает оплаты', closed: 'Закрыта', rated: 'Оценена клиентом',
  cancelled: 'Отменена', dispute: 'Спор',
};

/** A-07/A-16: абонентка — оплачено/списано/баланс, прогноз «хватит до ~N числа», сверхлимит (ТЗ 8.3). */
function FinanceSection({ orgId }: { orgId: string }) {
  const { data, loading, error } = useFetch<OrgFinance>(
    () => api.get<OrgFinance>(`/admin/dashboard/organizations/${orgId}/finance`),
    [orgId],
  );

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const negative = data.balanceTiyin < 0;

  return (
    <>
      <div className="section-title">Абонентка</div>
      <div className="tiles">
        <div className="card">
          <div className="tile__value tile__value--sm">{formatSoums(data.paidTiyin)}</div>
          <div className="tile__label">Оплачено</div>
        </div>
        <div className="card">
          <div className="tile__value tile__value--sm">{formatSoums(data.consumedTiyin)}</div>
          <div className="tile__label">Списано работ</div>
        </div>
        <div className={negative ? 'card card--outline-error' : 'card'}>
          <div className={negative ? 'tile__value tile__value--sm neg' : 'tile__value tile__value--sm'}>
            {formatSoums(data.balanceTiyin)}
          </div>
          <div className="tile__label">
            Баланс{' '}
            {(negative || data.overlimit) && (
              <span
                className="badge badge--error"
                title="Сверхлимит — отдельная счёт-фактура по ценам B2B разовой (ТЗ 8.3)"
              >
                СВЕРХЛИМИТ — отдельная СФ по ценам B2B разовой, ТЗ 8.3
              </span>
            )}
          </div>
        </div>
      </div>
      {data.forecastDay !== null && (
        <div className="banner">При текущем темпе хватит до ~{data.forecastDay} числа</div>
      )}
      <p className="muted" style={{ marginTop: 0 }}>
        {data.priceFreeze}
      </p>
    </>
  );
}

/** A-09: паспорт точки — объект, доступ, закрепление мастеров, лимиты. */
/**
 * Ответственные на точке (ТЗ 3.2, D-08).
 *
 * До этого экрана доступ к B2B-контуру выдавался только через API: эндпоинты
 * были, интерфейса не было. Здесь тот, кто ведёт договор, сам заводит людей
 * и ставит потолки — без разработчика.
 *
 * Лимит — не украшение: ноль означает сотрудника, который заявку создаст,
 * но смету не утвердит; пустое поле — руководителя организации без потолка.
 */
function RepresentativesModal({
  orgId,
  location,
  thresholds,
  onClose,
  onSaved,
}: {
  orgId: string;
  location: OrgLocation;
  thresholds: ContractTerms['approvalThresholds'];
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('+998');
  const [role, setRole] = useState(thresholds[0]?.role ?? 'Сотрудник');
  const [position, setPosition] = useState('');
  const [limitSoums, setLimitSoums] = useState('0');
  const [noLimit, setNoLimit] = useState(false);
  const [primary, setPrimary] = useState(false);

  const reps = location.representatives ?? [];

  const call = async (run: () => Promise<unknown>, done: string) => {
    setBusy(true);
    setFormError(null);
    try {
      await run();
      toast(done);
      onSaved();
    } catch (e) {
      setFormError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    void call(
      () =>
        api.post(`/admin/organizations/${orgId}/locations/${location.id}/representatives`, {
          fullName: fullName.trim(),
          phone: phone.trim(),
          role,
          position: position.trim(),
          approvalLimitTiyin: noLimit ? null : soumsToTiyin(Number(limitSoums) || 0),
          primary,
        }),
      'Ответственный добавлен',
    ).then(() => {
      setFullName('');
      setPhone('+998');
      setPosition('');
      setLimitSoums('0');
      setNoLimit(false);
      setPrimary(false);
    });
  };

  return (
    <Modal title={`Ответственные · ${location.name}`} onClose={onClose}>
      {formError !== null && <ErrorBanner message={formError} />}

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Кто</th>
              <th>Телефон</th>
              <th>Должность</th>
              <th>Уровень утверждения</th>
              <th className="num">Потолок утверждения</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {reps.length === 0 && <EmptyRow colSpan={6} />}
            {reps.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.fullName}
                  {r.primary && <span className="badge badge--accent">главный</span>}
                </td>
                <td className="mono">{r.phone}</td>
                <td className="muted">{r.position ?? '—'}</td>
                <td>{r.role}</td>
                <td className="num">
                  {r.approvalLimitTiyin === null ? 'без потолка' : formatSoums(r.approvalLimitTiyin)}
                </td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--s8)' }}>
                    {!r.primary && (
                      <button
                        type="button"
                        className="btn btn--secondary"
                        disabled={busy}
                        onClick={() =>
                          void call(
                            () =>
                              api.put(
                                `/admin/organizations/${orgId}/locations/${location.id}/representatives/${r.id}`,
                                { primary: true },
                              ),
                            `${r.fullName} — главный на точке`,
                          )
                        }
                      >
                        Сделать главным
                      </button>
                    )}
                    <button
                      type="button"
                      className="btn btn--secondary"
                      disabled={busy}
                      onClick={() =>
                        void call(
                          () =>
                            api.delete(
                              `/admin/organizations/${orgId}/locations/${location.id}/representatives/${r.id}`,
                            ),
                          `${r.fullName} снят с точки`,
                        )
                      }
                    >
                      Снять доступ
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={add}>
        <div className="section-title">Добавить ответственного</div>
        <div className="form-grid">
          <div className="field">
            <label htmlFor="rep-name">ФИО</label>
            <input id="rep-name" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
          </div>
          <div className="field">
            <label htmlFor="rep-phone">Телефон</label>
            <input
              id="rep-phone"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+998901234567"
              required
            />
            <div className="muted">По этому номеру человек войдёт в приложение «Клиент»</div>
          </div>
          <div className="field">
            <label htmlFor="rep-position">Должность</label>
            <input
              id="rep-position"
              value={position}
              onChange={(e) => setPosition(e.target.value)}
              placeholder="Завхоз, старшая смены…"
            />
            <div className="muted">Как человек называется у себя — на права не влияет</div>
          </div>
          <div className="field">
            <label htmlFor="rep-role">Уровень утверждения</label>
            <input id="rep-role" list="rep-roles" value={role} onChange={(e) => setRole(e.target.value)} />
            <datalist id="rep-roles">
              {thresholds.map((t) => (
                <option key={t.role} value={t.role} />
              ))}
            </datalist>
            <div className="muted">Из договора — он задаёт потолок ниже</div>
          </div>
          <div className="field">
            <label htmlFor="rep-limit">Потолок утверждения, сум</label>
            <input
              id="rep-limit"
              value={limitSoums}
              onChange={(e) => setLimitSoums(e.target.value)}
              disabled={noLimit}
            />
            <label>
              <input type="checkbox" checked={noLimit} onChange={(e) => setNoLimit(e.target.checked)} /> без
              потолка — руководитель организации
            </label>
            <div className="muted">Ноль означает сотрудника: заявку создаст, смету не утвердит</div>
          </div>
          <div className="field">
            <label>
              <input type="checkbox" checked={primary} onChange={(e) => setPrimary(e.target.checked)} />{' '}
              главный на точке — ему уходят акты и запросы приёмки
            </label>
          </div>
        </div>
        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            Закрыть
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy || fullName.trim() === ''}>
            Добавить
          </button>
        </div>
      </form>
    </Modal>
  );
}

function PassportModal({
  orgId,
  location,
  onClose,
  onSaved,
}: {
  orgId: string;
  location: OrgLocation;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const { data: rates } = useFetch<ObjectTypeRate[]>(
    () => api.get<ObjectTypeRate[]>('/admin/registry/object-type-rates'),
    [],
  );
  const { data: masters } = useFetch<Master[]>(() => api.get<Master[]>('/admin/masters'), []);
  const activeMasters = (masters ?? []).filter((m) => m.status === 'active');

  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const p = location.passport;
  const a = location.access;
  const [objectType, setObjectType] = useState(p.objectType ?? '');
  const [areaM2, setAreaM2] = useState(p.areaM2 === null ? '' : String(p.areaM2));
  const [bathrooms, setBathrooms] = useState(p.bathrooms === null ? '' : String(p.bathrooms));
  const [acUnits, setAcUnits] = useState(p.acUnits === null ? '' : String(p.acUnits));
  const [electricPanels, setElectricPanels] = useState(
    p.electricPanels === null ? '' : String(p.electricPanels),
  );
  const [schedule, setSchedule] = useState(a.schedule ?? '');
  const [accessNotes, setAccessNotes] = useState(a.accessNotes ?? '');
  const [hoaContact, setHoaContact] = useState(a.hoaContact ?? '');
  const [waterShutoff, setWaterShutoff] = useState(a.waterShutoff ?? '');
  const [electricalPanel, setElectricalPanel] = useState(a.electricalPanel ?? '');
  const [gasValve, setGasValve] = useState(a.gasValve ?? '');
  const [preferredMasterId, setPreferredMasterId] = useState(location.preferredMasterId ?? '');
  const [blacklist, setBlacklist] = useState<string[]>(location.blacklistMasterIds);
  const [orderLimitSoums, setOrderLimitSoums] = useState(
    String(Math.round(location.orderLimitTiyin / 100)),
  );
  const [monthlyLimitSoums, setMonthlyLimitSoums] = useState(
    String(Math.round(location.monthlyLimitTiyin / 100)),
  );
  const [photoForbidden, setPhotoForbidden] = useState(location.photoForbidden);

  const toggleBlacklist = (masterId: string) => {
    setBlacklist((prev) =>
      prev.includes(masterId) ? prev.filter((x) => x !== masterId) : [...prev, masterId],
    );
  };

  const num = (text: string): number | null => (text.trim() === '' ? null : Number(text));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      await api.put(`/admin/organizations/${orgId}/locations/${location.id}`, {
        passport: {
          objectType: objectType === '' ? null : objectType,
          areaM2: num(areaM2),
          bathrooms: num(bathrooms),
          acUnits: num(acUnits),
          electricPanels: num(electricPanels),
        },
        access: {
          schedule: schedule.trim() === '' ? null : schedule.trim(),
          accessNotes: accessNotes.trim() === '' ? null : accessNotes.trim(),
          hoaContact: hoaContact.trim() === '' ? null : hoaContact.trim(),
          waterShutoff: waterShutoff.trim() === '' ? null : waterShutoff.trim(),
          electricalPanel: electricalPanel.trim() === '' ? null : electricalPanel.trim(),
          gasValve: gasValve.trim() === '' ? null : gasValve.trim(),
        },
        preferredMasterId: preferredMasterId === '' ? null : preferredMasterId,
        blacklistMasterIds: blacklist,
        orderLimitTiyin: soumsToTiyin(Number(orderLimitSoums) || 0),
        monthlyLimitTiyin: soumsToTiyin(Number(monthlyLimitSoums) || 0),
        photoForbidden,
      });
      toast('Паспорт точки сохранён');
      onSaved();
    } catch (err) {
      setFormError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={`Паспорт точки: ${location.name}`} onClose={onClose} wide>
      {formError !== null && <ErrorBanner message={formError} />}
      <form className="form-grid" onSubmit={submit}>
        <div className="section-title" style={{ margin: 0 }}>
          Паспорт объекта
        </div>
        <p className="muted" style={{ margin: 0 }}>
          Источник точного расчёта абонентки (A-09): тариф за м² по типу объекта.
        </p>
        <div className="field">
          <label htmlFor="pp-type">Тип объекта</label>
          <select id="pp-type" value={objectType} onChange={(e) => setObjectType(e.target.value)}>
            <option value="">— не выбран —</option>
            {(rates ?? []).map((r) => (
              <option key={r.id} value={r.objectType}>
                {r.objectType}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s12)' }}>
          <div className="field">
            <label htmlFor="pp-area">Площадь, м²</label>
            <input
              id="pp-area"
              type="number"
              min={0}
              value={areaM2}
              onChange={(e) => setAreaM2(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pp-bath">Санузлов</label>
            <input
              id="pp-bath"
              type="number"
              min={0}
              value={bathrooms}
              onChange={(e) => setBathrooms(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pp-ac">Кондиционеров</label>
            <input
              id="pp-ac"
              type="number"
              min={0}
              value={acUnits}
              onChange={(e) => setAcUnits(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="pp-panels">Электрощитков</label>
            <input
              id="pp-panels"
              type="number"
              min={0}
              value={electricPanels}
              onChange={(e) => setElectricPanels(e.target.value)}
            />
          </div>
        </div>

        <div className="section-title" style={{ margin: 0 }}>
          Доступ
        </div>
        <div className="field">
          <label htmlFor="pp-schedule">График работы</label>
          <input
            id="pp-schedule"
            value={schedule}
            onChange={(e) => setSchedule(e.target.value)}
            placeholder="пн-пт 9-18"
          />
        </div>
        <div className="field">
          <label htmlFor="pp-notes">Примечания (пропускной режим и т.п.)</label>
          <input
            id="pp-notes"
            value={accessNotes}
            onChange={(e) => setAccessNotes(e.target.value)}
            placeholder="вход со двора, ключ у администратора"
          />
        </div>
        <div className="field">
          <label htmlFor="pp-hoa">Контакт ТСЖ/УК</label>
          <input
            id="pp-hoa"
            value={hoaContact}
            onChange={(e) => setHoaContact(e.target.value)}
            placeholder="УК «…» +998…"
          />
        </div>

        <div className="section-title" style={{ margin: 0 }}>
          Где перекрыть при аварии
        </div>
        <div className="banner">
          Эти строки клиент читает на экране «Авария» — в панике, с телефона. Пишите так, как
          объяснили бы вслух: «кран в подсобке, за стеллажом справа»
        </div>
        <div className="field">
          <label htmlFor="pp-water">Кран воды</label>
          <input
            id="pp-water"
            value={waterShutoff}
            onChange={(e) => setWaterShutoff(e.target.value)}
            placeholder="кран в подсобке, за стеллажом справа"
          />
        </div>
        <div className="field">
          <label htmlFor="pp-panel">Электрощиток</label>
          <input
            id="pp-panel"
            value={electricalPanel}
            onChange={(e) => setElectricalPanel(e.target.value)}
            placeholder="щиток у входа со двора, ключ у администратора"
          />
        </div>
        <div className="field">
          <label htmlFor="pp-gas">Газовый кран</label>
          <input
            id="pp-gas"
            value={gasValve}
            onChange={(e) => setGasValve(e.target.value)}
            placeholder="если газа нет — оставьте пустым"
          />
        </div>

        <div className="section-title" style={{ margin: 0 }}>
          Мастера
        </div>
        <div className="field">
          <label htmlFor="pp-preferred">Закреплённый мастер</label>
          <select
            id="pp-preferred"
            value={preferredMasterId}
            onChange={(e) => setPreferredMasterId(e.target.value)}
          >
            <option value="">— нет —</option>
            {activeMasters.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fullName}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label>Чёрный список (не назначать на точку)</label>
          {activeMasters.length === 0 && <span className="muted">Активных мастеров нет</span>}
          {activeMasters.map((m) => (
            <div className="field field--checkbox" key={m.id}>
              <input
                id={`pp-bl-${m.id}`}
                type="checkbox"
                checked={blacklist.includes(m.id)}
                onChange={() => toggleBlacklist(m.id)}
              />
              <label htmlFor={`pp-bl-${m.id}`} style={{ margin: 0 }}>
                {m.fullName}
              </label>
            </div>
          ))}
        </div>

        <div className="section-title" style={{ margin: 0 }}>
          Лимиты и фото
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--s12)' }}>
          <div className="field">
            <label htmlFor="pp-order-limit">Лимит на заказ, сум</label>
            <input
              id="pp-order-limit"
              inputMode="numeric"
              value={orderLimitSoums}
              onChange={(e) => setOrderLimitSoums(e.target.value.replace(/[^\d]/g, ''))}
            />
          </div>
          <div className="field">
            <label htmlFor="pp-monthly-limit">Лимит в месяц, сум</label>
            <input
              id="pp-monthly-limit"
              inputMode="numeric"
              value={monthlyLimitSoums}
              onChange={(e) => setMonthlyLimitSoums(e.target.value.replace(/[^\d]/g, ''))}
            />
          </div>
        </div>
        <div className="field field--checkbox">
          <input
            id="pp-photo"
            type="checkbox"
            checked={photoForbidden}
            onChange={(e) => setPhotoForbidden(e.target.checked)}
          />
          <label htmlFor="pp-photo" style={{ margin: 0 }}>
            Фото запрещено (режимный объект)
          </label>
        </div>

        <div className="modal__actions">
          <button type="button" className="btn" onClick={onClose}>
            Отмена
          </button>
          <button type="submit" className="btn btn--primary" disabled={busy}>
            Сохранить
          </button>
        </div>
      </form>
    </Modal>
  );
}

/** A-07: условия договора — пороги, SLA аварий, перенос остатка, тумблеры программ. */
/**
 * Расхождения между порогами договора и потолками конкретных людей.
 *
 * Договор правят в одном месте, лимиты — в другом, и после правки они молча
 * расходятся. Показываем расхождение и предлагаем применить: автоматически
 * затирать нельзя — где-то отклонение сделано осознанно.
 */
function ThresholdMismatch({ orgId, onApplied }: { orgId: string; onApplied: () => void }) {
  const toast = useToast();
  const { data, reload } = useFetch<{
    mismatches: Array<{ fullName: string; locationName: string; role: string; currentTiyin: number | null; contractTiyin: number | null }>;
  }>(() => api.get(`/admin/organizations/${orgId}/threshold-mismatch`), [orgId]);
  const [busy, setBusy] = useState(false);

  const mismatches = data?.mismatches ?? [];
  if (mismatches.length === 0) return <span className="muted">соответствуют договору</span>;

  const apply = async () => {
    setBusy(true);
    try {
      const res = await api.post<{ message: string }>(`/admin/organizations/${orgId}/apply-thresholds`, {});
      toast(res.message);
      reload();
      onApplied();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      {mismatches.map((m) => (
        <div key={`${m.locationName}-${m.fullName}`} className="muted">
          {m.fullName} ({m.locationName}, {m.role}):{' '}
          {m.currentTiyin === null ? 'без потолка' : formatSoums(m.currentTiyin)} → по договору{' '}
          {m.contractTiyin === null ? 'без потолка' : formatSoums(m.contractTiyin)}
        </div>
      ))}
      <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void apply()}>
        Применить пороги договора
      </button>
    </>
  );
}

/**
 * Сколько абонентка должна стоить по паспортам объектов.
 *
 * Паспорт заводили, а сумму договора ставили руками — связи между ними
 * не было. Это подсказка к переговорам, а не автоматическая цена.
 */
function SubscriptionEstimate({ orgId }: { orgId: string }) {
  const { data } = useFetch<{
    estimateTiyin: number;
    currentTiyin: number;
    diffTiyin: number;
    unknownLocations: number;
    locations: Array<{ locationName: string; objectType: string | null; areaM2: number | null; areaAssumed: boolean; amountTiyin: number | null; note: string | null }>;
    note: string;
  }>(() => api.get(`/admin/organizations/${orgId}/subscription-estimate`), [orgId]);

  if (!data) return null;

  return (
    <div className="card">
      <div className="section-title" style={{ marginTop: 0 }}>
        Расчёт по паспортам объектов
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Точка</th>
              <th>Тип объекта</th>
              <th className="num">Площадь</th>
              <th className="num">Расчёт</th>
            </tr>
          </thead>
          <tbody>
            {data.locations.map((l) => (
              <tr key={l.locationName}>
                <td>{l.locationName}</td>
                <td>{l.objectType ?? <span className="muted">не заполнен</span>}</td>
                <td className="num">
                  {l.areaM2 === null ? '—' : `${l.areaM2} м²`}
                  {l.areaAssumed && <span className="badge badge--warning">типовая</span>}
                </td>
                <td className="num">
                  {l.amountTiyin === null ? <span className="muted">{l.note}</span> : formatSoums(l.amountTiyin)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <dl className="kv">
        <dt>По паспортам</dt>
        <dd>{formatSoums(data.estimateTiyin)}</dd>
        <dt>В договоре</dt>
        <dd>{formatSoums(data.currentTiyin)}</dd>
        <dt>Разница</dt>
        <dd className={data.diffTiyin > 0 ? 'neg' : undefined}>{formatSoums(data.diffTiyin)}</dd>
      </dl>
      <div className="muted">{data.note}</div>
    </div>
  );
}

function ContractSection({
  org,
  onSaved,
  onError,
}: {
  org: OrganizationDetail;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const toast = useToast();
  const t = org.terms;
  const [carryover, setCarryover] = useState(String(t.carryoverPercent));
  const [loyalty, setLoyalty] = useState(t.loyaltyEnabled);
  const [penalty, setPenalty] = useState(t.penaltyEnabled);
  const [showMoney, setShowMoney] = useState(t.showMoneyToEmployees);
  const [matSeparate, setMatSeparate] = useState(t.materialsSeparateInvoice);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    const patch: Partial<ContractTerms> = {};
    const cp = Number(carryover) || 0;
    if (cp !== t.carryoverPercent) patch.carryoverPercent = cp;
    if (loyalty !== t.loyaltyEnabled) patch.loyaltyEnabled = loyalty;
    if (penalty !== t.penaltyEnabled) patch.penaltyEnabled = penalty;
    if (showMoney !== t.showMoneyToEmployees) patch.showMoneyToEmployees = showMoney;
    if (matSeparate !== t.materialsSeparateInvoice) patch.materialsSeparateInvoice = matSeparate;
    if (Object.keys(patch).length === 0) {
      toast('Изменений нет');
      return;
    }
    setBusy(true);
    try {
      await api.put(`/admin/organizations/${org.id}/contract`, patch);
      toast('Условия договора сохранены');
      onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-header" style={{ marginTop: 'var(--s24)' }}>
        <h1 style={{ fontSize: 16 }}>Договор</h1>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void save()}
        >
          Сохранить условия
        </button>
      </div>
      <div className="card">
        <dl className="kv">
          <dt>Пороги утверждений</dt>
          <dd>
            {t.approvalThresholds.map((th) => (
              <div key={th.role}>
                {th.role} —{' '}
                {th.limitTiyin !== null ? formatSoums(th.limitTiyin) : 'двойное утверждение'}
              </div>
            ))}
          </dd>
          <dt>SLA аварий</dt>
          <dd>
            {t.slaEmergencyMin[0]} мин день / {t.slaEmergencyMin[1]} мин ночь
          </dd>
          <dt>Лимиты людей</dt>
          <dd>
            <ThresholdMismatch orgId={org.id} onApplied={onSaved} />
          </dd>
          <dt>Перенос остатка, %</dt>
          <dd>
            <input
              className="cell-input"
              style={{ width: 72 }}
              type="number"
              min={0}
              max={100}
              value={carryover}
              onChange={(e) => setCarryover(e.target.value)}
            />
          </dd>
        </dl>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--s8)',
            marginTop: 'var(--s16)',
          }}
        >
          <div className="field field--checkbox">
            <input
              id="ct-loyalty"
              type="checkbox"
              checked={loyalty}
              onChange={(e) => setLoyalty(e.target.checked)}
            />
            <label htmlFor="ct-loyalty" style={{ margin: 0 }}>
              Программа баллов персонала
            </label>
          </div>
          <div className="field field--checkbox">
            <input
              id="ct-penalty"
              type="checkbox"
              checked={penalty}
              onChange={(e) => setPenalty(e.target.checked)}
            />
            <label htmlFor="ct-penalty" style={{ margin: 0 }}>
              Пени 0.1%/день, потолок 10%
            </label>
          </div>
          <div className="field field--checkbox">
            <input
              id="ct-money"
              type="checkbox"
              checked={showMoney}
              onChange={(e) => setShowMoney(e.target.checked)}
            />
            <label htmlFor="ct-money" style={{ margin: 0 }}>
              Показывать суммы сотрудникам
            </label>
          </div>
          <div className="field field--checkbox">
            <input
              id="ct-materials"
              type="checkbox"
              checked={matSeparate}
              onChange={(e) => setMatSeparate(e.target.checked)}
            />
            <label htmlFor="ct-materials" style={{ margin: 0 }}>
              Материалы отдельной счёт-фактурой
            </label>
          </div>
        </div>
      </div>
    </>
  );
}

export function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<OrganizationDetail>(
    () => api.get<OrganizationDetail>(`/admin/organizations/${id}`),
    [id],
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [locModalOpen, setLocModalOpen] = useState(false);

  const [locName, setLocName] = useState('');
  const [locAddress, setLocAddress] = useState('');
  const [orderLimitSoums, setOrderLimitSoums] = useState('');
  const [monthlyLimitSoums, setMonthlyLimitSoums] = useState('');

  const [historyFor, setHistoryFor] = useState<{ id: string; name: string } | null>(null);
  const [history, setHistory] = useState<LocationHistory | null>(null);
  const [passportFor, setPassportFor] = useState<string | null>(null);
  const [repsFor, setRepsFor] = useState<string | null>(null);

  const openHistory = async (locId: string, locName_: string) => {
    setHistoryFor({ id: locId, name: locName_ });
    setHistory(null);
    setHistory(await api.get<LocationHistory>(`/admin/clients/locations/${locId}/history`));
  };

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;
  if (!data) return null;

  const toggleStatus = async () => {
    const next = data.status === 'active' ? 'suspended' : 'active';
    setBusy(true);
    setActionError(null);
    try {
      await api.put(`/admin/organizations/${data.id}`, { status: next });
      toast(next === 'active' ? 'Организация активирована' : 'Организация приостановлена');
      reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const issueInvoice = async () => {
    setBusy(true);
    setActionError(null);
    try {
      await api.post('/admin/billing/invoices/subscription', { organizationId: data.id });
      toast('Счёт-фактура на абонентку выставлена');
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const terminate = async () => {
    setBusy(true);
    setActionError(null);
    try {
      const res = await postWithSecondAdmin(
        `/admin/organizations/${data.id}/terminate`,
        {},
        'Расторжение договора требует двойного подтверждения. Подтвердить?',
      );
      if (res !== null) {
        toast('Договор расторгнут');
        reload();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const addLocation = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setActionError(null);
    try {
      await api.post(`/admin/organizations/${data.id}/locations`, {
        name: locName.trim(),
        address: locAddress.trim(),
        orderLimitTiyin: soumsToTiyin(Number(orderLimitSoums) || 0),
        monthlyLimitTiyin: soumsToTiyin(Number(monthlyLimitSoums) || 0),
      });
      toast('Точка добавлена');
      setLocModalOpen(false);
      setLocName('');
      setLocAddress('');
      setOrderLimitSoums('');
      setMonthlyLimitSoums('');
      reload();
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-header">
        <h1>
          {data.name} <StatusBadge status={data.status} />
        </h1>
        <div style={{ display: 'flex', gap: 'var(--s8)' }}>
          <button type="button" className="btn" onClick={() => navigate('/organizations')}>
            К списку
          </button>
          {data.contractType === 'subscription' && data.subscriptionTiyin > 0 && (
            <button type="button" className="btn" disabled={busy} onClick={() => void issueInvoice()}>
              Выставить СФ
            </button>
          )}
          <button
            type="button"
            className="btn"
            onClick={() => openDocument(`/documents/organizations/${data.id}/reconciliation`)}
          >
            Акт сверки
          </button>
          {data.status !== 'terminated' && (
            <button type="button" className="btn" disabled={busy} onClick={() => void toggleStatus()}>
              {data.status === 'active' ? 'Приостановить' : 'Активировать'}
            </button>
          )}
          {data.status !== 'terminated' && (
            <button
              type="button"
              className="btn btn--danger"
              disabled={busy}
              onClick={() => void terminate()}
            >
              Расторгнуть договор
            </button>
          )}
        </div>
      </div>

      {actionError !== null && <ErrorBanner message={actionError} />}

      {data.terminationNote && <div className="banner banner--warning">{data.terminationNote}</div>}

      <div className="card">
        <dl className="kv">
          <dt>ИНН</dt>
          <dd>{data.inn}</dd>
          <dt>НДС</dt>
          <dd>{data.vatPayer ? 'Плательщик НДС' : 'Без НДС'}</dd>
          <dt>Тип договора</dt>
          <dd>
            {contractTypeLabel(data.contractType)}, {contractKindLabel(data.contractKind)}
          </dd>
          <dt>Абонентка</dt>
          <dd>
            {data.contractType === 'subscription' ? formatSoums(data.subscriptionTiyin) : '—'}
          </dd>
          <dt>Создана</dt>
          <dd>{formatDate(data.createdAt)}</dd>
        </dl>
      </div>

      {data.contractType === 'subscription' && (
        <>
          <FinanceSection orgId={data.id} />
          <SubscriptionEstimate orgId={data.id} />
        </>
      )}

      <ContractSection key={data.id} org={data} onSaved={reload} onError={setActionError} />

      <div className="page-header" style={{ marginTop: 'var(--s24)' }}>
        <h1 style={{ fontSize: 16 }}>Точки обслуживания</h1>
        <button type="button" className="btn" onClick={() => setLocModalOpen(true)}>
          Добавить точку
        </button>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Название</th>
              <th>Адрес</th>
              <th className="num">Лимит на заказ</th>
              <th className="num">Лимит в месяц</th>
              <th>Фото</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {data.locations.length === 0 && <EmptyRow colSpan={6} />}
            {data.locations.map((loc) => (
              <tr key={loc.id}>
                <td>
                  {loc.name}{' '}
                  {loc.passport.areaM2 === null && (
                    <span
                      className="badge badge--warning"
                      title="Паспорт объекта не заполнен — абонентка считается по типовой площади (A-09)"
                    >
                      нет паспорта
                    </span>
                  )}
                </td>
                <td>{loc.address}</td>
                <td className="num">{formatSoums(loc.orderLimitTiyin)}</td>
                <td className="num">{formatSoums(loc.monthlyLimitTiyin)}</td>
                <td className="muted">{loc.photoForbidden ? 'Съёмка запрещена' : 'Разрешено'}</td>
                <td>
                  <div style={{ display: 'flex', gap: 'var(--s8)' }}>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setPassportFor(loc.id)}
                    >
                      Паспорт
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => setRepsFor(loc.id)}
                    >
                      Ответственные ({(loc.representatives ?? []).length})
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() => void openHistory(loc.id, loc.name)}
                    >
                      История точки
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() =>
                        openDocument(
                          `/documents/organizations/${data.id}/locations/${loc.id}/report`,
                        )
                      }
                    >
                      Отчёт
                    </button>
                    <button
                      type="button"
                      className="btn btn--secondary"
                      onClick={() =>
                        openDocument(
                          `/documents/organizations/${data.id}/locations/${loc.id}/maintenance-log`,
                        )
                      }
                    >
                      Журнал ТО
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {passportFor !== null &&
        (() => {
          const loc = data.locations.find((l) => l.id === passportFor);
          if (!loc) return null;
          return (
            <PassportModal
              key={loc.id}
              orgId={data.id}
              location={loc}
              onClose={() => setPassportFor(null)}
              onSaved={() => {
                setPassportFor(null);
                reload();
              }}
            />
          );
        })()}

      {repsFor !== null &&
        (() => {
          const loc = data.locations.find((l) => l.id === repsFor);
          if (!loc) return null;
          return (
            <RepresentativesModal
              key={loc.id}
              orgId={data.id}
              location={loc}
              thresholds={data.terms.approvalThresholds}
              onClose={() => setRepsFor(null)}
              onSaved={reload}
            />
          );
        })()}

      {historyFor && (
        <Modal title={`История точки: ${historyFor.name}`} onClose={() => setHistoryFor(null)} wide>
          {history === null ? (
            <Loading />
          ) : (
            <>
              <div className="tiles" style={{ marginBottom: 'var(--s12)' }}>
                <div className="card">
                  <div className="tile__value tile__value--sm">{history.totals.count}</div>
                  <div className="tile__label">Всего обращений</div>
                </div>
                <div className="card">
                  <div className="tile__value tile__value--sm">{history.totals.closed}</div>
                  <div className="tile__label">Закрыто</div>
                </div>
                <div className="card">
                  <div className="tile__value tile__value--sm">{formatSoums(history.totals.spentTiyin)}</div>
                  <div className="tile__label">Сумма закрытых работ</div>
                </div>
              </div>
              <div className="table-wrap" style={{ marginBottom: 'var(--s12)' }}>
                <table>
                  <thead>
                    <tr>
                      <th>Заявка</th>
                      <th>Статус</th>
                      <th>Что делали</th>
                      <th>Мастер</th>
                      <th className="num">Сумма</th>
                      <th>Дата</th>
                      <th>Фото</th>
                    </tr>
                  </thead>
                  <tbody>
                    {history.orders.length === 0 && <EmptyRow colSpan={7} />}
                    {history.orders.map((o) => (
                      <tr key={o.id}>
                        <td className="mono">{o.number}</td>
                        <td>{HISTORY_STATUS_RU[o.status] ?? o.status}</td>
                        <td>{o.description || '—'}</td>
                        <td>{o.masterName ?? '—'}</td>
                        <td className="num">{formatSoums(o.totalFromTiyin)}</td>
                        <td className="num">{formatDate(o.createdAt)}</td>
                        <td>
                          <OrderPhotos photos={o.photos ?? []} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="banner">
                Фото снимает приложение мастера: камера-only, серверный таймштамп, вечное
                хранение (PRD-05 §9). Клиент видит эту историю в своём приложении
                (лента точки C-35, отчёты C-39/C-47).
              </div>
              <div className="modal__actions">
                <button
                  type="button"
                  className="btn"
                  onClick={() =>
                    openDocument(
                      `/documents/organizations/${data.id}/locations/${historyFor.id}/report`,
                    )
                  }
                >
                  Выгрузить отчёт с фото (PDF)
                </button>
                <button
                  type="button"
                  className="btn btn--secondary"
                  onClick={() =>
                    openDocument(
                      `/documents/organizations/${data.id}/locations/${historyFor.id}/maintenance-log`,
                    )
                  }
                >
                  Журнал ТО точки
                </button>
              </div>
            </>
          )}
        </Modal>
      )}

      {locModalOpen && (
        <Modal title="Добавить точку" onClose={() => setLocModalOpen(false)}>
          <form className="form-grid" onSubmit={addLocation}>
            <div className="field">
              <label htmlFor="loc-name">Название</label>
              <input
                id="loc-name"
                value={locName}
                onChange={(e) => setLocName(e.target.value)}
                required
                autoFocus
              />
            </div>
            <div className="field">
              <label htmlFor="loc-address">Адрес</label>
              <input
                id="loc-address"
                value={locAddress}
                onChange={(e) => setLocAddress(e.target.value)}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="loc-order-limit">Лимит на заказ, сум</label>
              <input
                id="loc-order-limit"
                inputMode="numeric"
                value={orderLimitSoums}
                onChange={(e) => setOrderLimitSoums(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
            </div>
            <div className="field">
              <label htmlFor="loc-monthly-limit">Лимит в месяц, сум</label>
              <input
                id="loc-monthly-limit"
                inputMode="numeric"
                value={monthlyLimitSoums}
                onChange={(e) => setMonthlyLimitSoums(e.target.value.replace(/[^\d]/g, ''))}
                required
              />
            </div>
            <div className="modal__actions">
              <button type="button" className="btn" onClick={() => setLocModalOpen(false)}>
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

/**
 * Фото работы в истории точки. Отметка конвейера без файла — не ошибка:
 * мастер мог отметить шаг офлайн, снимок дойдёт очередью позже.
 */
function OrderPhotos({
  photos,
}: {
  photos: Array<{ id?: string; stage: string; file?: string; at: string }>;
}) {
  const before = photos.filter((p) => p.stage === 'before');
  const after = photos.filter((p) => p.stage === 'after');
  if (before.length === 0 && after.length === 0) {
    return <span className="muted">нет</span>;
  }
  const link = (label: string, list: typeof photos) => {
    const withFile = list.find((p) => p.file);
    if (!withFile) return <span className="badge badge--muted">{label} · {list.length}</span>;
    return (
      <a href={photoUrl(withFile.file as string)} target="_blank" rel="noreferrer noopener">
        <span className="badge badge--success">{label} · {list.length}</span>
      </a>
    );
  };
  return (
    <div style={{ display: 'flex', gap: 'var(--s4)' }}>
      {before.length > 0 && link('до', before)}
      {after.length > 0 && link('после', after)}
    </div>
  );
}
