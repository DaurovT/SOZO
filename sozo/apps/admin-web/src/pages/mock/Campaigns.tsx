import { MockBanner } from '../../components/MockBanner';

const TOUCHES: { title: string; description: string; partial?: boolean }[] = [
  {
    title: 'Контрольное касание «как дела»',
    description: 'Через 7–14 дней после закрытия заявки: всё ли работает, нужна ли помощь.',
    partial: true,
  },
  {
    title: 'Регламентное напоминание',
    description: 'Плановое ТО оборудования по регламенту производителя: фильтры, чистка, осмотр.',
  },
  {
    title: 'Сезонная кампания',
    description: 'Волны записей с дневным лимитом по зонам, чтобы не перегрузить мастеров.',
  },
  {
    title: 'Конец гарантии',
    description: 'За 7 дней до окончания гарантии по работе: предложение профилактики.',
  },
];

const WAVES: { wave: string; zone: string; dates: string; booked: number; limit: number; status: string }[] = [
  { wave: 'Волна 1', zone: 'Юнусабад, Мирзо-Улугбек', dates: '12.05–23.05', booked: 118, limit: 120, status: 'Завершена' },
  { wave: 'Волна 2', zone: 'Чиланзар, Учтепа', dates: '26.05–06.06', booked: 104, limit: 120, status: 'Завершена' },
  { wave: 'Волна 3', zone: 'Яккасарай, Шайхантахур', dates: '09.06–20.06', booked: 96, limit: 100, status: 'Завершена' },
  { wave: 'Волна 4', zone: 'Сергели, Бектемир', dates: '13.07–24.07', booked: 61, limit: 100, status: 'Идёт' },
  { wave: 'Волна 5', zone: 'Алмазар, Юнусабад (повтор)', dates: '10.08–21.08', booked: 0, limit: 120, status: 'Запланирована' },
];

export function MockCampaignsPage() {
  return (
    <>
      <div className="page-header">
        <h1>Кампании и сервисные касания</h1>
        <span className="muted">автоматические касания клиентов (ТЗ 17.12)</span>
      </div>
      <MockBanner phase="Фаза 2–3" dependsOn="планировщик и матрица уведомлений" />

      <div className="tiles">
        {TOUCHES.map((t) => (
          <div className="card" key={t.title}>
            <div className="semibold" style={{ marginBottom: 'var(--s4)' }}>
              {t.title}
              {t.partial === true && (
                <>
                  {' '}
                  <span className="badge badge--success">частично в MVP</span>
                </>
              )}
            </div>
            <div className="muted">{t.description}</div>
          </div>
        ))}
      </div>

      <div className="section-title">Пример кампании: «Чистка кондиционеров, май–сентябрь»</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Волна</th>
              <th>Зоны</th>
              <th>Даты</th>
              <th className="num">Записей / лимит</th>
              <th>Статус</th>
            </tr>
          </thead>
          <tbody>
            {WAVES.map((w) => (
              <tr key={w.wave}>
                <td>{w.wave}</td>
                <td>{w.zone}</td>
                <td className="num">{w.dates}</td>
                <td className="num">
                  {w.booked} / {w.limit}
                </td>
                <td>
                  <span
                    className={
                      w.status === 'Идёт'
                        ? 'badge badge--accent'
                        : w.status === 'Завершена'
                          ? 'badge badge--success'
                          : 'badge badge--muted'
                    }
                  >
                    {w.status}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 'var(--s12)' }}>
        Дневной лимит записей по зонам защищает мастеров от перегрузки в пик сезона.
      </p>
    </>
  );
}
