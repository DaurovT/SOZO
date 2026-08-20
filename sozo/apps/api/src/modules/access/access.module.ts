import { Module } from '@nestjs/common';
import { AccessController } from './access.controller';
import { UnitAccessPageController } from './unit-access-page.controller';
import { PublicBuildingController } from './public-building.controller';
import { AccessService } from './access.service';
import { InMemoryPermitRepository } from './permit.repository';
import { PermitLinksService } from './permit-links.service';
import { PermitPageController } from './permit-page.controller';
import { BuildingsModule } from '../buildings/buildings.module';

/**
 * Модуль access (DEV-07 §2.1, правило 6): наряды-допуски, пропуска, отключения.
 * Единственная точка смены статуса наряда; граф — kernel/PermitStateMachine по DEV-10 §7.
 * Зависит только от buildings; billing подписан на его события и его не импортирует.
 */
@Module({
  imports: [BuildingsModule],
  controllers: [AccessController, PermitPageController, PublicBuildingController, UnitAccessPageController],
  providers: [AccessService, InMemoryPermitRepository, PermitLinksService],
  exports: [AccessService],
})
export class AccessModule {}
