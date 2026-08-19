import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { AccessService } from './access.service';
import { InMemoryPermitRepository } from './permit.repository';
import { BuildingsModule } from '../buildings/buildings.module';

/**
 * Модуль access (DEV-07 §2.1, правило 6): наряды-допуски, пропуска, отключения.
 * Единственная точка смены статуса наряда; граф — kernel/PermitStateMachine по DEV-10 §7.
 * Зависит только от buildings; billing подписан на его события и его не импортирует.
 */
@Module({
  imports: [BuildingsModule],
  controllers: [AccessController],
  providers: [AccessService, InMemoryPermitRepository],
  exports: [AccessService],
})
export class AccessModule {}
