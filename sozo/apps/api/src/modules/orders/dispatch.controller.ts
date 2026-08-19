import { Body, Controller, Get, Param, Post, Req, UseGuards, BadRequestException } from '@nestjs/common';
import { ORDER_STATUSES, TransitionRequestSchema, type OrderStatus } from '@sozo/contracts';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { OrdersService, type CreateOrderDto } from './orders.service';
import { PricingService } from '../pricing/pricing.service';
import { MastersService } from '../masters/masters.module';
import { CrmService } from '../crm/crm.service';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';

/** Колонки kanban D-02: статусы 4.1 без терминальных (Закрыта/Отменена — архив) */
const KANBAN_STATUSES: OrderStatus[] = ORDER_STATUSES.filter(
  (s) => !['closed', 'rated', 'cancelled'].includes(s),
) as OrderStatus[];

@Controller('dispatch')
@UseGuards(AuthGuard)
@Roles('dispatcher', 'admin')
export class DispatchController {
  constructor(
    private readonly orders: OrdersService,
    private readonly pricing: PricingService,
    private readonly masters: MastersService,
    private readonly crm: CrmService,
    private readonly audit: AuditService,
  ) {}

  /** D-02: kanban — переходы только действиями карточки, drag запрещён (PRD-03) */
  @Get('kanban')
  async kanban(@Req() req: { auth: JwtClaims }) {
    const all = await this.orders.list('t0');
    return {
      columns: KANBAN_STATUSES.map((status) => ({
        status,
        orders: all.filter((o) => o.status === status),
      })),
      archive: all.filter((o) => ['closed', 'rated', 'cancelled'].includes(o.status)).slice(0, 50),
    };
  }

  /** D-08: создание заявки по телефону — форма за 30 секунд */
  @Post('orders')
  async create(@Body() body: CreateOrderDto, @Req() req: { auth: JwtClaims }) {
    const order = await this.orders.create('t0', { ...body, source: body.source ?? 'phone' }, req.auth.phone);
    this.audit.write({ actorPhone: req.auth.phone, action: 'order.created', entity: 'Order', entityId: order.id, payload: { number: order.number } });
    return order;
  }

  @Get('orders/:id')
  async get(@Param('id') id: string) {
    return this.orders.get('t0', id);
  }

  /** Единственная точка смены статуса; 409 при нарушении графа DEV-10 */
  @Post('orders/:id/transitions')
  async transition(@Param('id') id: string, @Body() body: unknown, @Req() req: { auth: JwtClaims }) {
    const parsed = TransitionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const masterId = (body as { masterId?: string }).masterId;
    const master = masterId ? this.masters.list().find((m) => m.id === masterId) : undefined;
    const order = await this.orders.transition('t0', id, parsed.data, req.auth.phone, {
      masterId,
      masterName: master?.fullName,
    });
    this.audit.write({
      actorPhone: req.auth.phone,
      action: `order.${parsed.data.action}`,
      entity: 'Order',
      entityId: id,
      payload: { to: order.status },
    });
    return this.orders.get('t0', id);
  }

  /** D-06 вкладка «Материалы» (ТЗ 8.4): запчасть — с чеком, вилка при цене >200 000 */
  @Post('orders/:id/materials')
  async addMaterial(@Param('id') id: string, @Body() body: any, @Req() req: { auth: JwtClaims }) {
    const order = await this.orders.addMaterial('t0', id, body);
    this.audit.write({ actorPhone: req.auth.phone, action: 'order.material_added', entity: 'Order', entityId: id, payload: { name: body.name, amountTiyin: body.amountTiyin } });
    return order;
  }

  /** D-06: предпросмотр денежных последствий отмены (матрица ТЗ 4.4) */
  @Get('orders/:id/cancel-preview')
  async cancelPreview(@Param('id') id: string) {
    return this.orders.cancelPreview('t0', id);
  }

  /** D-15: переназначение мастера — статусы 5–8, причина обязательна */
  @Post('orders/:id/reassign')
  async reassign(@Param('id') id: string, @Body() body: { masterId?: string; reason?: string }, @Req() req: { auth: JwtClaims }) {
    const master = this.masters.list().find((m) => m.id === body.masterId);
    if (!master) throw new BadRequestException({ code: 'MASTER_REQUIRED', message: 'Выберите мастера' });
    const order = await this.orders.reassign('t0', id, master.id, master.fullName, body.reason ?? '', req.auth.phone);
    this.audit.write({ actorPhone: req.auth.phone, action: 'order.reassigned', entity: 'Order', entityId: id, payload: { to: master.fullName, reason: body.reason } });
    return this.orders.get('t0', id);
  }

  /**
   * D-03: карта города — заявки и мастера в реальном времени (PRD-03).
   * Гео мастера доступно только при активной заявке (ТЗ 17.5: слежки нет).
   * Берём последнюю отметку из приложения мастера; если её нет или она
   * старше получаса — показываем адрес текущей заявки, чтобы точка не врала.
   */
  @Get('map')
  async map() {
    const all = await this.orders.list('t0');
    const active = all.filter((o) => !['closed', 'rated', 'cancelled'].includes(o.status));
    const masters = this.masters.list();

    const masterPins = masters
      .map((m) => {
        const current = active.find((o) => o.masterId === m.id && ['master_departed', 'in_progress', 'addwork_approval'].includes(o.status));
        const assigned = active.filter((o) => o.masterId === m.id);
        if (!current) {
          // Без активного визита позиции нет — показываем как «вне карты» (ТЗ 17.5)
          return { masterId: m.id, masterName: m.fullName, status: m.status, lat: null, lng: null, orderNumber: null, ordersActive: assigned.length, stale: true };
        }
        const lastMove = new Date(current.statusLog.at(-1)?.at ?? current.createdAt).getTime();
        // Отметка из приложения свежее получаса — точка настоящая, иначе адрес заявки
        const pingAge = m.lastGeo ? Date.now() - new Date(m.lastGeo.at).getTime() : Infinity;
        const live = pingAge < 30 * 60_000 ? m.lastGeo! : null;
        return {
          masterId: m.id,
          masterName: m.fullName,
          status: m.status,
          lat: live?.lat ?? current.lat,
          lng: live?.lng ?? current.lng,
          geoSource: live ? 'app' : 'order_address',
          geoAt: live?.at ?? null,
          orderNumber: current.number,
          orderStatus: current.status,
          ordersActive: assigned.length,
          // «гео не приближается 15+ мин» — мягкий флаг, триггер протокола замены (ТЗ 17.3)
          stale: Date.now() - lastMove > 15 * 60_000,
          minutesSinceMove: Math.floor((Date.now() - lastMove) / 60_000),
        };
      })
      .filter((p) => p.status === 'active');

    return {
      orders: active
        .filter((o) => o.lat != null && o.lng != null)
        .map((o) => ({
          id: o.id,
          number: o.number,
          graphType: o.graphType,
          status: o.status,
          urgency: o.urgency,
          address: o.address,
          clientPhone: o.clientPhone,
          masterName: o.masterName ?? null,
          totalFromTiyin: o.totalFromTiyin,
          lat: o.lat,
          lng: o.lng,
          ageMinutes: Math.floor((Date.now() - new Date(o.createdAt).getTime()) / 60_000),
        })),
      masters: masterPins,
      locations: this.crm.list().flatMap((o) => {
        const full = this.crm.get(o.id);
        return full.locations
          .filter((l) => l.lat != null && l.lng != null)
          .map((l) => ({ id: l.id, name: l.name, organization: full.name, address: l.address, lat: l.lat, lng: l.lng }));
      }),
    };
  }

  /** Справочники для формы D-08 */
  @Get('price-items')
  priceItems() {
    const r = this.pricing.active();
    return { releaseId: r.id, items: r.items };
  }

  @Get('masters')
  mastersList() {
    return this.masters.list().filter((m) => m.status === 'active');
  }

  @Get('organizations')
  organizations() {
    return this.crm.list();
  }
}
