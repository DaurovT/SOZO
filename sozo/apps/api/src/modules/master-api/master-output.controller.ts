import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { BuildingsService } from '../buildings/buildings.service';
import { SchedulingService } from '../scheduling/scheduling.service';
import { OrdersService } from '../orders/orders.service';
import { SlaService } from '../sla/sla.service';
import { MasterGuard, type MasterRequest } from './master.guard';

/**
 * M-46 «Моя выработка» (DEV-09, DEV-15 §7.1).
 *
 * Экран сотрудника эксплуатирующей организации: он на окладе, и показывать ему
 * доли и заработок — не просто лишнее, а вредно. Поэтому здесь **ни одной
 * денежной суммы**, и это не стилистика, а требование спецификации: кошелёк
 * M-34 в сменах оператора заменяется этим экраном целиком.
 *
 * Что считаем — только по тому, что в системе действительно есть: плановые
 * часы смен, закрытые заявки, светофор SLA по ним, обходы и замечания.
 * Придумывать показатели, под которые нет данных, значит показать человеку
 * ноль и заставить его не верить экрану.
 *
 * ОГРАНИЧЕНИЕ. Спецификация говорит: переключение M-34/M-46 идёт «по владельцу
 * текущей смены». Владельца у смены в модели пока нет — `ShiftRec` не знает,
 * чья она. Поэтому признак считается по аффилиации: числится ли человек в штате
 * хоть одного объекта. Для мастера, работающего только на оператора или только
 * на платформу, результат тот же; разойдётся он лишь у совмещающего в один
 * день, и тогда понадобится поле владельца в смене.
 */
@Controller('master')
@UseGuards(MasterGuard)
export class MasterOutputController {
  constructor(
    private readonly buildings: BuildingsService,
    private readonly scheduling: SchedulingService,
    private readonly orders: OrdersService,
    private readonly sla: SlaService,
  ) {}

  @Get('output')
  async output(
    @Query('from') from: string | undefined,
    @Query('to') to: string | undefined,
    @Req() req: MasterRequest,
  ) {
    const m = req.master!;
    const today = new Date();
    // По умолчанию — текущий месяц: период выработки человек сверяет с
    // расчётным листом, а он месячный
    const periodTo = to ?? today.toISOString().slice(0, 10);
    const periodFrom = from ?? `${periodTo.slice(0, 7)}-01`;
    const inPeriod = (day: string) => day >= periodFrom && day <= periodTo;

    // Объекты, где человек в штате оператора: тот же признак, что у обхода
    const myBuildings = this.buildings
      .listBuildings('t0')
      .filter((b) => this.buildings.listStaff('t0', b.id).some((s) => s.userPhone === m.phone));

    if (myBuildings.length === 0) {
      // Честный ответ вместо нулей: приложение по нему покажет кошелёк M-34,
      // а не пустую выработку
      return { isOperatorStaff: false, period: { from: periodFrom, to: periodTo }, buildings: [] };
    }

    // Часы смен — плановые: фактического учёта прихода в системе нет, и выдавать
    // плановые за фактические нельзя, поэтому поле так и называется
    let shiftMinutes = 0;
    let shiftDays = 0;
    for (const d of this.days(periodFrom, periodTo)) {
      for (const s of this.scheduling.listShifts(d)) {
        if (s.masterId !== m.id) continue;
        shiftMinutes += Math.max(0, s.endMin - s.startMin);
        shiftDays += 1;
      }
    }

    const all = await this.orders.list('t0');
    const closed = all.filter(
      (o) =>
        (o.masterId === m.id || o.helperId === m.id) &&
        ['closed', 'rated'].includes(o.status) &&
        inPeriod(String(o.statusLog.find((l) => l.to === 'closed')?.at ?? '').slice(0, 10)),
    );

    // Светофор SLA по закрытым заявкам периода. `none` — заявки вне политики,
    // их нельзя записывать ни в зелёные, ни в красные
    // `done` — заявка устранена, светофор погашен: у закрытых заявок это
    // обычное состояние, и складывать его с зелёными нельзя — зелёное значит
    // «успеваем», а не «успели»
    const sla = { green: 0, amber: 0, red: 0, done: 0, none: 0 };
    for (const o of closed) sla[this.sla.status('t0', o.id)] += 1;

    let walksDone = 0;
    let walksDue = 0;
    let observationsCreated = 0;
    let observationsResolved = 0;
    for (const b of myBuildings) {
      for (const w of this.buildings.listWalks('t0', b.id)) {
        if (w.walkerPhone !== m.phone) continue;
        if (inPeriod(String(w.finishedAt ?? '').slice(0, 10))) walksDone += 1;
      }
      walksDue += this.buildings.walkthroughsDue('t0', b.id).length;
      for (const ob of this.buildings.listObservations('t0', b.id)) {
        if (ob.authorPhone !== m.phone) continue;
        if (inPeriod(String(ob.createdAt ?? '').slice(0, 10))) observationsCreated += 1;
        if (ob.status === 'resolved' && inPeriod(String(ob.resolvedAt ?? '').slice(0, 10))) observationsResolved += 1;
      }
    }

    return {
      isOperatorStaff: true,
      period: { from: periodFrom, to: periodTo },
      buildings: myBuildings.map((b) => ({ id: b.id, name: b.name, address: b.address })),
      shift: { plannedMinutes: shiftMinutes, days: shiftDays },
      orders: { closed: closed.length },
      sla,
      walkthroughs: { done: walksDone, due: walksDue },
      observations: { created: observationsCreated, resolved: observationsResolved },
      // Метка давности: экран кешируется и работает офлайн (DEV-15 §10.8.1),
      // и человек должен видеть, на какой момент цифры
      generatedAt: new Date().toISOString(),
    };
  }

  /** Дни периода включительно; период ограничен годом — защита от случайного `from=1970` */
  private days(from: string, to: string): string[] {
    const out: string[] = [];
    const start = new Date(`${from}T00:00:00Z`);
    const end = new Date(`${to}T00:00:00Z`);
    for (let d = start; d <= end && out.length < 366; d = new Date(d.getTime() + 86_400_000)) {
      out.push(d.toISOString().slice(0, 10));
    }
    return out;
  }
}
