import { BadRequestException, Body, Controller, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { TransitionRequestSchema } from '@sozo/contracts';
import { AuthGuard } from '../identity/auth.guard';
import { OrdersService, type CreateOrderDto } from './orders.service';
import type { JwtClaims } from '../../common/jwt';

/**
 * Клиентский контур заявок (DEV-03 tag orders). Тенант 't0' — до мультитенантности из JWT.
 * Диспетчерские операции — в DispatchController.
 */
@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Post()
  async create(@Body() body: CreateOrderDto, @Req() req: { auth: JwtClaims }) {
    return this.orders.create('t0', { ...body, source: body.source ?? 'app' }, req.auth.phone);
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    return this.orders.get('t0', id);
  }

  @Post(':id/transitions')
  async transition(@Param('id') id: string, @Body() body: unknown, @Req() req: { auth: JwtClaims }) {
    const parsed = TransitionRequestSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    await this.orders.transition('t0', id, parsed.data, req.auth.phone);
    return this.orders.get('t0', id);
  }
}
