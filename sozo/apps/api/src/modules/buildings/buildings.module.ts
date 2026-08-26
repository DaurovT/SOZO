import { Module } from '@nestjs/common';
import { BuildingsController } from './buildings.controller';
import { BuildingScopeGuard } from './building-scope.guard';
import { BuildingsService } from './buildings.service';
import { InMemoryBuildingRepository } from './building.repository';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { CrmModule } from '../crm/crm.module';

/**
 * Модуль buildings (DEV-07 §2.1): объекты, помещения, зоны, персонал оператора,
 * адресный матчинг, жизненный цикл подключения. Контур «Дом», M7-E0.
 * Никого доменного не импортирует — его импортируют access и operator-api.
 */
@Module({
  imports: [SubscriptionsModule, CrmModule],
  controllers: [BuildingsController],
  providers: [BuildingsService, InMemoryBuildingRepository, BuildingScopeGuard],
  exports: [BuildingsService],
})
export class BuildingsModule {}
