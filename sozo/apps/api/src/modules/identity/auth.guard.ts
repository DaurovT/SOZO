import { CanActivate, ExecutionContext, Injectable, SetMetadata, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { verifyJwt, type JwtClaims } from '../../common/jwt';

export const ROLES_KEY = 'sozo:roles';
/** Роли на уровне API — проверка на каждом эндпоинте (ТЗ 14) */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<string[] | undefined>(ROLES_KEY, [
      ctx.getHandler(),
      ctx.getClass(),
    ]);
    const req = ctx.switchToHttp().getRequest<{ headers: Record<string, string>; auth?: JwtClaims }>();
    const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const claims = token ? verifyJwt(token) : null;
    if (!claims) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    req.auth = claims;
    if (required?.length && !required.some((r) => claims.roles.includes(r))) {
      throw new ForbiddenException({ code: 'ROLE_FORBIDDEN', required });
    }
    return true;
  }
}
