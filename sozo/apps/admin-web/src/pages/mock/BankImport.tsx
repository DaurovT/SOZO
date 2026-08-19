import { MockBanner } from '../../components/MockBanner';
import { useToast } from '../../components/Toast';
import { formatSoums } from '../../format';

const ROWS: {
  date: string;
  payer: string;
  purpose: string;
  amountTiyin: number;
  matchedTo: string | null;
}[] = [
  { date: '14.07.2026', payer: 'OOO «Korzinka Retail»', purpose: 'Оплата по договору Д-2026-011, тех. обслуживание', amountTiyin: 18_450_000_00, matchedTo: 'INV-2026-00038' },
  { date: '14.07.2026', payer: 'Сеть кофеен «Bon!»', purpose: 'Оплата СФ INV-2026-00039 за июнь', amountTiyin: 6_720_000_00, matchedTo: 'INV-2026-00039' },
  { date: '15.07.2026', payer: 'Клиника «Shox Med»', purpose: 'Абонентское обслуживание, июль', amountTiyin: 9_180_000_00, matchedTo: 'INV-2026-00041' },
  { date: '15.07.2026', payer: 'OOO «Havas Food»', purpose: 'Частичная оплата задолженности', amountTiyin: 5_000_000_00, matchedTo: 'INV-2026-00030' },
  { date: '16.07.2026', payer: 'ИП Рахимов Б.', purpose: 'Оплата за услуги б/н', amountTiyin: 1_240_000_00, matchedTo: null },
  { date: '16.07.2026', payer: 'БЦ «Tashkent City Mall»', purpose: 'Оплата по СФ INV-2026-00035', amountTiyin: 24_600_000_00, matchedTo: 'INV-2026-00035' },
  { date: '17.07.2026', payer: 'OOO «Artel Service»', purpose: 'ТО оборудования, договор Д-2026-019', amountTiyin: 4_350_000_00, matchedTo: 'INV-2026-00036' },
  { date: '17.07.2026', payer: 'OOO «Safia Bakery»', purpose: 'Оплата за сантехработы', amountTiyin: 2_860_000_00, matchedTo: 'INV-2026-00037' },
  { date: '18.07.2026', payer: 'OOO «Uzum Market»', purpose: 'Перевод средств (без реквизитов)', amountTiyin: 3_500_000_00, matchedTo: null },
  { date: '18.07.2026', payer: 'Сеть аптек «OxyMed»', purpose: 'Оплата абонентки, июль 2026', amountTiyin: 7_420_000_00, matchedTo: 'INV-2026-00040' },
];

export function MockBankImportPage() {
  const toast = useToast();
  const matched = ROWS.filter((r) => r.matchedTo !== null).length;

  return (
    <>
      <div className="page-header">
        <h1>Импорт банковской выписки</h1>
        <span className="muted">авторазнесение платежей по СФ методом FIFO</span>
      </div>
      <MockBanner phase="Фаза 2" dependsOn="формат выписки от банка" />

      <div className="card" style={{ marginBottom: 'var(--s16)' }}>
        <div className="section-title" style={{ marginTop: 0 }}>
          Загрузить выписку (MT940 / Excel)
        </div>
        <button type="button" className="btn btn--primary" onClick={() => toast('Функция фазы 2 — макет')}>
          Выбрать файл выписки
        </button>
        <div className="tile__hint">
          Поддерживаемые форматы: MT940, Excel-выгрузка интернет-банка. Строки разносятся по
          неоплаченным СФ организации в порядке FIFO.
        </div>
      </div>

      <div className="banner banner--success">
        Разнесено автоматически: {matched} из {ROWS.length}. Нераспознанные строки требуют ручной
        привязки.
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Дата</th>
              <th>Плательщик</th>
              <th>Назначение платежа</th>
              <th className="num">Сумма</th>
              <th>Авторазнесение</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((r, i) => (
              <tr key={i}>
                <td className="num">{r.date}</td>
                <td>{r.payer}</td>
                <td>{r.purpose}</td>
                <td className="num">{formatSoums(r.amountTiyin)}</td>
                <td>
                  {r.matchedTo !== null ? (
                    <span className="badge badge--success">→ {r.matchedTo} (FIFO)</span>
                  ) : (
                    <span className="badge badge--warning">Не распознано — вручную</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
