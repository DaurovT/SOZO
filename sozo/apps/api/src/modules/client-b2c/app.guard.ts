import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyJwt, type JwtClaims } from '../../common/jwt';

export interface AppRequest {
  headers: Record<string, string>;
  auth?: JwtClaims;
  /** Телефон клиента — он же ключ ко всем его данным */
  clientPhone?: string;
}

/**
 * Аутентификация приложения «Клиент» (B2C).
 *
 * Роли не требуется: любой вошедший по OTP человек — клиент своих заявок.
 * Границу проводит телефон в токене, а не роль: заявку чужого номера
 * эндпоинты не отдают и не меняют.
 */
@Injectable()
export class AppGuard implements CanActivate {
  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<AppRequest>();
    const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const claims = token ? verifyJwt(token) : null;
    if (!claims) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    req.auth = claims;
    req.clientPhone = claims.phone;
    return true;
  }
}
