import { useState } from 'react';
import { api } from '../api';
import { useFetch } from '../useFetch';
import { formatDateTime } from '../format';
import { Modal } from '../components/Modal';
import { EmptyRow, ErrorBanner, Loading } from '../components/States';
import { useToast } from '../components/Toast';
import { RoleGate } from '../components/RoleGate';
import type { AdminUser } from '../types';

const ROLE_LABELS: Record<string, string> = {
  admin: 'Админ',
  accountant: 'Бухгалтер',
  dispatcher: 'Диспетчер',
  master: 'Мастер',
  client: 'Клиент',
};

function roleVariant(role: string): string {
  switch (role) {
    case 'admin':
      return 'accent';
    case 'accountant':
      return 'success';
    case 'dispatcher':
      return 'warning';
    default:
      return 'muted';
  }
}

interface LoginEvent {
  id: string;
  phone: string;
  at: string;
  ok: boolean;
  reason?: string;
  roles: string[];
}

export function UsersPage() {
  const toast = useToast();
  const { data, loading, error, reload } = useFetch<AdminUser[]>(() => api.get<AdminUser[]>('/admin/users'));
  const log = useFetch<{ events: LoginEvent[]; failed: number; note: string }>(
    () => api.get('/admin/users/login-log'),
    [],
  );
  const [blockTarget, setBlockTarget] = useState<AdminUser | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  if (loading) return <Loading />;
  if (error !== null) return <ErrorBanner message={error} />;

  const users = data ?? [];
  // Сотрудники платформы вперёд: клиенты и мастера попадают в этот реестр
  // как побочный эффект входа по SMS, и искать среди них администратора неудобно
  const staff = users.filter((u) => u.roles.some((r) => ['admin', 'accountant', 'dispatcher'].includes(r)));
  const others = users.filter((u) => !staff.includes(u));

  const block = async (u: AdminUser) => {
    setBusy(true);
    setActionError(null);
    try {
      if (u.blockedAt) {
        await api.post(`/admin/users/${u.id}/unblock`, {});
        toast(`${u.fullName}: доступ возвращён`);
      } else {
        if (!reason.trim()) {
          setActionError('Причина обязательна — её увидит тот, кто будет разбираться');
          return;
        }
        await api.post(`/admin/users/${u.id}/block`, { reason: reason.trim() });
        toast(`${u.fullName}: доступ закрыт`);
      }
      setBlockTarget(null);
      setReason('');
      reload();
      log.reload();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const row = (u: AdminUser) => (
    <tr key={u.id} className={u.blockedAt ? 'row--warning' : undefined}>
      <td className="num">{u.phone}</td>
      <td>
        {u.fullName}
        {u.blockedAt !== undefined && <div className="muted">доступ закрыт: {u.blockedReason}</div>}
      </td>
      <td>
        {u.roles.map((role) => (
          <span key={role} className={`badge badge--${roleVariant(role)}`} style={{ marginRight: 'var(--s4)' }}>
            {ROLE_LABELS[role] ?? role}
          </span>
        ))}
      </td>
      <td className="muted">{u.lastLoginAt === undefined ? 'не заходил' : formatDateTime(u.lastLoginAt)}</td>
      <td>
        {/* Блокировка — действие админа. Бухгалтеру кнопку не показываем: сервер
            всё равно откажет, а пообещать и отказать хуже, чем не обещать */}
        <RoleGate roles={['admin']}>
          <button
            type="button"
            className="btn btn--secondary"
            onClick={() => {
              setBlockTarget(u);
              setReason('');
              setActionError(null);
            }}
          >
            {u.blockedAt !== undefined ? 'Вернуть доступ' : 'Закрыть доступ'}
          </button>
        </RoleGate>
      </td>
    </tr>
  );

  return (
    <>
      <div className="page-header">
        <h1>Пользователи</h1>
        <span className="muted">{users.length} записей</span>
      </div>

      <div className="banner">
        Учётная запись не удаляется, а блокируется: её след остаётся в аудите, и человек, чьи
        действия там записаны, должен оставаться опознаваемым
      </div>

      <div className="section-title" style={{ marginTop: 0 }}>
        Сотрудники платформы
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Телефон</th>
              <th>Имя</th>
              <th>Роли</th>
              <th>Последний вход</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {staff.length === 0 && <EmptyRow colSpan={5} />}
            {staff.map(row)}
          </tbody>
        </table>
      </div>

      {others.length > 0 && (
        <>
          <div className="section-title">Остальные, кто входил</div>
          <div className="muted">
            Клиенты и мастера попадают сюда как побочный эффект входа по SMS — прав в админке
            у них нет
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Телефон</th>
                  <th>Имя</th>
                  <th>Роли</th>
                  <th>Последний вход</th>
                  <th />
                </tr>
              </thead>
              <tbody>{others.slice(0, 50).map(row)}</tbody>
            </table>
          </div>
        </>
      )}

      <RoleGate roles={['admin']}>
        <div className="section-title">Журнал входов</div>
        <div className="muted">{log.data?.note}</div>
        {(log.data?.failed ?? 0) > 0 && (
          <div className="banner banner--warning">
            Неудачных попыток: {log.data?.failed}. Серия отказов по одному номеру — это подбор,
            а не забывчивость
          </div>
        )}
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Время</th>
                <th>Телефон</th>
                <th>Результат</th>
                <th>Роли на момент входа</th>
              </tr>
            </thead>
            <tbody>
              {(log.data?.events ?? []).length === 0 && <EmptyRow colSpan={4} />}
              {(log.data?.events ?? []).slice(0, 100).map((e) => (
                <tr key={e.id} className={e.ok ? undefined : 'row--warning'}>
                  <td className="num">{formatDateTime(e.at)}</td>
                  <td className="num">{e.phone}</td>
                  <td>
                    {e.ok ? (
                      <span className="badge badge--success">вход</span>
                    ) : (
                      <>
                        <span className="badge badge--error">отказ</span>
                        <div className="muted">{e.reason}</div>
                      </>
                    )}
                  </td>
                  <td className="muted">{e.roles.map((r) => ROLE_LABELS[r] ?? r).join(', ')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </RoleGate>

      {blockTarget !== null && (
        <Modal
          title={
            blockTarget.blockedAt !== undefined
              ? `Вернуть доступ · ${blockTarget.fullName}`
              : `Закрыть доступ · ${blockTarget.fullName}`
          }
          onClose={() => setBlockTarget(null)}
        >
          {actionError !== null && <ErrorBanner message={actionError} />}
          {blockTarget.blockedAt !== undefined ? (
            <p className="muted">Человек снова сможет войти под своим номером.</p>
          ) : (
            <>
              <p className="muted">Вход по этому номеру перестанет работать сразу. Записи в аудите останутся.</p>
              <div className="field">
                <label htmlFor="u-reason">Причина</label>
                <textarea
                  id="u-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Например: уволен 2 августа"
                  autoFocus
                />
              </div>
            </>
          )}
          <div className="modal__actions">
            <button type="button" className="btn" onClick={() => setBlockTarget(null)}>
              Отмена
            </button>
            <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void block(blockTarget)}>
              {blockTarget.blockedAt !== undefined ? 'Вернуть доступ' : 'Закрыть доступ'}
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
