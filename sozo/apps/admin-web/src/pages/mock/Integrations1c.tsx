import { MockBanner } from '../../components/MockBanner';
import { useToast } from '../../components/Toast';

const HISTORY: { date: string; period: string; kind: string; rows: number; status: string; file: string }[] = [
  { date: '01.07.2026 09:12', period: 'Июнь 2026', kind: 'Проводки', rows: 1842, status: 'Выгружено', file: '1c-postings-2026-06.xml' },
  { date: '01.07.2026 09:15', period: 'Июнь 2026', kind: 'Счета-фактуры', rows: 37, status: 'Выгружено', file: '1c-invoices-2026-06.xml' },
  { date: '01.07.2026 09:18', period: 'Июнь 2026', kind: 'Ведомости', rows: 24, status: 'Выгружено', file: '1c-payouts-2026-06.xml' },
  { date: '02.06.2026 10:03', period: 'Май 2026', kind: 'Проводки', rows: 1518, status: 'Выгружено', file: '1c-postings-2026-05.xml' },
];

export function Mock1cPage() {
  const toast = useToast();

  return (
    <>
      <div className="page-header">
        <h1>Экспорт в 1С</h1>
        <span className="muted">выгрузка проводок, СФ и ведомостей для бухгалтерии</span>
      </div>
      <MockBanner phase="Фаза 2–3" dependsOn="формат от бухгалтера" />

      <div className="card" style={{ marginBottom: 'var(--s16)', maxWidth: 560 }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Настройки выгрузки
        </div>
        <div className="form-grid">
          <div className="field">
            <label>Период</label>
            <select defaultValue="2026-07">
              <option value="2026-07">Июль 2026</option>
              <option value="2026-06">Июнь 2026</option>
              <option value="2026-05">Май 2026</option>
            </select>
          </div>
          <div className="field">
            <label>Тип выгрузки</label>
            <select defaultValue="postings">
              <option value="postings">Проводки</option>
              <option value="invoices">Счета-фактуры</option>
              <option value="payouts">Ведомости</option>
            </select>
          </div>
          <div>
            <button type="button" className="btn btn--primary" onClick={() => toast('Функция фазы 2 — макет')}>
              Сформировать выгрузку
            </button>
          </div>
        </div>
      </div>

      <div className="section-title">История выгрузок</div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Период</th>
              <th>Тип</th>
              <th className="num">Строк</th>
              <th>Статус</th>
              <th>Файл</th>
            </tr>
          </thead>
          <tbody>
            {HISTORY.map((h, i) => (
              <tr key={i}>
                <td className="num">{h.date}</td>
                <td>{h.period}</td>
                <td>{h.kind}</td>
                <td className="num">{h.rows}</td>
                <td>
                  <span className="badge badge--success">{h.status}</span>
                </td>
                <td className="mono">{h.file}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
