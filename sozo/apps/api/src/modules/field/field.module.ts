import { Controller, Get, Module, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { CrmModule } from '../crm/crm.module';
import { FieldService, type ActStatus } from './field.service';

/**
 * Акты осмотра для внутреннего контура: диспетчер и админ видят, что ушло на
 * подпись и где точка молчит. Решение по акту принимает только ответственный
 * на точке — отсюда его подменить нельзя, здесь лишь наблюдение и эскалация.
 */
@Controller('admin/acts')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant', 'dispatcher')
class AdminActsController {
  constructor(private readonly field: FieldService) {}

  @Get()
  list(@Query('status') status?: ActStatus, @Query('locationId') locationId?: string) {
    this.field.expireOverdue();
    return this.field.list({ status, locationId });
  }

  /** Что зависло: отправлено, но решения нет — повод позвонить на точку */
  @Get('pending')
  pending() {
    this.field.expireOverdue();
    const sent = this.field.list({ status: 'sent' });
    const expired = this.field.list({ status: 'expired' });
    return {
      waiting: sent.length,
      overdue: expired.length,
      items: [...expired, ...sent].map((a) => ({
        id: a.id,
        number: a.number,
        locationName: a.locationName,
        masterName: a.masterName,
        items: a.items.length,
        status: a.status,
        sentAt: a.sentAt,
        expiresAt: a.expiresAt,
        representative: a.representative,
      })),
    };
  }

  /**
   * Технический долг: дефекты, которые нашли и не устранили.
   *
   * Копится из двух источников — отклонённые позиции актов и позиции, по
   * которым решения так и не приняли. Клиент видит его по своей точке, а
   * платформа не видела вовсе: это и накопленный риск аварии, и очевидная
   * воронка продаж, о которой никто не знал.
   *
   * Объявлен до `:id`, иначе Nest примет «debt» за идентификатор акта.
   */
  @Get('debt')
  debt() {
    this.field.expireOverdue();
    const acts = this.field.list();
    const byLocation = new Map<
      string,
      { locationId: string; locationName: string; organizationId: string; items: Array<Record<string, unknown>>; totalTiyin: number; oldestDays: number }
    >();

    for (const act of acts) {
      for (const item of act.items) {
        // В долг попадает отклонённое и то, по чему не ответили. Принятое
        // уже стало заявкой и долгом быть перестало
        const stale = item.decision === 'declined' || (item.decision === 'pending' && act.status === 'expired');
        if (!stale) continue;
        const days = Math.floor((Date.now() - new Date(act.createdAt).getTime()) / 86_400_000);
        const row = byLocation.get(act.locationId) ?? {
          locationId: act.locationId,
          locationName: act.locationName,
          organizationId: act.organizationId,
          items: [],
          totalTiyin: 0,
          oldestDays: 0,
        };
        row.items.push({
          id: item.id,
          actNumber: act.number,
          category: item.category,
          description: item.description,
          severity: item.severity,
          estimateTiyin: item.estimateTiyin,
          declineReason: item.declineReason ?? null,
          reason: item.decision === 'declined' ? 'отклонено заказчиком' : 'решение не принято в срок',
          days,
        });
        row.totalTiyin += item.estimateTiyin ?? 0;
        row.oldestDays = Math.max(row.oldestDays, days);
        byLocation.set(act.locationId, row);
      }
    }

    const rows = [...byLocation.values()].sort((a, b) => b.totalTiyin - a.totalTiyin);
    return {
      locations: rows,
      totalTiyin: rows.reduce((s, r) => s + r.totalTiyin, 0),
      itemsTotal: rows.reduce((s, r) => s + r.items.length, 0),
      // Старше 60 дней — то, что уже нельзя списать на «клиент подумает»
      staleLocations: rows.filter((r) => r.oldestDays >= 60).length,
    };
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.field.get(id);
  }

  /** Ручной прогон просрочки — тот же расчёт, что делает лента при открытии */
  @Post('expire-overdue')
  expire() {
    const expired = this.field.expireOverdue();
    return { expired: expired.length, numbers: expired.map((a) => a.number) };
  }
}

@Module({
  imports: [CrmModule],
  providers: [FieldService],
  controllers: [AdminActsController],
  exports: [FieldService],
})
export class FieldModule {}
