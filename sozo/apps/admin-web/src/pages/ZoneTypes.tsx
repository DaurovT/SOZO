/**
 * A-41. Справочник типов общих зон и маппинг допусков.
 *
 * Два флага здесь несут разный смысл и путать их нельзя:
 * критичная — авто-согласие молчанием запрещено, наряд ждёт человека;
 * лицензируемая — наряд мастеру платформы не выдаётся вообще (ТЗ 17.8).
 *
 * Флаги редактирует только админ платформы. Оператор вправе ужесточить
 * критичность на своём объекте, ослабить — нет.
 */

interface ZoneType {
  code: string;
  label: string;
  critical: boolean;
  licensed: boolean;
  qualification: string | null;
}

const ZONES: ZoneType[] = [
  { code: 'water_riser', label: 'Стояк ХВС', critical: false, licensed: false, qualification: null },
  { code: 'sewage_riser', label: 'Канализационный стояк', critical: false, licensed: false, qualification: null },
  { code: 'basement', label: 'Подвал', critical: false, licensed: false, qualification: 'замкнутые пространства' },
  { code: 'yard', label: 'Двор', critical: false, licensed: false, qualification: null },
  { code: 'technical_floor', label: 'Техэтаж', critical: false, licensed: false, qualification: null },
  { code: 'electrical_panel', label: 'Электрощитовая', critical: true, licensed: false, qualification: 'группа по электробезопасности' },
  { code: 'roof', label: 'Кровля', critical: true, licensed: false, qualification: 'работы на высоте' },
  { code: 'heat_point', label: 'ИТП', critical: true, licensed: false, qualification: 'тепловые энергоустановки' },
  { code: 'ventilation_chamber', label: 'Камера дымоудаления', critical: true, licensed: false, qualification: null },
  { code: 'gas_equipment', label: 'Газовое оборудование', critical: true, licensed: true, qualification: 'лицензия на газ' },
  { code: 'lift_machine_room', label: 'Лифтовая', critical: true, licensed: true, qualification: 'лицензия на лифты' },
  { code: 'fire_system', label: 'Пожарные системы', critical: true, licensed: true, qualification: 'лицензия МЧС' },
];

export function ZoneTypesPage() {
  return (
    <>
      <div className="page-header">
        <h1>Типы зон и допуски</h1>
      </div>

      <div className="banner" style={{ marginBottom: 12 }}>
        <b>Критичная</b> — авто-согласие молчанием запрещено, наряд ждёт решения человека.{' '}
        <b>Лицензируемая</b> — наряд мастеру платформы не выдаётся вообще: работы выполняет
        служба оператора или лицензиат (ТЗ 17.8).
      </div>

      <div className="table-wrap">
        <table>
          <thead>
            <tr><th>Зона</th><th>Код</th><th>Критичная</th><th>Лицензируемая</th><th>Требуемая квалификация</th></tr>
          </thead>
          <tbody>
            {ZONES.map((z) => (
              <tr key={z.code}>
                <td>{z.label}</td>
                <td className="muted">{z.code}</td>
                <td>{z.critical ? <span className="tone--warn">да</span> : '—'}</td>
                <td>{z.licensed ? <span className="tone--error">да</span> : '—'}</td>
                <td className="muted">{z.qualification ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
