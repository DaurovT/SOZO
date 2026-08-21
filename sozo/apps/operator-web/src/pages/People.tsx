import { getOrgId } from '../auth';
import { useFetch } from '../useFetch';
import { Empty, ErrorState, Loading } from '../components/States';

/**
 * U-14. Люди оператора и их роли.
 *
 * Человек здесь существует как роль на объекте, а не как учётная запись:
 * один и тот же телефон бывает согласующим на одном доме и консьержем на
 * другом. «Пользователь оператора» без объекта не значит ничего — ему нечего
 * согласовывать и некуда пускать.
 *
 * Первое, что показывает экран, — объекты без согласующего. Такой объект не
 * активируется и не согласует наряды, а узнают об этом обычно в тот момент,
 * когда наряд уже нужен.
 */

interface PeopleData {
  total: number;
  buildingsWithoutApprover: Array<{ id: string; name: string }>;
  people: Array<{
    phone: string;
    fullName: string;
    roles: Array<{ buildingId: string; buildingName: string; staffRole: string; isBackup: boolean }>;
  }>;
}

const ROLE: Record<string, string> = {
  approver: 'согласующий',
  concierge: 'консьерж',
  engineer: 'инженер',
  manager: 'управляющий',
  security: 'охрана',
};

export function People() {
  const org = getOrgId();
  const { data, loading, error, reload } = useFetch<PeopleData>(org ? `/operator/${org}/people` : null);

  if (loading) return <Loading />;
  if (error) return <ErrorState error={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <>
      <div>
        <h1 className="h1">Люди и роли</h1>
        <div className="cap" style={{ marginTop: 'var(--s4)' }}>{data.total} человек на объектах</div>
      </div>

      {data.buildingsWithoutApprover.length > 0 && (
        <div className="card" style={{ padding: 'var(--s16)', background: 'rgba(220,50,50,.06)', border: '1px solid rgba(220,50,50,.3)' }}>
          <div className="dense">
            <b>Без согласующего: {data.buildingsWithoutApprover.map((b) => b.name).join(', ')}.</b>{' '}
            Такой объект не активируется, а наряды-допуски на нём согласовать некому — работа
            встанет в момент, когда она понадобится.
          </div>
        </div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        {data.people.length === 0 ? (
          <Empty text="Людей на объектах пока нет" />
        ) : (
          <table>
            <thead>
              <tr><th>Человек</th><th>Телефон</th><th>Роли по объектам</th></tr>
            </thead>
            <tbody>
              {data.people.map((p) => (
                <tr key={p.phone}>
                  <td style={{ fontWeight: 600 }}>{p.fullName}</td>
                  <td className="cap">{p.phone}</td>
                  <td className="dense">
                    {p.roles.map((r, i) => (
                      <div key={`${r.buildingId}-${i}`}>
                        {r.buildingName} — {ROLE[r.staffRole] ?? r.staffRole}
                        {r.isBackup ? ' (резервный)' : ''}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  );
}
