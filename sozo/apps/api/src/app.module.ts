import { Controller, Get, Global, Module } from '@nestjs/common';
import { PrismaService } from './common/prisma.service';
import { OrdersModule } from './modules/orders/orders.module';
import { IdentityModule } from './modules/identity/identity.module';
import { PlatformModule } from './modules/platform/platform.module';
import { PricingModule } from './modules/pricing/pricing.module';
import { CrmModule } from './modules/crm/crm.module';
import { MastersModule } from './modules/masters/masters.module';
import { BillingModule } from './modules/billing/billing.module';
import { RegistryModule } from './modules/registry/registry.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { ReserveModule } from './modules/reserve/reserve.module';
import { LeadsModule } from './modules/leads/leads.module';
import { StockModule } from './modules/stock/stock.module';
import { PromoModule } from './modules/promo/promo.module';
import { LoyaltyModule } from './modules/loyalty/loyalty.module';
import { SchedulerModule } from './modules/scheduler/scheduler.module';
import { DocumentsModule } from './modules/documents/documents.module';
import { WebCardModule } from './modules/web-card/web-card.module';
import { SchedulingModule } from './modules/scheduling/scheduling.module';
import { AssignmentModule } from './modules/assignment/assignment.module';
import { DispatchOpsModule } from './modules/dispatch-ops/dispatch-ops.module';
import { PublicApiModule } from './modules/public-api/public-api.module';
import { QualityModule } from './modules/quality/quality.module';
import { AnalyticsModule } from './modules/analytics/analytics.module';
import { MasterApiModule } from './modules/master-api/master-api.module';
import { BuildingsModule } from './modules/buildings/buildings.module';
import { AccessModule } from './modules/access/access.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SlaModule } from './modules/sla/sla.module';
import { OperatorApiModule } from './modules/operator-api/operator-api.module';
import { FieldModule } from './modules/field/field.module';
import { ClientApiModule } from './modules/client-api/client-api.module';
import { ClientB2CModule } from './modules/client-b2c/client-b2c.module';
import { NotificationsModule } from './modules/notifications/notifications.module';

/**
 * Доступ к базе — глобальный модуль: подключение одно на процесс, и таскать
 * его импортом через тридцать модулей значит тридцать раз написать одно и то же.
 */
@Global()
@Module({ providers: [PrismaService], exports: [PrismaService] })
export class PrismaModule {}

@Controller('health')
class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async health() {
    // Состояние базы в /health — не украшение: при переезде на PostgreSQL
    // «сервер поднялся» и «сервер видит данные» перестают быть одним и тем же
    return {
      status: 'ok',
      service: 'sozo-api',
      ts: new Date().toISOString(),
      db: await this.prisma.ping(),
    };
  }
}

/**
 * Модули монолита — DEV-07 §2 (16 штук). Подключаются по мере майлстоунов:
 * orders (M1) → scheduling, assignment (M4) → billing (M2) → pricing, crm, masters,
 * field, inventory, loyalty, engagement, notifications, documents, integrations,
 * identity, platform (M0+).
 * Правила зависимостей DEV-07 §3: ни один модуль не зависит от billing;
 * billing подписан на события через outbox (kernel).
 */
@Module({
  imports: [
    PrismaModule,
    NotificationsModule,
    BuildingsModule,
    AccessModule,
    SubscriptionsModule,
    SlaModule,
    OperatorApiModule,IdentityModule, PlatformModule, PricingModule, CrmModule, MastersModule, OrdersModule, BillingModule, RegistryModule, DashboardModule, ReserveModule, LeadsModule, StockModule, PromoModule, LoyaltyModule, SchedulerModule, DocumentsModule, SchedulingModule, AssignmentModule, DispatchOpsModule, PublicApiModule, QualityModule, AnalyticsModule, MasterApiModule, FieldModule, ClientApiModule, ClientB2CModule, WebCardModule],
  controllers: [HealthController],
})
export class AppModule {}
