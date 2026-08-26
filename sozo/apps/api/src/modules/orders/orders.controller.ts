import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TransitionRequestSchema } from '@sozo/contracts';
import { AuthGuard } from '../identity/auth.guard';
import { OrdersService, type CreateOrderDto } from './orders.service';
import type { JwtClaims } from '../../common/jwt';

/**
 * Клиентский контур заявок (DEV-03 tag orders). Тенант 't0' — до мультитенантности из JWT.
 * Диспетчерские операции — в DispatchController.
 *
 * Здесь нет `@Roles`, и это не забывчивость: роль клиента получает любой,
 * кто вошёл с узбекского номера, — проверять её бессмысленно. Значение имеет
 * не роль, а принадлежность: своя заявка или чужая. Раньше не проверялось ни
 * то, ни другое, и `GET /v1/orders/<uuid>` отдавал чужую заявку целиком —
 * телефон, адрес, суммы, журнал статусов, — а `POST …/transitions` позволял
 * её закрыть и отменить.
 */
@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  async create(@Body() body: CreateOrderDto, @Req() req: { auth: JwtClaims }) {
    /**
     * Заявку заводят на себя.
     *
     * Диспетчер и админ — исключение: телефонный канал в том и состоит, что
     * заявку оформляют за другого человека.
     */
    const backOffice = req.auth.roles.some((r) => r === 'dispatcher' || r === 'admin');
    const clientPhone = backOffice ? body.clientPhone : req.auth.phone;
    return this.orders.create('t0', { ...body, clientPhone, source: body.source ?? 'app' }, req.auth.phone);
  }

  @Get(':id')
  async get(@Param('id') id: string, @Req() req: { auth: JwtClaims }) {
    const order = await this.orders.record('t0', id);
    this.orders.assertMayView(order, { phone: req.auth.phone, roles: req.auth.roles });
    return this.orders.get('t0', id);
  }

  /**
   * Переходы своей заявки.
   *
   * Клиенту доступно ровно то, что он решает сам: отменить, оспорить,
   * поставить оценку. Всё остальное — конвейер, и его ведёт бэк-офис через
   * `/dispatch`. Раньше через этот маршрут проходили любые действия любого
   * графа: в частности, `pending_approval → approved` в B2B, у которого
   * guard'ов нет вовсе, — то есть здесь любой утверждал смету любого
   * размера мимо порогов и второго фактора, аккуратно сделанных в
   * client-b2b.controller.
   */
  @Post(':id/transitions')
  async transition(@Param('id') id: string, @Body() body: unknown, @Req() req: { auth: JwtClaims }) {
    const parsed = TransitionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const order = await this.orders.record('t0', id);
    this.orders.assertMayView(order, { phone: req.auth.phone, roles: req.auth.roles });
    const backOffice = req.auth.roles.some((r) => r === 'dispatcher' || r === 'admin');
    const CLIENT_ACTIONS = ['cancel', 'open_dispute', 'rate', 'confirm_estimate', 'resolve_addwork'];
    if (!backOffice && !CLIENT_ACTIONS.includes(parsed.data.action)) {
      throw new BadRequestException({
        code: 'ACTION_NOT_FOR_CLIENT',
        message: `Действие «${parsed.data.action}» ведёт диспетчер; клиенту доступны: ${CLIENT_ACTIONS.join(', ')}`,
      });
    }
    await this.orders.transition('t0', id, parsed.data, req.auth.phone, { roles: req.auth.roles });
    return this.orders.get('t0', id);
  }
}
