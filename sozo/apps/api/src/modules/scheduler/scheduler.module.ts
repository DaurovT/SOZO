import { Body, Controller, Get, Module, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { SchedulerService } from './scheduler.service';
import { AuditService } from '../platform/audit.service';
import { BillingModule } from '../billing/billing.module';
import { CrmModule } from '../crm/crm.module';
import { OrdersModule } from '../orders/orders.module';
import { PlatformModule } from '../platform/platform.module';
import type { JwtClaims } from '../../common/jwt';
import { SlaModule } from '../sla/sla.module';

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

  /**
   * Прогон N дней вперёд — сухой: считает, что случилось бы, и ничего не
   * делает. Ни счетов, ни авто-отмен, ни приостановок, ни уведомлений.
   */
  @Post('simulate')
  @Roles('admin')
  async simulate(@Body() body: { days?: number; apply?: boolean }, @Req() req: { auth: JwtClaims }) {
    const days = Math.max(1, Math.min(Number(body?.days) || 1, 60));
    const apply = body?.apply === true;
    const runs = await this.scheduler.simulateDays(days, { apply });
    this.audit.write({ actorPhone: req.auth.phone, action: apply ? 'scheduler.simulate_applied' : 'scheduler.simulate', entity: 'Scheduler', payload: { days, apply } });
    return {
      days,
      dryRun: !apply,
      note: apply
        ? 'Прогон С ПРИМЕНЕНИЕМ: счета выставлены, заявки отменены, уведомления отправлены'
        : 'Сухой прогон: счета не выставлены, заявки не отменены, уведомления не отправлены',
      runs: runs.slice(-40),
    };
  }

  @Post('reset-clock')
  @Roles('admin')
  reset(@Req() req: { auth: JwtClaims }) {
    this.scheduler.resetClock();
    this.audit.write({ actorPhone: req.auth.phone, action: 'scheduler.reset_clock', entity: 'Scheduler' });
    return this.scheduler.state();
  }

  /**
   * Снять отметки об отправленном.
   *
   * Раньше это делал сброс часов заодно — и следующий тик считал, что
   * напоминаний не было никогда: заново уходили все напоминания об оплате,
   * все этапы дунинга и заново выставлялись счета. Теперь отдельной кнопкой
   * и с предупреждением в ответе, чтобы её нажимали осознанно.
   */
  @Post('clear-delivery-marks')
  @Roles('admin')
  clearMarks(@Req() req: { auth: JwtClaims }) {
    const res = this.scheduler.clearDeliveryMarks();
    this.audit.write({ actorPhone: req.auth.phone, action: 'scheduler.clear_delivery_marks', entity: 'Scheduler', payload: res });
    return {
      ...res,
      warning: 'Следующий тик отправит напоминания заново по всем подходящим заявкам и счетам',
    };
  }
}

@Module({
  imports: [BillingModule, CrmModule, OrdersModule, PlatformModule, SlaModule],
  controllers: [SchedulerController],
  providers: [SchedulerService],
  exports: [SchedulerService],
})
export class SchedulerModule {}
