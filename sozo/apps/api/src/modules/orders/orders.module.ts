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
     * Заявка ПОКА на файловом хранилище, хотя PrismaOrderRepository готов и
     * блокер по внешним ключам снят: объекты и мастера уже в базе.
     *
     * При включении 75 проверок из 489 падают, и все — в контуре «Дом»:
     * развилка жителя, расчёт труда, окно первой руки. Простые сценарии
     * проходят: заявка с объектом и заявка с помещением создаются, читаются
     * и находятся. Значит дело в узком месте, а не в самом переносе, и это
     * отдельная отладка, а не строчка в модуле.
     *
     * Включить — заменить строку ниже на выбор по prisma.enabled.
     */
    { provide: ORDER_REPOSITORY, useClass: InMemoryOrderRepository },
  ],
  exports: [OrdersService],
})
export class OrdersModule {}
