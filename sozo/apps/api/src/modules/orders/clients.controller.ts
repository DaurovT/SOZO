import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { OrdersService } from './orders.service';
import { AuditService } from '../platform/audit.service';
import type { JwtClaims } from '../../common/jwt';

/**
 * A-10 (часть B2C): реестр клиентов-физлиц. Клиент возникает из заявок (телефон — ключ).
 * Долг = заявки в «Ожидает оплаты»; долг блокирует новые заявки, кроме аварийных (ТЗ 4.4).
 */
@Controller('admin/clients')
@UseGuards(AuthGuard)
export class ClientsController {
  constructor(
    private readonly orders: OrdersService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  @Roles('admin', 'accountant')
  async list() {
    return this.orders.clientsRegistry('t0');
  }


  @Get(':phone/orders')
  @Roles('admin', 'accountant')
  async clientOrders(@Param('phone') phone: string) {
    const all = await this.orders.list('t0');
    return all.filter((o) => o.clientPhone === phone);
  }

  /** История точки B2B (ТЗ 9.2): все заявки объекта — основа месячного отчёта с фото */
  @Get('locations/:locationId/history')
  @Roles('admin', 'accountant')
  async locationHistory(@Param('locationId') locationId: string) {
    const all = await this.orders.list('t0');
    const orders = all.filter((o) => o.locationId === locationId);
    return {
      orders,
      totals: {
        count: orders.length,
        closed: orders.filter((o) => ['closed', 'rated'].includes(o.status)).length,
        spentTiyin: orders
          .filter((o) => ['closed', 'rated'].includes(o.status))
          .reduce((s, o) => s + o.totalFromTiyin, 0),
      },
    };
  }

  /** Блокировка новых заявок (кроме аварийных — ТЗ 4.4); причина обязательна */
  @Post(':phone/block')
  @Roles('admin')
  block(@Param('phone') phone: string, @Body() body: { reason?: string }, @Req() req: { auth: JwtClaims }) {
    if (!body?.reason) throw new BadRequestException({ code: 'REASON_REQUIRED', message: 'Причина блокировки обязательна' });
    this.orders.blockClient(phone, body.reason);
    this.audit.write({ actorPhone: req.auth.phone, action: 'client.blocked', entity: 'Client', entityId: phone, payload: { reason: body.reason } });
    return { phone, blocked: true, reason: body.reason };
  }

  @Post(':phone/unblock')
  @Roles('admin')
  unblock(@Param('phone') phone: string, @Req() req: { auth: JwtClaims }) {
    this.orders.unblockClient(phone);
    this.audit.write({ actorPhone: req.auth.phone, action: 'client.unblocked', entity: 'Client', entityId: phone });
    return { phone, blocked: false };
  }
}
