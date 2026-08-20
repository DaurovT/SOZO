import { BadRequestException, Body, Controller, Get, Param, Post, Query, Req, UseGuards } from '@nestjs/common';
import { permitTransitionSchema } from '@sozo/contracts';
import { AuthGuard } from '../identity/auth.guard';
import { AccessService, type CreatePermitDto } from './access.service';
import type { JwtClaims } from '../../common/jwt';

/**
 * Наряды-допуски и пропуска (DEV-03 tag access). Единственная точка смены статуса —
 * AccessService; контроллер только валидирует вход и подставляет актора.
 */
@Controller()
@UseGuards(AuthGuard)
export class AccessController {
  constructor(private readonly access: AccessService) {}

  @Post('orders/:orderId/permits')
  create(@Param('orderId') orderId: string, @Body() body: Omit<CreatePermitDto, 'orderId'>, @Req() req: { auth: JwtClaims }) {
    return this.access.create('t0', { ...body, orderId }, req.auth.phone);
  }

  @Get('permits/:id')
  get(@Param('id') id: string) {
    return this.access.get('t0', id);
  }

  /** Ссылки согласования по наряду — кабинет показывает, кому и когда ушла SMS */
  @Get('permits/:id/links')
  links(@Param('id') id: string) {
    return this.access.permitLinks(id);
  }

  @Post('permits/:id/transitions')
  transition(@Param('id') id: string, @Body() body: unknown, @Req() req: { auth: JwtClaims }) {
    const parsed = permitTransitionSchema.safeParse(body);
    if (!parsed.success) throw new BadRequestException(parsed.error.flatten());
    const roles = req.auth.roles ?? [];
    return this.access.transition('t0', id, parsed.data, {
      phone: req.auth.phone,
      // роль «согласующий доступ» намеренно узкая (DEV-15 §10.1); head/admin оператора её включают
      isApprover: roles.some((r) => ['approver', 'head', 'admin'].includes(r)),
      scopedToBuilding: true,
      isDispatcher: roles.includes('dispatcher'),
    });
  }

  /** Очередь согласования: U-02 для оператора, D-21 для диспетчера */
  @Get('operator/permits')
  queue(@Query('buildingIds') buildingIds = '', @Query('overdue') overdue = 'false') {
    const ids = buildingIds.split(',').map((s) => s.trim()).filter(Boolean);
    return this.access.queue('t0', ids, overdue === 'true');
  }

  /**
   * Прогон авто-согласия молчанием. В проде запускается воркером таймеров (55–57);
   * здесь — ручной триггер. Параметр now — только для dev-прогонов и тестов:
   * позволяет проверить поведение на истёкшем SLA, не дожидаясь реального срока.
   */
  @Post('operator/permits/auto-approve')
  autoApprove(@Query('now') now?: string) {
    return this.access.autoApproveExpired('t0', now ? new Date(now) : new Date());
  }

  @Post('passes')
  issuePass(
    @Body()
    body: {
      buildingId: string;
      orderId: string;
      masterId: string;
      passType?: 'master' | 'helper' | 'guest' | 'resident_contractor' | 'operator_contractor';
      validFrom: string;
      validTo: string;
    },
  ) {
    return this.access.issuePass('t0', {
      buildingId: body.buildingId,
      orderId: body.orderId,
      masterId: body.masterId,
      passType: body.passType ?? 'master',
      validFrom: body.validFrom,
      validTo: body.validTo,
    });
  }

  // ---------- Отключения ресурсов (DEV-15 §5) ----------

  @Post('buildings/:buildingId/shutdowns')
  createShutdown(
    @Param('buildingId') buildingId: string,
    @Body()
    body: {
      resourceType: 'cold_water' | 'hot_water' | 'heating' | 'electricity' | 'gas' | 'sewage' | 'lift' | 'ventilation';
      riserId?: string;
      plannedFrom: string;
      plannedTo: string;
      reason: string;
      initiator?: 'operator' | 'platform' | 'utility';
      orderId?: string;
      isEmergency?: boolean;
    },
  ) {
    return this.access.createShutdown('t0', { buildingId, ...body });
  }

  /** U-10: журнал доступа объекта */
  @Get('buildings/:buildingId/access-journal')
  journal(@Param('buildingId') buildingId: string) {
    return this.access.accessJournal('t0', buildingId);
  }

  @Get('buildings/:buildingId/shutdowns')
  listShutdowns(@Param('buildingId') buildingId: string) {
    return this.access.listShutdowns('t0', buildingId);
  }

  @Post('shutdowns/:id/start')
  startShutdown(@Param('id') id: string) {
    return this.access.startShutdown('t0', id);
  }

  @Post('shutdowns/:id/restore')
  restoreShutdown(@Param('id') id: string) {
    return this.access.restoreShutdown('t0', id);
  }
}
