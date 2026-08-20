import { useState } from 'react';
import { api, ApiError } from '../api';
import { useFetch } from '../useFetch';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';

/**
 * A-39. Единственное место, где объект получает право на существование
 * в контуре «Дом». Закрывает дыру: без модерации любой заявил бы чужой дом
 * и начал согласовывать допуски в жилое здание.
 */

interface Claim {
  id: string;
  buildingId: string;
  operatorOrgId: string;
  operatorName: string;
  applicantPhone: string;
  documentKind: string;
  contactPhone: string | null;
  status: 'pending' | 'frozen' | 'approved' | 'rejected';
  callbackResult: 'confirmed' | 'denied' | 'no_answer' | null;
  decisionBy: string | null;
  decisionReason: string | null;
  createdAt: string;
}

interface Signals {
  claim: Claim;
  building: { id: string; name: string; address: string; connectionStatus: string };
  signals: {
    knownContacts: Array<{ locationName: string; hoaContact: string; matches: boolean }>;
    contactMatches: boolean;
    callbackResult: string | null;
    unitsRegistered: number;
    demandFromResidents: number;
  };
  competing: Array<{ id: string; operatorName: string; documentKind: string; createdAt: string }>;
}

interface Demand {
  address: string;
  count: number;
  lastAt: string;
}

const STATUS_LABEL: Record<string, string> = {
  pending: 'Ждёт решения',
  frozen: 'Заморожена — конфликт',
  approved: 'Одобрена',
  rejected: 'Отклонена',
};

export function BuildingsPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'queue' | 'demand'>('queue');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const claims = useFetch<Claim[]>(() => api.get<Claim[]>('/buildings/claims/queue'), []);
  const demand = useFetch<Demand[]>(() => api.get<Demand[]>('/buildings/demand'), []);
  const signals = useFetch<Signals | null>(
    () => (openId ? api.get<Signals>(`/buildings/claims/${openId}/signals`) : Promise.resolve(null)),
    [openId],
  );

  if (claims.loading) return <Loading />;
  if (claims.error !== null) return <ErrorBanner message={claims.error} />;

  const list = (claims.data ?? []).filter((c) => c.status === 'pending' || c.status === 'frozen');

  async function decide(id: string, decision: 'approve' | 'reject') {
    const reason =
      decision === 'reject'
        ? window.prompt('Причина отказа — она останется в аудите')
        : window.prompt('Основание решения', 'Документы и контакт сошлись');
    if (decision === 'reject' && !reason) return;
    setBusy(true);
    try {
      await api.post(`/buildings/claims/${id}/decide`, { decision, reason: reason ?? '' });
      toast(decision === 'approve' ? 'Объект верифицирован' : 'Заявка отклонена');
      setOpenId(null);
      claims.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  }

  async function callback(id: string, result: string) {
    setBusy(true);
    try {
      await api.post(`/buildings/claims/${id}/callback`, { result });
      toast('Результат звонка записан');
      signals.reload();
    } catch (e) {
      toast(e instanceof ApiError ? e.message : 'Не удалось');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="page-header">
        <h1>Подключение объектов</h1>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className={`btn ${tab === 'queue' ? '' : 'btn--secondary'}`} onClick={() => setTab('queue')}>
            Очередь · {list.length}
          </button>
          <button className={`btn ${tab === 'demand' ? '' : 'btn--secondary'}`} onClick={() => setTab('demand')}>
            «Моего дома нет» · {(demand.data ?? []).length}
          </button>
        </div>
      </div>

      {tab === 'queue' ? (
        <>
          <p className="muted" style={{ marginBottom: 12 }}>
            Ни один объект не поднимается выше «заявлен» автоматически. Решение принимает человек,
            и оно записывается вместе с основанием.
          </p>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Организация</th><th>Документ</th><th>Заявитель</th><th>Статус</th><th />
                </tr>
              </thead>
              <tbody>
                {list.length === 0 && <EmptyRow colSpan={5} />}
                {list.map((c) => (
                  <tr key={c.id}>
                    <td>{c.operatorName}</td>
                    <td>{c.documentKind}</td>
                    <td>{c.applicantPhone}</td>
                    <td>
                      <span className={c.status === 'frozen' ? 'tone--error' : 'tone--warn'}>
                        {STATUS_LABEL[c.status]}
                      </span>
                    </td>
                    <td>
                      <button className="btn btn--secondary" onClick={() => setOpenId(c.id)}>Разобрать</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {openId && signals.data && <SignalsPanel s={signals.data} busy={busy} onDecide={decide} onCallback={callback} onClose={() => setOpenId(null)} />}
        </>
      ) : (
        <>
          <p className="muted" style={{ marginBottom: 12 }}>
            Обращения жителей с публичной страницы объекта. Накопленный спрос — готовый аргумент
            в разговоре с управляющей компанией этого дома.
          </p>
          <div className="table-wrap">
            <table>
              <thead><tr><th>Адрес</th><th className="num">Обращений</th><th>Последнее</th></tr></thead>
              <tbody>
                {(demand.data ?? []).length === 0 && <EmptyRow colSpan={3} />}
                {(demand.data ?? []).map((d) => (
                  <tr key={d.address}>
                    <td>{d.address}</td>
                    <td className="num">{d.count}</td>
                    <td>{new Date(d.lastAt).toLocaleDateString('ru-RU')}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}

/** Карточка разбора: сигналы, а не приговор — решение всё равно за человеком. */
function SignalsPanel({
  s, busy, onDecide, onCallback, onClose,
}: {
  s: Signals;
  busy: boolean;
  onDecide: (id: string, d: 'approve' | 'reject') => void;
  onCallback: (id: string, r: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="card" style={{ marginTop: 16, padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: 12 }}>
        <h2 style={{ margin: 0 }}>{s.building.name}</h2>
        <button className="btn btn--secondary" style={{ marginLeft: 'auto' }} onClick={onClose}>Закрыть</button>
      </div>
      <p className="muted">{s.building.address}</p>

      <h3 style={{ marginTop: 16 }}>Сигналы</h3>
      <ul style={{ lineHeight: 1.8 }}>
        <li>
          Контакт ТСЖ/УК из паспортов точек:{' '}
          {s.signals.knownContacts.length === 0 ? (
            <span className="muted">данных нет</span>
          ) : (
            <span className={s.signals.contactMatches ? 'tone--success' : 'tone--error'}>
              {s.signals.contactMatches ? 'совпадает с заявленным' : 'НЕ совпадает с заявленным'}
            </span>
          )}
          {s.signals.knownContacts.map((k) => (
            <div key={k.locationName} className="muted" style={{ marginLeft: 16 }}>
              {k.locationName}: {k.hoaContact}
            </div>
          ))}
        </li>
        <li>Обратный звонок: {s.signals.callbackResult ?? <span className="muted">не сделан</span>}</li>
        <li>Помещений в реестре: {s.signals.unitsRegistered}</li>
        <li>Обращений жителей «моего дома нет»: {s.signals.demandFromResidents}</li>
      </ul>

      {s.competing.length > 0 && (
        <div className="banner banner--error" style={{ margin: '12px 0' }}>
          <b>Конфликт заявителей.</b> На объект претендует также{' '}
          {s.competing.map((c) => `${c.operatorName} (${c.documentKind})`).join(', ')}.
          Приоритет — у предъявившего договор управления; при неразрешимом споре объект остаётся
          неподключённым: платформа не арбитр между хозяйствующими субъектами.
        </div>
      )}

      <h3 style={{ marginTop: 16 }}>Обратный звонок на телефон объекта</h3>
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        {(['confirmed', 'denied', 'no_answer'] as const).map((r) => (
          <button key={r} className="btn btn--secondary" disabled={busy} onClick={() => onCallback(s.claim.id, r)}>
            {r === 'confirmed' ? 'Подтвердили' : r === 'denied' ? 'Не подтвердили' : 'Не ответили'}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn" disabled={busy} onClick={() => onDecide(s.claim.id, 'approve')}>
          Верифицировать объект
        </button>
        <button className="btn btn--danger" disabled={busy} onClick={() => onDecide(s.claim.id, 'reject')}>
          Отклонить заявку
        </button>
      </div>
    </div>
  );
}
