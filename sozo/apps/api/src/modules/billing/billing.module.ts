import { Module } from '@nestjs/common';
import { BillingController } from './billing.controller';
import { BillingService } from './billing.service';
import { CrmModule } from '../crm/crm.module';

/**
 * billing (DEV-07 §2 п.4): двойная запись, СФ, ведомости, дебиторка, баланс-чекер.
 * Не импортирует доменные модули — подписан на события шины (order.closed).
 * CrmModule здесь — только для чтения реквизитов при выставлении СФ (read-only).
 */
@Module({
  imports: [CrmModule],
  controllers: [BillingController],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
