import { BadRequestException, Body, Controller, Get, Injectable, Module, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { MastersModule, MastersService } from '../masters/masters.module';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PricingModule } from '../pricing/pricing.module';
import { PricingService } from '../pricing/pricing.service';
import { CrmModule } from '../crm/crm.module';
import { CrmService } from '../crm/crm.service';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { SchedulingService } from '../scheduling/scheduling.service';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';
import { localDateKey } from '../../common/tz';

/**
 * Авто-распределение (ТЗ 7.3, PRD-05 §3).
 * Фильтры: skill → зона → загрузка → оборудование/транспорт → чёрный список точки.
 * Ранжирование: закреплённый мастер → грейд/рейтинг → близость (свободнее лента).
 * Ручное назначение диспетчером приоритетнее автоматики.
 */
export interface Candidate {
  masterId: string;
  masterName: string;
  rating: number;
  grade: string;
  score: number;
  reasons: string[]; // почему подходит
  blockers: string[]; // почему НЕ подходит (если есть — кандидат отсеян)
  loadPercent: number;
  hasShift: boolean;
}

@Injectable()
export class AssignmentService {
  constructor(
    private readonly masters: MastersService,
    private readonly orders: OrdersService,
    private readonly pricing: PricingService,
    private readonly crm: CrmService,
    private readonly sched: SchedulingService,
  ) {}

  /**
   * Нормо-часы заявки по позициям прайса.
   *
   * Нужны брони: без длительности слот не посчитать. Позиция без нормы —
   * час по умолчанию: занять час и ошибиться лучше, чем не занять ничего.
   */
  async normHoursFor(orderId: string): Promise<number> {
    const order = await this.orders.get('t0', orderId);
    const release = this.pricing.get(order.priceListReleaseId);
    let sum = 0;
    for (const line of order.lines) {
      const item = release.items.find((i) => i.id === line.priceItemId);
      sum += (item?.normHours ?? 1) * (line.qty || 1);
    }
    return sum > 0 ? sum : 1;
  }

  async candidates(orderId: string, date: string): Promise<{ order: { number: string; requiredSkills: string[]; requiresEquipment: boolean; isPaired: boolean }; candidates: Candidate[]; rejected: Candidate[] }> {
    const order = await this.orders.get('t0', orderId);
    const release = this.pricing.get(order.priceListReleaseId);

    // Требования заявки из позиций прайса
    const requiredSkills = new Set<string>();
    let requiresEquipment = false;
    let isPaired = false;
    for (const line of order.lines) {
      const item = release.items.find((i) => i.id === line.priceItemId);
      if (!item) continue;
      item.requiredSkills.forEach((s) => requiredSkills.add(s));
      if (item.requiresEquipment) requiresEquipment = true;
      if (item.isPaired) isPaired = true;
    }

    // Чёрный список и закреплённый мастер точки (ТЗ 3.2)
    let blacklist: string[] = [];
    let preferredMasterId: string | null = null;
    if (order.locationId) {
      for (const o of this.crm.list()) {
        const full = this.crm.get(o.id);
        const loc = full.locations.find((l) => l.id === order.locationId);
        if (loc) {
          blacklist = loc.blacklistMasterIds;
          preferredMasterId = loc.preferredMasterId;
          break;
        }
      }
    }

    const zoneOfOrder = order.address.match(/Чиланзар|Юнусабад|Мирабад|Яккасарай|Сергели|Мирзо-Улугбек/i)?.[0] ?? null;

    const all = this.masters.list().map<Candidate>((m) => {
      const lane = this.sched.lane(m.id, date);
      const reasons: string[] = [];
      const blockers: string[] = [];
      let score = 0;

      if (m.status !== 'active') blockers.push(`статус «${m.status}» — не на линии`);
      if (blacklist.includes(m.id)) blockers.push('в чёрном списке точки (ТЗ 3.2)');

      // skill-теги — жёсткий фильтр
      const missing = [...requiredSkills].filter((s) => !m.skillTags.includes(s));
      if (missing.length) blockers.push(`нет skill-тега: ${missing.join(', ')}`);
      else if (requiredSkills.size) reasons.push(`есть skill: ${[...requiredSkills].join(', ')}`);

      // оборудование/транспорт
      if (requiresEquipment && !m.hasVehicle) blockers.push('позиция требует оборудование, у мастера нет транспорта (ТЗ 17.3)');
      else if (requiresEquipment) reasons.push('транспорт для оборудования есть');

      // наличный долг сверх лимита снимает с линии (ТЗ 8.5)
      if (m.cashDebtTiyin >= 200_000_000) blockers.push('наличный долг ≥ лимита 2 000 000 сум — снят с линии');

      // смена и загрузка
      if (!lane.shift) blockers.push('нет смены на эту дату');
      else if (lane.capReached) blockers.push(`лента заполнена (${lane.loadPercent}% ≥ 80% плана дня)`);
      else {
        score += (100 - lane.loadPercent) * 0.4; // свободнее лента — выше приоритет
        reasons.push(`загрузка ленты ${lane.loadPercent}%`);
      }

      // закреплённый мастер точки — мягкий приоритет
      if (preferredMasterId === m.id) {
        score += 40;
        reasons.push('закреплён за точкой');
      }
      // Клиент попросил запомнить этого мастера (C-21). Вес ниже, чем у
      // закрепления за точкой: там это условие договора, здесь — пожелание
      if (order.preferredMasterId === m.id) {
        score += 30;
        reasons.push('клиент просил этого мастера');
      }
      // зона
      if (zoneOfOrder && m.zones.some((z) => z.toLowerCase() === zoneOfOrder.toLowerCase())) {
        score += 25;
        reasons.push(`работает в зоне «${zoneOfOrder}»`);
      } else if (zoneOfOrder && m.zones.length) {
        reasons.push(`другая зона (${m.zones.join(', ')})`);
      }
      // грейд и рейтинг
      score += m.rating * 0.3;
      if (m.grade === 'gold') score += 15;
      else if (m.grade === 'silver') score += 7;
      reasons.push(`рейтинг ${m.rating}, грейд ${m.grade}`);
      // испытательный (стартовый рейтинг, мало заявок) — понижаем, но не блокируем
      if (m.rating <= 60) {
        score -= 10;
        reasons.push('испытательный период — 100% модерации фото (ТЗ 7.4)');
      }

      return {
        masterId: m.id,
        masterName: m.fullName,
        rating: m.rating,
        grade: m.grade,
        score: Math.round(score),
        reasons,
        blockers,
        loadPercent: lane.loadPercent,
        hasShift: !!lane.shift,
      };
    });

    return {
      order: { number: order.number, requiredSkills: [...requiredSkills], requiresEquipment, isPaired },
      candidates: all.filter((c) => c.blockers.length === 0).sort((a, b) => b.score - a.score),
      rejected: all.filter((c) => c.blockers.length > 0),
    };
  }
}

@Controller('dispatch/assignment')
@UseGuards(AuthGuard)
@Roles('dispatcher', 'admin')
class AssignmentController {
  constructor(
    private readonly svc: AssignmentService,
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
    private readonly sched: SchedulingService,
  ) {}

  /** Подбор кандидатов с обоснованием (ручное назначение приоритетнее автоматики, ТЗ 7.3) */
  @Get('candidates')
  candidates(@Query('orderId') orderId: string, @Query('date') date?: string) {
    if (!orderId) throw new BadRequestException({ code: 'ORDER_REQUIRED' });
    return this.svc.candidates(orderId, date ?? localDateKey());
  }

  /**
   * Авто-назначение: берёт лучшего кандидата, выполняет переход assign и
   * ЗАНИМАЕТ его ёмкость.
   *
   * Брони не создавалось никогда: единственным вызывающим `book()` во всём
   * коде был контроллер ручного бронирования. При этом отсев кандидатов
   * построен именно на загрузке ленты — значит десять авто-назначений
   * подряд выбирали одного и того же мастера и ставили его на десять заявок
   * на одно время. Инварианты «не более 80% плана дня» и «нет пересечений»
   * не срабатывали вовсе.
   */
  @Post('auto-assign')
  async autoAssign(@Body() b: { orderId: string; date?: string }, @Req() req: { auth: JwtClaims }) {
    const date = b.date ?? localDateKey();
    const res = await this.svc.candidates(b.orderId, date);
    const best = res.candidates[0];
    if (!best) {
      throw new BadRequestException({
        code: 'NO_CANDIDATES',
        message: 'Подходящих мастеров нет — см. причины отсева',
        rejected: res.rejected.map((r) => ({ master: r.masterName, blockers: r.blockers })),
      });
    }
    const order = await this.orders.get('t0', b.orderId);
    await this.orders.transition(
      't0',
      b.orderId,
      { action: 'assign', version: order.version },
      req.auth.phone,
      { masterId: best.masterId, masterName: best.masterName, roles: req.auth.roles },
    );

    /**
     * Ёмкость занимается сразу после назначения.
     *
     * Не получилось — назначение остаётся, но об этом говорим вслух: заявка
     * без брони видна диспетчеру как «мастер назначен, окно не занято», и
     * это лучше, чем откатывать назначение или молчать. Молча — это ровно
     * то, что было.
     */
    let booking: unknown = null;
    let bookingError: string | null = null;
    try {
      const normHours = await this.svc.normHoursFor(b.orderId);
      const startMin = this.sched.firstFreeSlot(best.masterId, date, normHours);
      if (startMin === null) {
        bookingError = 'Свободного слота у мастера на эту дату нет — поставьте бронь вручную';
      } else {
        booking = this.sched.book({
          masterId: best.masterId,
          date,
          startMin,
          orderId: order.id,
          orderNumber: order.number,
          normHours,
        });
      }
    } catch (e) {
      bookingError = e instanceof Error ? e.message : String(e);
    }
    this.audit.write({
      actorPhone: req.auth.phone,
      action: 'order.auto_assigned',
      entity: 'Order',
      entityId: b.orderId,
      payload: { master: best.masterName, score: best.score, reasons: best.reasons, booked: !!booking, bookingError },
    });
    return { assigned: best, booking, bookingError, alternatives: res.candidates.slice(1, 4) };
  }
}

@Module({
  imports: [MastersModule, OrdersModule, PricingModule, CrmModule, SchedulingModule],
  controllers: [AssignmentController],
  providers: [AssignmentService],
  exports: [AssignmentService],
})
export class AssignmentModule {}
