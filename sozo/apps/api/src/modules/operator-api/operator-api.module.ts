import { Module } from '@nestjs/common';
import { OperatorApiController } from './operator-api.controller';
import { BuildingsModule } from '../buildings/buildings.module';
import { AccessModule } from '../access/access.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { OrdersModule } from '../orders/orders.module';

/**
 * Модуль operator-api (DEV-07 §2.1): эндпоинты кабинета оператора — по аналогии
 * с существующими client-api и master-api. Только агрегация, без бизнес-логики.
 */
@Module({
  imports: [BuildingsModule, AccessModule, SubscriptionsModule, OrdersModule],
  controllers: [OperatorApiController],
})
export class OperatorApiModule {}
