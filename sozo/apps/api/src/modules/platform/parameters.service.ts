import { Injectable, NotFoundException } from '@nestjs/common';
import seed from '../../seed/system-parameters.json';
import { StateStore } from '../../common/state-store';

export interface SystemParam {
  num: number;
  name: string;
  value: string; // значение по умолчанию из PRD-04 §5; редактируется админом как текст/JSON
  levels: string[]; // global | contract | location | price
  usage: string;
  tz: string; // ссылка на разделы ТЗ
}

/**
 * Сводная таблица параметров системы — ЭТАЛОН: все 123 позиции PRD-04 §5,
 * распарсенные из документа (seed/system-parameters.json). В коде магических
 * чисел нет (DoD п.6); изменение применяется без деплоя (M0-E2-S7).
 */
/**
 * Настройки эксплуатации, которых нет в таблице PRD-04.
 *
 * Держим их в том же списке, а не заводим второй редактор: администратору
 * безразлично, из какого документа взялась строка, ему нужно поменять значение.
 * Номера начинаются с 200, чтобы никогда не столкнуться с ростом таблицы PRD.
 */
const OPERATIONAL: SystemParam[] = [
  {
    num: 200,
    name: 'Телефон диспетчерской службы',
    value: '+998712000000',
    levels: ['global'],
    usage: 'Показывается клиенту в приложении: кнопка «позвонить диспетчеру», памятка при аварии',
    tz: 'вне таблицы PRD-04 §5',
  },
  {
    num: 201,
    name: 'Публичный адрес для ссылок клиенту',
    value: 'https://sozo.uz',
    levels: ['global'],
    usage: 'Из него собирается ссылка на веб-карточку заявки в SMS (W-01…W-05)',
    tz: 'вне таблицы PRD-04 §5',
  },
  {
    num: 202,
    name: 'Платёжные реквизиты SOZO',
    value:
      'ООО «SOZO SERVICE» · ИНН 300000000 · р/с 20208000000000000001 в АКБ «Асака», МФО 00443 · назначение: оплата по договору технического обслуживания',
    levels: ['global'],
    usage: 'Показывается руководителю организации в приложении: по каким реквизитам платить счёт',
    tz: 'вне таблицы PRD-04 §5',
  },
];

@Injectable()
export class ParametersService {
  private readonly params = new Map<number, SystemParam>(
    [...(seed.params as SystemParam[]), ...OPERATIONAL].map((p) => [p.num, { ...p }]),
  );

  constructor(private readonly store: StateStore) {
    this.store.register(
      'parameters',
      () => [...this.params.values()],
      (d) => {
        for (const p of d as SystemParam[]) {
          const cur = this.params.get(p.num);
          if (cur) cur.value = p.value; // из файла берём только значения, метаданные — из PRD
        }
      },
    );
  }

  list(): SystemParam[] {
    return [...this.params.values()].sort((a, b) => a.num - b.num);
  }

  /** Значение параметра как строка. Пустое — берём запасное: экран не должен пустовать */
  text(num: number, fallback: string): string {
    return this.params.get(num)?.value?.trim() || fallback;
  }

  update(num: number, value: string): SystemParam {
    const p = this.params.get(num);
    if (!p) throw new NotFoundException({ code: 'PARAM_NOT_FOUND', param: num });
    p.value = value;
    this.store.persist();
    return p;
  }
}
