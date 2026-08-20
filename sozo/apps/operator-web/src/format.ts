/** Деньги приходят в тийинах (DEV-02): 1 сум = 100 тийин. Копейки не показываем. */
export function soums(tiyin: number): string {
  return Math.round(tiyin / 100).toLocaleString('ru-RU').replace(/ /g, ' ');
}

export function timeShort(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('ru-RU', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  });
}

export function windowText(from: string | null, to: string | null): string {
  if (!from || !to) return 'окно не выбрано';
  const f = new Date(from);
  const t = new Date(to);
  const day = f.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
  const hm = (d: Date) => d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${hm(f)} — ${hm(t)}`;
}

/**
 * Остаток до срока словами. Просрочку показываем явно и со знаком:
 * «просрочено на 40 мин» читается быстрее, чем «-40 мин».
 */
export function untilText(iso: string | null, now = Date.now()): { text: string; overdue: boolean } {
  if (!iso) return { text: 'без срока', overdue: false };
  const diff = Date.parse(iso) - now;
  const abs = Math.abs(diff);
  const h = Math.floor(abs / 3_600_000);
  const m = Math.floor((abs % 3_600_000) / 60_000);
  const body = h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
  return diff < 0 ? { text: `просрочено на ${body}`, overdue: true } : { text: `осталось ${body}`, overdue: false };
}

const ZONE_NAMES: Record<string, string> = {
  electrical_panel: 'Электрощитовая',
  water_riser: 'Стояк ХВС',
  sewage_riser: 'Канализационный стояк',
  basement: 'Подвал',
  roof: 'Кровля',
  technical_floor: 'Техэтаж',
  lift_machine_room: 'Лифтовая',
  ventilation_chamber: 'Вентиляционная камера',
  heat_point: 'ИТП',
  gas_equipment: 'Газовое оборудование',
  fire_system: 'Пожарные системы',
  yard: 'Двор',
};

export function zoneName(type: string): string {
  return ZONE_NAMES[type] ?? type;
}

/**
 * Подписи ресурсов приходят из общего справочника: своя копия здесь уже
 * разъезжалась с сервером по регистру, а кабинет и приложение мастера
 * показывают одно и то же отключение.
 */
/**
 * Подписи ресурсов приходят с сервера (`/buildings/resource-labels`) и живут
 * здесь до перезагрузки страницы. Своя копия в кабинете уже разъезжалась с
 * сервером по регистру, а кабинет и приложение мастера показывают одно и то
 * же отключение.
 *
 * Пакет контрактов сюда не импортируется: он собирается в CommonJS под API, а
 * Vite не трансформирует CJS вне node_modules.
 */
let resourceLabels: Record<string, string> = {};

export function setResourceLabels(rows: Array<{ code: string; label: string }>): void {
  resourceLabels = Object.fromEntries(rows.map((r) => [r.code, r.label]));
}

export function resourceLabelCodes(): string[] {
  return Object.keys(resourceLabels);
}

/** До загрузки справочника возвращаем код: пустая строка хуже — она молчит */
export function resourceName(type: string): string {
  return resourceLabels[type] ?? type;
}
