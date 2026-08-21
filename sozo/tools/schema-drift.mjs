/**
 * Опись расхождений схемы и кода.
 *
 * Пять перенесённых модулей показали одно и то же: schema.prisma писали по
 * DEV-02 раньше, чем сервисы обрели окончательный вид, и каждый перенос
 * начинается с миграции. Разбирать это по одному модулю — значит пять раз
 * заново удивиться. Отчёт считает расхождения сразу по всем, чтобы схему
 * можно было спроектировать один раз, а не догонять.
 *
 * Считает грубо, по именам полей: цель — не заменить проектирование, а
 * показать масштаб и место. Запуск: node tools/schema-drift.mjs
 */
import { readFileSync } from 'node:fs';


const schema = readFileSync('prisma/schema.prisma', 'utf8');

/** Пары «модель схемы → интерфейс записи в коде» */
const PAIRS = [
  ['Order', 'apps/api/src/modules/orders/order.repository.ts', 'OrderRecord'],
  ['Organization', 'apps/api/src/modules/crm/crm.service.ts', 'OrganizationRec'],
  ['Location', 'apps/api/src/modules/crm/crm.service.ts', 'LocationRec'],
  ['PriceItem', 'apps/api/src/modules/pricing/pricing.service.ts', 'PriceItemRec'],
  ['PriceListRelease', 'apps/api/src/modules/pricing/pricing.service.ts', 'ReleaseRec'],
  ['User', 'apps/api/src/modules/identity/identity.repository.ts', 'UserRecord'],
  ['Building', 'apps/api/src/modules/buildings/building.repository.ts', 'BuildingRecord'],
  ['AccessPermit', 'apps/api/src/modules/access/permit.repository.ts', 'PermitRecord'],
  ['VisitPass', 'apps/api/src/modules/access/permit.repository.ts', 'PassRecord'],
  ['ResourceShutdown', 'apps/api/src/modules/access/permit.repository.ts', 'ShutdownRecord'],
  // Дети объекта. Их не было в списке, и это скрыло целый класс расхождений:
  // пять моделей не совпадали с кодом настолько, что записать их было нельзя,
  // — а отчёт показывал ноль, потому что про них не спрашивали
  ['Unit', 'apps/api/src/modules/buildings/building.repository.ts', 'UnitRecord'],
  ['CommonZone', 'apps/api/src/modules/buildings/building.repository.ts', 'CommonZoneRecord'],
  ['BuildingStaff', 'apps/api/src/modules/buildings/building.repository.ts', 'BuildingStaffRecord'],
  ['UnitResident', 'apps/api/src/modules/buildings/building.repository.ts', 'ResidentRecord'],
  ['BuildingEquipment', 'apps/api/src/modules/buildings/building.repository.ts', 'EquipmentRecord'],
  ['Defect', 'apps/api/src/modules/buildings/building.repository.ts', 'DefectRecord'],
  ['BuildingObservation', 'apps/api/src/modules/buildings/building.repository.ts', 'ObservationRecord'],
];

/**
 * Известные переименования: в коде одно имя, в схеме другое. Без этого списка
 * отчёт кричит о пропусках там, где колонка есть под другим именем, — и ему
 * перестают верить целиком.
 */
const RENAMED = {
  lat: 'geoLat',
  lng: 'geoLng',
  passport: 'passportJson',
  access: 'accessJson',
  blacklistMasterIds: 'blacklistMasters',
  coeffs: 'coeffsJson',
  requiresEquipment: 'requiresEquip',
  terms: 'settingsJson',
  graphType: 'type',
  address: 'address',
  acceptance: 'acceptanceJson',
  acceptanceRequest: 'acceptanceRequestJson',
  addressDetails: 'addressDetailsJson',
  payment: 'paymentJson',
  requestedWindow: 'requestedWindowJson',
  commonAreaAccess: 'commonAreaAccessJson',
};

function modelFields(name) {
  const m = new RegExp(`model ${name} \\{([\\s\\S]*?)\\n\\}`).exec(schema);
  if (!m) return null;
  return new Set(
    m[1]
      .split('\n')
      .map((l) => /^\s+(\w+)\s/.exec(l)?.[1])
      .filter(Boolean),
  );
}

function recordFields(file, iface) {
  const src = readFileSync(file, 'utf8');
  const m = new RegExp(`interface ${iface} \\{([\\s\\S]*?)\\n\\}`).exec(src);
  if (!m) return null;
  return [...m[1].matchAll(/^ {2}(\w+)\??:/gm)].map((x) => x[1]);
}

console.log('\nРасхождения схемы и кода\n' + '='.repeat(60));
let total = 0;
for (const [model, file, iface] of PAIRS) {
  const cols = modelFields(model);
  const fields = recordFields(file, iface);
  if (!cols || !fields) {
    console.log(`\n${model} ↔ ${iface}: не разобрано (модель или интерфейс не найдены)`);
    continue;
  }
  const missing = fields.filter((f) => !cols.has(f) && !cols.has(RENAMED[f] ?? '\u0000'));
  total += missing.length;
  const pct = Math.round((missing.length / fields.length) * 100);
  console.log(`\n${model} ↔ ${iface}`);
  console.log(`  полей в коде: ${fields.length}, нет в схеме: ${missing.length} (${pct}%)`);
  if (missing.length) console.log(`  ${missing.join(', ')}`);
}
console.log('\n' + '='.repeat(60));
console.log(`Всего полей без колонки: ${total}`);
console.log('Считано по именам с поправкой на известные переименования;');
console.log('совпадение имени не гарантирует совпадение типа.');
