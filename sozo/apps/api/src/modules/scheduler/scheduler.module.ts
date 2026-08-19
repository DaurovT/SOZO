import { Body, Controller, Get, Module, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { SchedulerService } from './scheduler.service';
import { AuditService } from '../platform/audit.service';
import { BillingModule } from '../billing/billing.module';
import { CrmModule } from '../crm/crm.module';
import { OrdersModule } from '../orders/orders.module';
import type { JwtClaims } from '../../common/jwt';

/** Экран «Планировщик» (A-34): состояние движка, история срабатываний, ручной прогон */
@Controller('admin/scheduler')
@UseGuards(AuthGuard)
@Roles('admin', 'accountant')
class SchedulerController {
  constructor(
    private readonly scheduler: SchedulerService,
    private readonly audit: AuditService,
  ) {}

  @Get()
  state() {
    return { ...this.scheduler.state(), runs: this.scheduler.history(50) };
  }

  /** Ручной прогон всех таймеров сейчас */
  @Post('run')
  @Roles('admin')
  async run(@Req() req: { auth: JwtClaims }) {
    const runs = await this.scheduler.tick(true);
    this.audit.write({ actorPhone: req.auth.phone, action: 'scheduler.manual_run', entity: 'Scheduler', payload: { count: runs.length } });
    return runs;
  }

  /** Dev: прогон N дней вперёд (проверка месячного цикла, дунинга, эскалаций) */
  @Post('simulate')
  @Roles('admin')
  async simulate(@Body() body: { days?: number }, @Req() req: { auth: JwtClaims }) {
    const days = Math.max(1, Math.min(Number(body?.days) || 1, 60));
    const runs = await this.scheduler.simulateDays(days);
    this.audit.write({ actorPhone: req.auth.phone, action: 'scheduler.simulate', entity: 'Scheduler', payload: { days } });
    return { days, runs: runs.slice(-40) };
  }

  @Post('reset-clock')
  @Roles('admin')
  reset(@Req() req: { auth: JwtClaims }) {
    this.scheduler.resetClock();
    this.audit.write({ actorPhone: req.auth.phone, action: 'scheduler.reset_clock', entity: 'Scheduler' });
    return this.scheduler.state();
  }
}

@Module({
  imports: [BillingModule, CrmModule, OrdersModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
