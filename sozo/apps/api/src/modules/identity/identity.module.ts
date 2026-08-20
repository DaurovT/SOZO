import { Global, Module } from '@nestjs/common';
import { IdentityController, UsersController } from './identity.controller';
import { IDENTITY_REPOSITORY, IdentityService } from './identity.service';
import { InMemoryIdentityRepository, PrismaIdentityRepository, type IdentityRepository } from './identity.repository';
import { PrismaService } from '../../common/prisma.service';
import { StateStore } from '../../common/state-store';
import { AuthGuard } from './auth.guard';
import { SmsService } from '../../common/sms.service';
import { OtpStore } from './otp.store';

/**
 * identity (DEV-07 §2 п.15): OTP, JWT, контексты ролей.
 *
 * Код подтверждения настоящий: пятизначный, живёт три минуты, сгорает после
 * пяти неверных попыток. Куда он уходит, решает SMS_PROVIDER — журнал или
 * Eskiz. На журнальном отправителе код по-прежнему «00000»: отправки нет,
 * и предсказуемость там ничего не ослабляет.
 */
@Global()
@Module({
  controllers: [IdentityController, UsersController],
  providers: [
    IdentityService,
    AuthGuard,
    SmsService,
    OtpStore,
    {
      provide: IDENTITY_REPOSITORY,
      inject: [PrismaService, StateStore],
      useFactory: (prisma: PrismaService, store: StateStore): IdentityRepository =>
        prisma.enabled ? new PrismaIdentityRepository(prisma) : new InMemoryIdentityRepository(store),
    },
  ],
  exports: [IdentityService, AuthGuard, SmsService],
})
export class IdentityModule {}
