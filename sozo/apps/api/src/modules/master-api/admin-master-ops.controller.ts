import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { MastersService } from '../masters/masters.module';
import { OrdersService } from '../orders/orders.service';
import { ResourcesService } from './resources.service';
import { MasterOpsService } from './master-ops.service';

/**
 * Что происходит в приложении мастера — глазами админки.
 *
 * Всё это давно работает, но видно было только самому мастеру: коды закупки,
 * техника клиентов, отложенные рекомендации. В админке на их месте стояли
 * макеты с подписью «фаза 2», хотя ждать было нечего.
 */
@Controller('admin/master-ops')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
export class AdminMasterOpsController {
  constructor(
    private readonly resources: ResourcesService,
    private readonly ops: MasterOpsService,
    private readonly masters: MastersService,
    private readonly orders: OrdersService,
  ) {}

  /**
   * Коды закупки: лимит, срок и приложена ли накладная.
   *
   * Код — это разрешение потратить деньги компании в партнёрском магазине.
   * Активный код без накладной дольше суток — либо забытая покупка, либо
   * деньги, потраченные не туда; и то и другое надо видеть.
   */
  @Get('purchase-codes')
  async purchaseCodes() {
    const all = await this.orders.list('t0');
    const byId = new Map(all.map((o) => [o.id, o]));
    const masters = new Map(this.masters.list().map((m) => [m.id, m.fullName]));

    const rows = this.resources.purchaseCodes
      .map((c) => {
        const order = byId.get(c.orderId);
        const ageHours = Math.floor((Date.now() - new Date(c.createdAt).getTime()) / 3_600_000);
        return {
          id: c.id,
          code: c.code,
          orderId: c.orderId,
          orderNumber: order?.number ?? '—',
          masterName: masters.get(c.masterId) ?? '—',
          limitTiyin: c.limitTiyin,
          status: c.status,
          hasInvoice: !!c.invoice,
          invoiceTotalTiyin: c.invoice?.totalTiyin ?? 0,
          createdAt: c.createdAt,
          expiresAt: c.expiresAt,
          ageHours,
          // Разрешение действует, деньги потрачены, накладной нет — вопрос
          // не к мастеру лично, а к тому, что покупка нигде не подтверждена
          unconfirmed: c.status === 'active' && !c.invoice && ageHours >= 24,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return {
      codes: rows,
      active: rows.filter((r) => r.status === 'active').length,
      unconfirmed: rows.filter((r) => r.unconfirmed).length,
      limitTotalTiyin: rows.filter((r) => r.status === 'active').reduce((s, r) => s + r.limitTiyin, 0),
    };
  }

  /**
   * QR-бейджи мастеров.
   *
   * Код есть у каждого с момента заведения карточки, приложение его
   * показывает, клиент сверяет им личность мастера на пороге. В админке
   * не хватало только списка для печати.
   */
  @Get('badges')
  badges() {
    return {
      badges: this.masters
        .list()
        .filter((m) => m.status === 'active' || m.status === 'training')
        .map((m) => ({
          masterId: m.id,
          fullName: m.fullName,
          phone: m.phone,
          status: m.status,
          grade: m.grade,
          qrBadgeCode: m.qrBadgeCode,
          skillTags: m.skillTags,
        })),
      note: 'Код на бейдже клиент сверяет на пороге. Печать и выдача — вне системы',
    };
  }
}
