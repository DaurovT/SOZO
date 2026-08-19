import { MockBanner } from '../../components/MockBanner';
import { formatSoums } from '../../format';

const EQUIPMENT: {
  inv: string;
  name: string;
  costTiyin: number;
  lifeMonths: number;
  accruedTiyin: number;
  nextService: string;
  overdue: boolean;
}[] = [
  { inv: 'EQ-0012', name: 'Перфоратор Bosch GBH 2-26', costTiyin: 3_800_000_00, lifeMonths: 36, accruedTiyin: 1_478_000_00, nextService: '05.08.2026', overdue: false },
  { inv: 'EQ-0018', name: 'Течеискатель Testo 316-2', costTiyin: 6_200_000_00, lifeMonths: 48, accruedTiyin: 1_033_000_00, nextService: '12.07.2026', overdue: true },
  { inv: 'EQ-0023', name: 'Опрессовщик ROTHENBERGER RP 50', costTiyin: 5_400_000_00, lifeMonths: 60, accruedTiyin: 630_000_00, nextService: '20.09.2026', overdue: false },
  { inv: 'EQ-0027', name: 'Тепловизор FLIR C5', costTiyin: 9_800_000_00, lifeMonths: 48, accruedTiyin: 1_225_000_00, nextService: '28.06.2026', overdue: true },
  { inv: 'EQ-0031', name: 'Станция вакуумирования Value VP-240', costTiyin: 4_600_000_00, lifeMonths: 36, accruedTiyin: 383_000_00, nextService: '15.10.2026', overdue: false },
  { inv: 'EQ-0034', name: 'Аппарат сварки полипропилена Dytron P-4a', costTiyin: 2_900_000_00, lifeMonths: 24, accruedTiyin: 483_000_00, nextService: '02.09.2026', overdue: false },
];

export function MockDepreciationPage() {
  return (
    <>
      <div className="page-header">
        <h1>Амортизация и ТО</h1>
        <span className="muted">оборудование платформы: износ и обслуживание</span>
      </div>
      <MockBanner phase="Фаза 2" dependsOn="закрытие первого полного периода" />

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Инв. №</th>
              <th>Оборудование</th>
              <th className="num">Стоимость</th>
              <th className="num">Срок службы, мес</th>
              <th className="num">Начислено амортизации</th>
              <th className="num">Остаточная</th>
              <th>Следующее ТО</th>
            </tr>
          </thead>
          <tbody>
            {EQUIPMENT.map((e) => (
              <tr key={e.inv} className={e.overdue ? 'row--warning' : undefined}>
                <td className="mono">{e.inv}</td>
                <td>{e.name}</td>
                <td className="num">{formatSoums(e.costTiyin)}</td>
                <td className="num">{e.lifeMonths}</td>
                <td className="num">{formatSoums(e.accruedTiyin)}</td>
                <td className="num">{formatSoums(e.costTiyin - e.accruedTiyin)}</td>
                <td className="num">
                  {e.nextService}
                  {e.overdue && (
                    <>
                      {' '}
                      <span className="badge badge--warning">просрочено</span>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ marginTop: 'var(--s12)' }}>
        Линейная амортизация начисляется ежемесячной проводкой при закрытии периода (ТЗ 17.9).
      </p>
    </>
  );
}
