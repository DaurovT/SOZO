import { Module } from '@nestjs/common';
import { SlaController } from './sla.controller';
import { SlaService } from './sla.service';

/**
 * Модуль sla (DEV-07 §2.1, правило 7): политики, дедлайны, детект нарушений.
 * Статусы не меняет — публикует `sla.breached`, реакция за orders и уведомлениями.
 */
@Module({
  controllers: [SlaController],
  providers: [SlaService],
  exports: [SlaService],
})
export class SlaModule {}
