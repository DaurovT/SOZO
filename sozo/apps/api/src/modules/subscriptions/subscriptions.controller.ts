import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { SubscriptionPlan, TenantKind } from '@sozo/contracts';
import type { BillingUnit } from '@sozo/kernel';
import { AuthGuard } from '../identity/auth.guard';
import { SubscriptionsService } from './subscriptions.service';

@Controller('operator')
@UseGuards(AuthGuard)
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get(':orgId/subscription')
  get(@Param('orgId') orgId: string) {
    return this.subs.get('t0', orgId) ?? { plan: 'free', note: 'подписка не заведена — действует Free' };
  }

  @Post(':orgId/subscription')
  setPlan(
    @Param('orgId') orgId: string,
    @Body() body: { plan: SubscriptionPlan; tenantKind: TenantKind; priceTiyin?: number; unitsBilled?: number; billingUnit?: BillingUnit },
  ) {
    return this.subs.setPlan('t0', orgId, body);
  }

  @Post(':orgId/subscription/charge')
  charge(@Param('orgId') orgId: string) {
    return { chargedTiyin: this.subs.charge('t0', orgId) };
  }

  @Post(':orgId/subscription/past-due')
  pastDue(@Param('orgId') orgId: string) {
    return this.subs.markPastDue('t0', orgId);
  }

  /** U-11: нетто-расчёт месяца */
  @Get(':orgId/finance')
  finance(@Param('orgId') orgId: string) {
    return this.subs.settlement('t0', orgId);
  }
}
