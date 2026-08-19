import { MockBanner } from '../../components/MockBanner';

const MATRIX: { event: string; recipient: string; channels: string[] }[] = [
  { event: 'Мастер назначен', recipient: 'Клиент', channels: ['Push'] },
  { event: 'Мастер выехал + ETA', recipient: 'Клиент', channels: ['Push', 'SMS'] },
  { event: 'Вынужденная доп-работа', recipient: 'Клиент', channels: ['Push', 'Звонок диспетчера'] },
  { event: 'Смета требует утверждения (T+24)', recipient: 'Клиент / организация', channels: ['Push', 'SMS', 'Веб-ссылка'] },
  { event: 'Акт готов к приёмке', recipient: 'Клиент', channels: ['Push', 'Веб-ссылка'] },
  { event: 'Оцените работу', recipient: 'Клиент', channels: ['Push'] },
  { event: 'Авария на точке', recipient: 'Диспетчер, менеджер точки', channels: ['Push', 'Звонок диспетчера'] },
  { event: 'OTP-код входа', recipient: 'Клиент / мастер', channels: ['SMS'] },
  { event: 'Новый оффер', recipient: 'Мастер', channels: ['Push'] },
  { event: 'Ведомость выплачена', recipient: 'Мастер', channels: ['Push', 'SMS'] },
];

const PROFILES: { name: string; description: string }[] = [
  {
    name: 'Стандартный',
    description: 'Push через FCM; критичные события дублируются SMS при отсутствии доставки.',
  },
  {
    name: 'FCM-fallback',
    description: 'Android без сервисов Google: критичное всегда дублируется SMS.',
  },
  {
    name: 'SMS + веб-ссылка',
    description: 'Клиенты без приложения: SMS со ссылкой на веб-карточку заявки.',
  },
];

export function MockNotificationsPage() {
  return (
    <>
      <div className="page-header">
        <h1>Матрица уведомлений</h1>
        <span className="muted">событие → получатель → каналы (PRD-05 §6)</span>
      </div>
      <MockBanner phase="Фаза 2" dependsOn="SMS-шлюз Eskiz и FCM" />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Событие</th>
              <th>Получатель</th>
              <th>Каналы</th>
            </tr>
          </thead>
          <tbody>
            {MATRIX.map((m) => (
              <tr key={m.event}>
                <td>{m.event}</td>
                <td>{m.recipient}</td>
                <td>
                  {m.channels.map((c) => (
                    <span key={c} className="chip">
                      {c}
                    </span>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="section-title">Профили доставки</div>
      <div className="tiles">
        {PROFILES.map((p) => (
          <div className="card" key={p.name}>
            <div className="semibold" style={{ marginBottom: 'var(--s4)' }}>
              {p.name}
            </div>
            <div className="muted">{p.description}</div>
          </div>
        ))}
      </div>

      <div className="card">
        <div className="semibold" style={{ marginBottom: 'var(--s4)' }}>
          Правила гигиены
        </div>
        <div className="muted">
          Маркетинговые уведомления — не чаще 1 push в 2 недели. Отписка от маркетинга — в 1 тап.
          Сервисные уведомления от отписки не зависят.
        </div>
      </div>
    </>
  );
}
