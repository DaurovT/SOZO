import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { OrdersService } from './orders.service';

/**
 * Реестр заявок для админки — read-only срез операционки (PRD-04 A-01).
 * Владелец платформы и бухгалтер видят полную картину: суммы, мастера, каналы,
 * фотофиксацию, сметы. Управление конвейером — только в диспетчерской (PRD-03),
 * граница ролей сохраняется: здесь нет переходов статусов и назначений.
 */
@Controller('admin/orders')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  async list() {
    const all = await this.orders.list('t0');
    return all.map((o) => ({
      id: o.id,
      number: o.number,
      graphType: o.graphType,
      status: o.status,
      urgency: o.urgency,
      source: o.source,
      clientPhone: o.clientPhone,
      clientName: o.clientName,
      address: o.address,
      description: o.description,
      masterName: o.masterName ?? null,
      organizationId: o.organizationId ?? null,
      baseFromTiyin: o.baseFromTiyin,
      totalFromTiyin: o.totalFromTiyin,
      totalMaterialTiyin: o.totalMaterialTiyin,
      promoCode: o.promoCode ?? null,
      promoDiscountPercent: o.promoDiscountPercent ?? null,
      photosCount: o.photos.length,
      photosWithFile: o.photos.filter((p) => p.file).length,
      quotesCount: o.quotes.length,
      materialsCount: o.materials.length,
      createdAt: o.createdAt,
      closedAt: o.statusLog.find((l) => l.to === 'closed')?.at ?? null,
    }));
  }

  /** Карточка заявки для админки: полный состав + журнал (без действий) */
  @Get(':id')
  async get(@Param('id') id: string) {
    const o = await this.orders.get('t0', id);
    return {
      ...o,
      allowedActions: undefined, // управление конвейером — в диспетчерской
      readOnlyNote: 'Просмотр из админки. Управление конвейером и назначения — в диспетчерской (PRD-03).',
    };
  }
}
