import { MockBanner } from '../../components/MockBanner';
import { formatSoums } from '../../format';

const LICENSEES: {
  name: string;
  categories: string[];
  license: string;
  validTill: string;
  expiring: boolean;
  commissionPct: number;
  ordersPassed: number;
  monthCommissionTiyin: number;
}[] = [
  { name: 'OOO «Toshkent Gaz Servis»', categories: ['газ'], license: 'ЛГ-1042', validTill: '31.12.2027', expiring: false, commissionPct: 12, ordersPassed: 34, monthCommissionTiyin: 4_160_000_00 },
  { name: 'OOO «Lift Master Group»', categories: ['лифты'], license: 'ЛЛ-0387', validTill: '30.09.2026', expiring: true, commissionPct: 10, ordersPassed: 18, monthCommissionTiyin: 2_940_000_00 },
  { name: 'OOO «Gaz Montaj Pro»', categories: ['газ'], license: 'ЛГ-2210', validTill: '15.05.2028', expiring: false, commissionPct: 12, ordersPassed: 21, monthCommissionTiyin: 2_580_000_00 },
];

export function MockLicenseesPage() {
  return (
    <>
      <div className="page-header">
        <h1>Лицензиаты (газ, лифты)</h1>
        <span className="muted">партнёры с лицензиями на регулируемые категории (ТЗ 17.8)</span>
      </div>
      <MockBanner phase="Фаза 2" dependsOn="договор с партнёром-лицензиатом" />
      <div className="banner">
        До подписания договора с лицензиатом категории «газ» и «лифты» закрыты в прайсе.
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Партнёр</th>
              <th>Категории</th>
              <th>Лицензия</th>
              <th>Действует до</th>
              <th className="num">Комиссия платформы</th>
              <th className="num">Заявок передано</th>
              <th className="num">Комиссия за месяц</th>
            </tr>
          </thead>
          <tbody>
            {LICENSEES.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td>
                  {l.categories.map((c) => (
                    <span key={c} className="chip">
                      {c}
                    </span>
                  ))}
                </td>
                <td className="mono">{l.license}</td>
                <td className="num">
                  {l.validTill}
                  {l.expiring && (
                    <>
                      {' '}
                      <span className="badge badge--warning">истекает</span>
                    </>
                  )}
                </td>
                <td className="num">{l.commissionPct}%</td>
                <td className="num">{l.ordersPassed}</td>
                <td className="num">{formatSoums(l.monthCommissionTiyin)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
