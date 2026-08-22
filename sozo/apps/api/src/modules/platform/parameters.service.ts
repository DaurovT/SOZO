import { Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import seed from '../../seed/system-parameters.json';
import { uuidv7 } from '@sozo/kernel';
import { StateStore } from '../../common/state-store';
import { PrismaService } from '../../common/prisma.service';
import { currentDbContext, systemContext } from '../../common/db-context';

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
  {
    num: 203,
    name: 'Частотный потолок сервисных push, дней',
    value: '14',
    levels: ['global'],
    usage:
      'Сервисные касания («как дела», регламентные напоминания, кампании) уходят человеку не чаще одного в это окно. ' +
      'Операционные уведомления по заявке потолком не ограничены',
    tz: 'ТЗ §17.12',
  },
  {
    num: 204,
    name: 'Дублировать критичные push по SMS (1/0)',
    value: '1',
    levels: ['global'],
    usage:
      'Ноль выключает SMS-дубли целиком. Дубль уходит только тогда, когда push-канал настроен по-настоящему: ' +
      'пока FCM не подключён, токенов нет ни у кого, и дублирование превратилось бы в платную SMS на каждое событие',
    tz: 'ТЗ §11',
  },
];

@Injectable()
export class ParametersService implements OnModuleInit {
  private readonly params = new Map<number, SystemParam>(
    [...(seed.params as SystemParam[]), ...OPERATIONAL].map((p) => [p.num, { ...p }]),
  );

  /**
   * Значения держатся в памяти и при работе на базе.
   *
   * Это не срез ради скорости, а единственная разумная форма: `text()` зовут
   * из глубины расчётов — наценка за срочность, лимит наличных, пороги
   * таймеров, — и запрос в базу на каждое обращение превратил бы расчёт
   * заявки в десяток round-trip'ов ради строки, которая меняется раз в месяц.
   * Поэтому загрузка на старте и запись насквозь при изменении.
   *
   * Метаданные (имя, уровни, ссылка на ТЗ) не хранятся нигде, кроме
   * seed-файла: они принадлежат документу PRD-04, а не эксплуатации.
   * В базе и в файле лежат только значения.
   */
  constructor(
    private readonly store: StateStore,
    private readonly prisma: PrismaService,
  ) {
    if (!this.prisma.enabled) {
      this.store.register(
        'parameters',
        () => [...this.params.values()],
        (d) => {
          for (const p of (d ?? []) as SystemParam[]) {
            const cur = this.params.get(p.num);
            if (cur) cur.value = p.value; // из файла берём только значения, метаданные — из PRD
          }
        },
      );
    }
  }

  /**
   * Разовый перенос значений из state.json (deploy/import-state).
   *
   * Из файла берутся только значения: метаданные параметра — номер, название,
   * уровни — живут в PRD и в коде, и брать их из снимка значило бы законсервировать
   * позавчерашнюю редакцию справочника.
   */
  async importFromState(raw: unknown): Promise<number> {
    let n = 0;
    for (const p of (raw ?? []) as Array<{ num: number; value: string }>) {
      const cur = this.params.get(p.num);
      if (!cur || cur.value === p.value) continue;
      await this.update(p.num, p.value);
      n += 1;
    }
    return n;
  }

  async onModuleInit(): Promise<void> {
    if (!this.prisma.enabled) return;
    const rows = await this.prisma.withContext(async (tx) => tx.systemParameter.findMany());
    for (const r of rows) {
      const cur = this.params.get(Number(r.code));
      if (cur && typeof r.value === 'string') cur.value = r.value;
    }
    // eslint-disable-next-line no-console
    console.log(`[Parameters] значений из базы: ${rows.length}`);
  }

  list(): SystemParam[] {
    return [...this.params.values()].sort((a, b) => a.num - b.num);
  }

  /** Значение параметра как строка. Пустое — берём запасное: экран не должен пустовать */
  text(num: number, fallback: string): string {
    return this.params.get(num)?.value?.trim() || fallback;
  }

  async update(num: number, value: string): Promise<SystemParam> {
    const p = this.params.get(num);
    if (!p) throw new NotFoundException({ code: 'PARAM_NOT_FOUND', param: num });
    p.value = value;
    if (this.prisma.enabled) {
      const ctx = currentDbContext() ?? systemContext();
      await this.prisma.withContext(async (tx) => {
        await tx.systemParameter.upsert({
          where: { tenantId_code: { tenantId: ctx.tenantId, code: String(num) } },
          create: {
            id: uuidv7(),
            tenantId: ctx.tenantId,
            code: String(num),
            value,
            level: p.levels[0] ?? 'global',
          },
          update: { value },
        });
      });
    } else {
      this.store.persist();
    }
    return p;
  }
}
