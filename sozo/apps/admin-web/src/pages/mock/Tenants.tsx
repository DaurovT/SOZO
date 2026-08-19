import { MockBanner } from '../../components/MockBanner';
import { useToast } from '../../components/Toast';

const FLAGS: { name: string; on: boolean }[] = [
  { name: 'Партнёрские магазины', on: false },
  { name: 'Авто-рейтинг', on: false },
  { name: 'ЭДО', on: false },
  { name: 'Телефония', on: true },
  { name: 'Telegram-бот', on: false },
];

export function MockTenantsPage() {
  const toast = useToast();

  return (
    <>
      <div className="page-header">
        <h1>Тенанты и фича-флаги (SaaS)</h1>
        <span className="muted">мультигородность как задел (ТЗ 17.13)</span>
      </div>
      <MockBanner phase="Фаза 3" dependsOn="выход во второй город" />
      <div className="banner">
        Поле tenant_id уже присутствует во всех сущностях с первого дня — миграция на SaaS не
        потребует пересборки данных.
      </div>

      <div className="table-wrap" style={{ marginBottom: 'var(--s16)' }}>
        <table>
          <thead>
            <tr>
              <th>Тенант</th>
              <th>Город</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td className="semibold">SOZO Ташкент</td>
              <td>Ташкент (город 1)</td>
              <td>
                <span className="badge badge--success">Активен</span>
              </td>
            </tr>
            <tr>
              <td className="muted">Самарканд</td>
              <td className="muted">—</td>
              <td>
                <span className="badge badge--muted">План</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div className="card">
        <div className="section-title" style={{ marginTop: 0 }}>
          Фича-флаги тенанта «SOZO Ташкент»
        </div>
        <div>
          {FLAGS.map((f) => (
            <button
              key={f.name}
              type="button"
              className="btn"
              style={{ marginRight: 'var(--s8)', marginBottom: 'var(--s8)', height: 30, fontSize: 12 }}
              onClick={() => toast('Функция фазы 3 — макет')}
            >
              {f.name}
              {'  '}
              <span
                className={f.on ? 'badge badge--success' : 'badge badge--muted'}
                style={{ marginLeft: 'var(--s8)' }}
              >
                {f.on ? 'вкл' : 'выкл'}
              </span>
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
