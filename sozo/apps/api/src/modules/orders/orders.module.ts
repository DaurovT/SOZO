import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { DispatchController } from './dispatch.controller';
import { ClientsController } from './clients.controller';
import { PhotosController } from './photos.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { InMemoryOrderRepository, ORDER_REPOSITORY } from './order.repository';
import { PricingModule } from '../pricing/pricing.module';
import { MastersModule } from '../masters/masters.module';
import { CrmModule } from '../crm/crm.module';
import { PromoModule } from '../promo/promo.module';
import { AccessModule } from '../access/access.module';
import { BuildingsModule } from '../buildings/buildings.module';
import { SlaModule } from '../sla/sla.module';

/**
 * Модуль orders (DEV-07 §2 п.1): заявка, статусные машины всех типов, журнал переходов.
 * Единственная точка смены статуса (DEV-10). In-memory репозиторий — до Prisma.
 */
@Module({
  imports: [PricingModule, MastersModule, CrmModule, PromoModule, AccessModule, BuildingsModule, SlaModule],
  controllers: [OrdersController, DispatchController, ClientsController, PhotosController, AdminOrdersController],
  providers: [OrdersService, { provide: ORDER_REPOSITORY, useClass: InMemoryOrderRepository }],
  exports: [OrdersService],
})
export class OrdersModule {}
