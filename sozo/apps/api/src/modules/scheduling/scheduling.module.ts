import { BadRequestException, Body, Controller, Delete, Get, Module, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { SchedulingService, QUEUE_PRIORITY } from './scheduling.service';
import { MastersModule, MastersService } from '../masters/masters.module';
import { OrdersModule } from '../orders/orders.module';
import { OrdersService } from '../orders/orders.service';
import { PricingModule } from '../pricing/pricing.module';
import { PricingService } from '../pricing/pricing.service';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';
import { localDateKey } from '../../common/tz';

// Местная дата: `toISOString()` даёт UTC, и с 00:00 до 05:00 по Ташкенту
// «сегодня» оказывалось вчерашним днём
const today = (): string => localDateKey();

/** D-05 ленты мастеров, D-04 ёмкость дня, D-18 лист ожидания (PRD-03) */
@Controller('dispatch/scheduling')
@UseGuards(AuthGuard)
@Roles('dispatcher', 'admin')
class SchedulingController {
  constructor(
    private readonly sched: SchedulingService,
    private readonly masters: MastersService,
    private readonly orders: OrdersService,
    private readonly pricing: PricingService,
    private readonly audit: AuditService,
  ) {}

  /** Нормо-часы заявки: сумма по позициям релиза; если не заполнены — 1 ч по умолчанию */
  private async normHoursFor(orderId: string): Promise<{ normHours: number; assumed: boolean; order: Awaited<ReturnType<OrdersService['get']>> }> {
    const order = await this.orders.get('t0', orderId);
    const release = this.pricing.get(order.priceListReleaseId);
    let sum = 0;
    let assumed = false;
    for (const line of order.lines) {
      const item = release.items.find((i) => i.id === line.priceItemId);
      if (item?.normHours) sum += item.normHours * line.qty;
      else assumed = true;
    }
    if (sum === 0) {
      sum = 1; // нормо-часы не заполнены владельцем (DEV-05 п.17) — планируем по 1 ч
      assumed = true;
    }
    return { normHours: sum, assumed, order };
  }

  @Get('lanes')
  lanes(@Query('date') date?: string) {
    return { date: date ?? today(), lanes: this.sched.lanes(date ?? today()) };
  }

  @Get('capacity')
  capacity(@Query('date') date?: string) {
    return this.sched.capacity(date ?? today());
  }

  @Get('shifts')
  shifts(@Query('date') date?: string) {
    return this.sched.listShifts(date ?? today());
  }

  @Post('shifts')
  createShift(@Body() b: { masterId: string; date?: string; startMin?: number; endMin?: number; isDuty?: boolean }, @Req() req: { auth: JwtClaims }) {
    const master = this.masters.list().find((m) => m.id === b.masterId);
    if (!master) throw new BadRequestException({ code: 'MASTER_NOT_FOUND' });
    const shift = this.sched.createShift({
      masterId: master.id,
      masterName: master.fullName,
      date: b.date ?? today(),
      startMin: b.startMin ?? 9 * 60,
      endMin: b.endMin ?? 18 * 60,
      isDuty: !!b.isDuty,
      zone: master.zones?.[0],
    });
    this.audit.write({ actorPhone: req.auth.phone, action: 'shift.created', entity: 'Shift', entityId: shift.id, payload: { master: master.fullName, date: shift.date } });
    return shift;
  }

  /** Быстрое заполнение графика дня активными мастерами (D-14) */
  @Post('shifts/seed-day')
  seedDay(@Body() b: { date?: string; dutyMasterId?: string }, @Req() req: { auth: JwtClaims }) {
    const active = this.masters.list().filter((m) => m.status === 'active');
    const created = this.sched.seedDay(b?.date ?? today(), active, b?.dutyMasterId);
    this.audit.write({ actorPhone: req.auth.phone, action: 'shift.seed_day', entity: 'Shift', payload: { date: b?.date ?? today(), created: created.length } });
    return { created: created.length, shifts: created };
  }

  @Delete('shifts/:id')
  removeShift(@Param('id') id: string) {
    this.sched.removeShift(id);
    return { deleted: true };
  }

  /** Доступные окна для заявки — то, что видит клиент (ТЗ 17.3) */
  @Get('windows')
  async windows(@Query('orderId') orderId: string, @Query('date') date?: string) {
    if (!orderId) throw new BadRequestException({ code: 'ORDER_REQUIRED' });
    const { normHours, assumed } = await this.normHoursFor(orderId);
    const d = date ?? today();
    const { slots } = this.sched.slotsFor(normHours);
    return {
      date: d,
      normHours,
      normHoursAssumed: assumed,
      slotsNeeded: slots,
      windows: this.sched.availableWindows(d, normHours),
    };
  }

  /** Бронирование заявки в ленту мастера */
  @Post('bookings')
  async book(
    @Body() b: { orderId: string; masterId: string; date?: string; startMin: number; anchored?: boolean; force?: boolean },
    @Req() req: { auth: JwtClaims },
  ) {
    const { normHours, order } = await this.normHoursFor(b.orderId);
    const priority =
      order.urgency === 'emergency'
        ? QUEUE_PRIORITY.emergency
        : order.graphType === 'warranty'
          ? QUEUE_PRIORITY.warranty
          : order.graphType === 'b2b'
            ? QUEUE_PRIORITY.b2b_contract_window
            : order.urgency === 'urgent'
              ? QUEUE_PRIORITY.urgent
              : QUEUE_PRIORITY.b2c_booking;
    const rec = this.sched.book({
      masterId: b.masterId,
      date: b.date ?? today(),
      startMin: b.startMin,
      orderId: order.id,
      orderNumber: order.number,
      normHours,
      anchored: b.anchored,
      priority,
      force: b.force,
    });
    this.sched.removeFromWaitlist(order.id);
    this.audit.write({ actorPhone: req.auth.phone, action: 'booking.created', entity: 'Order', entityId: order.id, payload: { masterId: b.masterId, startMin: b.startMin, forced: !!b.force } });
    return rec;
  }

  @Delete('bookings/:orderId')
  release(@Param('orderId') orderId: string, @Req() req: { auth: JwtClaims }) {
    const res = this.sched.release(orderId);
    if (res.freed) {
      this.audit.write({ actorPhone: req.auth.phone, action: 'booking.released', entity: 'Order', entityId: orderId, payload: { next: res.nextCandidate?.orderNumber ?? null } });
    }
    return res;
  }

  @Get('waitlist')
  waitlist() {
    return this.sched.listWaitlist();
  }

  @Post('waitlist')
  async addWaitlist(@Body() b: { orderId: string }) {
    const { normHours, order } = await this.normHoursFor(b.orderId);
    this.sched.addToWaitlist(order.id, order.number, normHours, order.urgency === 'urgent' ? QUEUE_PRIORITY.urgent : QUEUE_PRIORITY.waitlist);
    return this.sched.listWaitlist();
  }

  @Delete('waitlist/:orderId')
  removeWaitlist(@Param('orderId') orderId: string) {
    this.sched.removeFromWaitlist(orderId);
    return { removed: true };
  }
}

@Module({
  imports: [MastersModule, OrdersModule, PricingModule],
  controllers: [SchedulingController],
  providers: [SchedulingService],
  exports: [SchedulingService],
})
export class SchedulingModule {}
