import { Global, Module } from '@nestjs/common';
import { MastersModule } from '../masters/masters.module';
import { MonitoringController } from './monitoring.controller';
import { PlatformController } from './platform.controller';
import { ParametersService } from './parameters.service';
import { AuditService } from './audit.service';
import { EventBus } from '../../common/event-bus';
import { StateStore } from '../../common/state-store';

/** platform (DEV-07 §2 п.16): параметры системы, аудит-лог, шина событий */
@Global()
@Module({
  imports: [MastersModule],
  controllers: [PlatformController, MonitoringController],
  providers: [ParametersService, AuditService, EventBus, StateStore],
  exports: [ParametersService, AuditService, EventBus, StateStore],
})
export class PlatformModule {}
