import { Module } from '@nestjs/common';
import { CrmModule } from '../crm/crm.module';
import { FieldModule } from '../field/field.module';
import { OrdersModule } from '../orders/orders.module';
import { ClientApiController } from './client-api.controller';
import { ClientGuard } from './client.guard';

/**
 * Контур клиентского приложения B2B (PRD-02: приложение ответственного на точке).
 * Вход — по тому же OTP, что и везде; права даёт запись в карточке точки, а не роль.
 */
@Module({
  imports: [CrmModule, FieldModule, OrdersModule],
  providers: [ClientGuard],
  controllers: [ClientApiController],
})
export class ClientApiModule {}
