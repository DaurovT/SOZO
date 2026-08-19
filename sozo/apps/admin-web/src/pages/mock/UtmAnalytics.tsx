import { MockBanner } from '../../components/MockBanner';
import { formatSoums } from '../../format';

const CAMPAIGNS: {
  source: string;
  leads: number;
  orders: number;
  contracts: number;
  revenueTiyin: number;
  leadCostTiyin: number | null;
  roiPct: number | null;
}[] = [
  { source: 'instagram / b2b_launch', leads: 84, orders: 31, contracts: 6, revenueTiyin: 96_400_000_00, leadCostTiyin: 148_000_00, roiPct: 312 },
  { source: 'google / santehnik_tashkent', leads: 212, orders: 118, contracts: 0, revenueTiyin: 74_800_000_00, leadCostTiyin: 62_000_00, roiPct: 187 },
  { source: 'telegram / master_recruiting', leads: 57, orders: 0, contracts: 0, revenueTiyin: 0, leadCostTiyin: 39_000_00, roiPct: null },
  { source: 'звонок (лендинг-номер)', leads: 143, orders: 96, contracts: 3, revenueTiyin: 58_100_000_00, leadCostTiyin: null, roiPct: null },
];

export function MockUtmAnalyticsPage() {
  return (
    <>
      <div className="page-header">
        <h1>Сквозная аналитика (UTM)</h1>
        <span className="muted">от источника трафика до выручки (ТЗ 17.15)</span>
      </div>
      <MockBanner phase="Фаза 2" dependsOn="лендинги и разметка каналов" />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Источник / кампания</th>
              <th className="num">Лидов</th>
              <th className="num">Заявок</th>
              <th className="num">Договоров</th>
              <th className="num">Выручка</th>
              <th className="num">Стоимость лида</th>
              <th className="num">ROI</th>
            </tr>
          </thead>
          <tbody>
            {CAMPAIGNS.map((c) => (
              <tr key={c.source}>
                <td className="mono">{c.source}</td>
                <td className="num">{c.leads}</td>
                <td className="num">{c.orders}</td>
                <td className="num">{c.contracts}</td>
                <td className="num">{c.revenueTiyin > 0 ? formatSoums(c.revenueTiyin) : '—'}</td>
                <td className="num">{c.leadCostTiyin !== null ? formatSoums(c.leadCostTiyin) : '—'}</td>
                <td className="num">
                  {c.roiPct !== null ? (
                    <span className={c.roiPct >= 100 ? 'badge badge--success' : 'badge badge--error'}>
                      {c.roiPct}%
                    </span>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 'var(--s12)' }}>
        Рекрутинговые кампании (наём мастеров) не создают выручку напрямую — ROI не считается.
        Стоимость лида задаётся вручную по расходам канала.
      </p>
    </>
  );
}
