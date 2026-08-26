import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import type { SubscriptionPlan, TenantKind } from '@sozo/contracts';
import type { BillingUnit } from '@sozo/kernel';
import { AuthGuard, Roles } from '../identity/auth.guard';
import { OperatorScopeGuard } from '../operator-api/operator-scope.guard';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Тариф и финансы оператора.
 *
 * Тот же контроллер `operator`, что и кабинет, но собственный: `orgId` здесь
 * не сверялся ни с чем, и ручки подписки и финансов были открыты любому
 * валидному токену — включая начисление, которое пишет строку в
 * append-only реестр. Ставим тот же скоуп, что и на кабинете, плюс роли:
 * тариф меняет платформа, а не оператор сам себе.
 */
@Controller('operator')
@UseGuards(AuthGuard, OperatorScopeGuard)
export class SubscriptionsController {
  constructor(private readonly subs: SubscriptionsService) {}

  @Get(':orgId/subscription')
  get(@Param('orgId') orgId: string) {
    return this.subs.get('t0', orgId) ?? { plan: 'free', note: 'подписка не заведена — действует Free' };
  }

  @Post(':orgId/subscription')
  @Roles('admin', 'accountant')
  setPlan(
    @Param('orgId') orgId: string,
    @Body() body: { plan: SubscriptionPlan; tenantKind: TenantKind; priceTiyin?: number; unitsBilled?: number; billingUnit?: BillingUnit },
  ) {
    return this.subs.setPlan('t0', orgId, body);
  }

  // Начисление пишет строку в append-only реестр — это платформа, не оператор
  @Post(':orgId/subscription/charge')
  @Roles('admin', 'accountant')
  charge(@Param('orgId') orgId: string) {
    return { chargedTiyin: this.subs.charge('t0', orgId) };
  }

  @Post(':orgId/subscription/past-due')
  @Roles('admin', 'accountant')
  pastDue(@Param('orgId') orgId: string) {
    return this.subs.markPastDue('t0', orgId);
  }

  /** U-11: нетто-расчёт месяца */
  @Get(':orgId/finance')
  finance(@Param('orgId') orgId: string) {
    return this.subs.settlement('t0', orgId);
  }
}
