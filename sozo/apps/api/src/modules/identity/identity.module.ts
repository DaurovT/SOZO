import { Global, Module } from '@nestjs/common';
import { IdentityController, UsersController } from './identity.controller';
import { IdentityService } from './identity.service';
import { AuthGuard } from './auth.guard';

/**
 * identity (DEV-07 §2 п.15): OTP, JWT, контексты ролей.
 * DEV-ЗАГЛУШКА (решение владельца от 30.07.2026): SMS не отправляется,
 * любой телефон подтверждается кодом «00000». Заменить на SMS-провайдер в M1 (M0-E2-S2).
 */
@Global()
@Module({
  controllers: [IdentityController, UsersController],
  providers: [IdentityService, AuthGuard],
  exports: [IdentityService, AuthGuard],
})
export class IdentityModule {}
