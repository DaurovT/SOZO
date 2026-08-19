import { MockBanner } from '../../components/MockBanner';
import { useToast } from '../../components/Toast';
import { formatSoums } from '../../format';

type EdoStatus = 'sent' | 'signed' | 'rejected' | 'draft';

const EDO_STATUS: Record<EdoStatus, { label: string; variant: string }> = {
  sent: { label: 'Отправлена', variant: 'accent' },
  signed: { label: 'Подписана контрагентом', variant: 'success' },
  rejected: { label: 'Отклонена', variant: 'error' },
  draft: { label: 'Черновик', variant: 'muted' },
};

const INVOICES: {
  number: string;
  org: string;
  amountTiyin: number;
  status: EdoStatus;
  signedAt: string;
}[] = [
  { number: 'INV-2026-00038', org: 'OOO «Korzinka Retail»', amountTiyin: 18_450_000_00, status: 'signed', signedAt: '10.07.2026' },
  { number: 'INV-2026-00039', org: 'Сеть кофеен «Bon!»', amountTiyin: 6_720_000_00, status: 'signed', signedAt: '11.07.2026' },
  { number: 'INV-2026-00041', org: 'Клиника «Shox Med»', amountTiyin: 9_180_000_00, status: 'sent', signedAt: '—' },
  { number: 'INV-2026-00042', org: 'OOO «Havas Food»', amountTiyin: 12_940_000_00, status: 'rejected', signedAt: '—' },
  { number: 'INV-2026-00043', org: 'БЦ «Tashkent City Mall»', amountTiyin: 24_600_000_00, status: 'sent', signedAt: '—' },
  { number: 'INV-2026-00044', org: 'OOO «Artel Service»', amountTiyin: 4_350_000_00, status: 'draft', signedAt: '—' },
];

export function MockEdoPage() {
  const toast = useToast();
  const mock = () => toast('Функция фазы 2 — макет');

  return (
    <>
      <div className="page-header">
        <h1>ЭДО (didox / faktura)</h1>
        <span className="muted">электронный документооборот по счетам-фактурам</span>
      </div>
      <MockBanner phase="Фаза 2" dependsOn="интеграция ЭДО-провайдера" />

      <div className="card" style={{ marginBottom: 'var(--s16)' }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Провайдер ЭДО
        </div>
        <button type="button" className="btn btn--primary" onClick={mock} style={{ marginRight: 'var(--s8)' }}>
          didox.uz — активен
        </button>
        <button type="button" className="btn" onClick={mock}>
          faktura.uz — резерв
        </button>
        <div className="tile__hint">
          При недоступности основного провайдера отправка переключается на резервный вручную.
        </div>
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Номер СФ</th>
              <th>Организация</th>
              <th className="num">Сумма</th>
              <th>Статус ЭДО</th>
              <th>Дата подписания</th>
            </tr>
          </thead>
          <tbody>
            {INVOICES.map((inv) => (
              <tr key={inv.number}>
                <td className="mono">{inv.number}</td>
                <td>{inv.org}</td>
                <td className="num">{formatSoums(inv.amountTiyin)}</td>
                <td>
                  <span className={`badge badge--${EDO_STATUS[inv.status].variant}`}>
                    {EDO_STATUS[inv.status].label}
                  </span>
                </td>
                <td className="num">{inv.signedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
