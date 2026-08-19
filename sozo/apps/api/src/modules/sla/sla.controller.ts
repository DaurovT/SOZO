import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../identity/auth.guard';
import { SlaService, type SlaPolicyRecord } from './sla.service';

@Controller('operator/sla')
@UseGuards(AuthGuard)
export class SlaController {
  constructor(private readonly sla: SlaService) {}

  @Get('policies')
  list(@Query('operatorOrgId') operatorOrgId = '') {
    return this.sla.listPolicies('t0', operatorOrgId);
  }

  @Post('policies')
  create(@Body() body: Omit<SlaPolicyRecord, 'id' | 'tenantId'>) {
    return this.sla.upsertPolicy('t0', body);
  }

  /** Прогон детекта нарушений — в проде запускается воркером; now только для dev */
  @Post('check')
  check(@Query('now') now?: string) {
    const res = this.sla.check('t0', now ? new Date(now) : new Date());
    return { breached: res.map((r) => ({ orderId: r.orderId, flags: r.breached })) };
  }

  @Get('orders/:orderId')
  state(@Param('orderId') orderId: string, @Query('now') now?: string) {
    return {
      state: this.sla.get('t0', orderId),
      status: this.sla.status('t0', orderId, now ? new Date(now) : new Date()),
    };
  }
}
