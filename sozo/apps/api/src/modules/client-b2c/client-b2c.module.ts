import { BuildingsModule } from '../buildings/buildings.module';
import { AccessModule } from '../access/access.module';
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { CrmModule } from '../crm/crm.module';
import { DispatchOpsModule } from '../dispatch-ops/dispatch-ops.module';
import { FieldModule } from '../field/field.module';
import { LoyaltyModule } from '../loyalty/loyalty.module';
import { MasterApiModule } from '../master-api/master-api.module';
import { MastersModule } from '../masters/masters.module';
import { OrdersModule } from '../orders/orders.module';
import { PricingModule } from '../pricing/pricing.module';
import { PromoModule } from '../promo/promo.module';
import { QualityModule } from '../quality/quality.module';
import { RegistryModule } from '../registry/registry.module';
import { SchedulingModule } from '../scheduling/scheduling.module';
import { AdminAppClientsController } from './admin-app-clients.controller';
import { AppGuard } from './app.guard';
import { ClientB2BController } from './client-b2b.controller';
import { ClientB2CController } from './client-b2c.controller';
import { ClientOrdersController } from './client-orders.controller';
import { ClientPhotoService } from './client-photo.service';
import { ClientProfilesService } from './client-profiles.service';
import { ClientNotificationsService } from './client-notifications.service';
import { ClientViewService } from './client-view.service';
import { DemoSeedService } from './demo-seed.service';

/**
 * Приложение «Клиент», B2C-контур (DEV-08, план DEV-12).
 *
 * Зависит от master-api ради решений, которые мастер присылает клиенту
 * (запчасть, доп-работа, рекомендация, план сессий): записи о них живут там,
 * и заводить им вторую копию значило бы иметь два источника правды.
 */
@Module({
  imports: [BuildingsModule, AccessModule, 
    OrdersModule,
    PricingModule,
    SchedulingModule,
    PromoModule,
    CrmModule,
    MastersModule,
    MasterApiModule,
    FieldModule,
    BillingModule,
    LoyaltyModule,
    QualityModule,
    DispatchOpsModule,
    RegistryModule,
  ],
  providers: [AppGuard, ClientProfilesService, ClientViewService, ClientPhotoService, DemoSeedService, ClientNotificationsService],
  controllers: [ClientB2CController, ClientOrdersController, ClientB2BController, AdminAppClientsController],
  exports: [ClientProfilesService],
})
export class ClientB2CModule {}
