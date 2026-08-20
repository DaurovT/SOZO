import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { ObservationOrdersService } from './observation-orders.service';
import { DispatchController } from './dispatch.controller';
import { ClientsController } from './clients.controller';
import { PhotosController } from './photos.controller';
import { AdminOrdersController } from './admin-orders.controller';
import { InMemoryOrderRepository, ORDER_REPOSITORY, type OrderRepository } from './order.repository';
import { PrismaOrderRepository } from './prisma-order.repository';
import { PrismaService } from '../../common/prisma.service';
import { StateStore } from '../../common/state-store';
import { PricingModule } from '../pricing/pricing.module';
import { MastersModule } from '../masters/masters.module';
import { CrmModule } from '../crm/crm.module';
import { PromoModule } from '../promo/promo.module';
import { AccessModule } from '../access/access.module';
import { BuildingsModule } from '../buildings/buildings.module';
import { SlaModule } from '../sla/sla.module';

/**
 * Модуль orders (DEV-07 §2 п.1): заявка, статусные машины всех типов, журнал переходов.
 * Единственная точка смены статуса (DEV-10). Хранилище выбирается один раз на
 * процесс: PostgreSQL, если задан DATABASE_URL, иначе файл.
 */
@Module({
  imports: [PricingModule, MastersModule, CrmModule, PromoModule, AccessModule, BuildingsModule, SlaModule],
  controllers: [OrdersController, DispatchController, ClientsController, PhotosController, AdminOrdersController],
  providers: [
    OrdersService,
    ObservationOrdersService,
    /**
     * Заявка ПОКА на файловом хранилище, хотя PrismaOrderRepository готов.
     *
     * Причина проверена отказом, а не предсказана: у заявки внешние ключи на
     * объект и мастера, а эти модули ещё пишут в файл — строк в базе нет, и
     * создание заявки с buildingId падает на order_building_id_fkey.
     *
     * Значит порядок обязателен: сначала buildings и masters, потом orders.
     * Включить — заменить строку ниже на выбор по prisma.enabled, как сделано
     * в остальных модулях.
     */
    { provide: ORDER_REPOSITORY, useClass: InMemoryOrderRepository },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
