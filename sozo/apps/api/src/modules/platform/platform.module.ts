import { Global, Module } from '@nestjs/common';
import { MastersModule } from '../masters/masters.module';
import { MonitoringController } from './monitoring.controller';
import { PlatformController } from './platform.controller';
import { ParametersService } from './parameters.service';
import { AUDIT_REPOSITORY, AuditService } from './audit.service';
import { InMemoryAuditRepository, PrismaAuditRepository, type AuditRepository } from './audit.repository';
import { PrismaService } from '../../common/prisma.service';
import { StateStore as StateStoreForAudit } from '../../common/state-store';
import { EventBus } from '../../common/event-bus';
import { StateStore } from '../../common/state-store';

/** platform (DEV-07 §2 п.16): параметры системы, аудит-лог, шина событий */
@Global()
@Module({
  imports: [MastersModule],
  controllers: [PlatformController, MonitoringController],
  providers: [
    ParametersService,
    AuditService,
    EventBus,
    StateStore,
    /**
     * Хранилище аудита выбирается один раз на процесс: есть DATABASE_URL —
     * PostgreSQL, нет — файл. Помодульный выбор был бы тем самым состоянием
     * «половина в базе, половина в памяти», которого README велит избегать.
     */
    {
      provide: AUDIT_REPOSITORY,
      inject: [PrismaService, StateStoreForAudit],
      useFactory: (prisma: PrismaService, store: StateStoreForAudit): AuditRepository =>
        prisma.enabled ? new PrismaAuditRepository(prisma) : new InMemoryAuditRepository(store),
    },
  ],
  exports: [ParametersService, AuditService, EventBus, StateStore],
})
export class PlatformModule {}
