import { Global, Module } from '@nestjs/common';
import { IdentityController, UsersController } from './identity.controller';
import { IDENTITY_REPOSITORY, IdentityService } from './identity.service';
import { InMemoryIdentityRepository, PrismaIdentityRepository, type IdentityRepository } from './identity.repository';
import { PrismaService } from '../../common/prisma.service';
import { StateStore } from '../../common/state-store';
import { AuthGuard } from './auth.guard';

/**
 * identity (DEV-07 §2 п.15): OTP, JWT, контексты ролей.
 * DEV-ЗАГЛУШКА (решение владельца от 30.07.2026): SMS не отправляется,
 * любой телефон подтверждается кодом «00000». Заменить на SMS-провайдер в M1 (M0-E2-S2).
 */
@Global()
@Module({
  controllers: [IdentityController, UsersController],
  providers: [
    IdentityService,
    AuthGuard,
    {
      provide: IDENTITY_REPOSITORY,
      inject: [PrismaService, StateStore],
      useFactory: (prisma: PrismaService, store: StateStore): IdentityRepository =>
        prisma.enabled ? new PrismaIdentityRepository(prisma) : new InMemoryIdentityRepository(store),
    },
  ],
  exports: [IdentityService, AuthGuard],
})
export class IdentityModule {}
