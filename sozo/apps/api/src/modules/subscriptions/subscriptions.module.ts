import { Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

/**
 * Модуль subscriptions (DEV-07 §2.1): тарифы операторов, деградация, нетто-расчёт.
 * Ничего доменного не импортирует; billing подписан на его события (DEV-07 §3 п.8).
 */
@Module({
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
