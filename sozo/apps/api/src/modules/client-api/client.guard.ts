import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyJwt, type JwtClaims } from '../../common/jwt';
import { CrmService, type LocationRec, type OrganizationRec, type RepresentativeRec } from '../crm/crm.service';

export interface ClientScope {
  phone: string;
  /** Точки, где этот номер — ответственный. Всё остальное для него не существует */
  sites: Array<{ org: OrganizationRec; loc: LocationRec; rep: RepresentativeRec }>;
}

export interface ClientRequest {
  headers: Record<string, string>;
  auth?: JwtClaims;
  client?: ClientScope;
}

/**
 * Аутентификация клиентского приложения B2B.
 *
 * Прав нет «вообще»: доступ выдаёт не роль в JWT, а факт, что номер вписан
 * ответственным в карточку точки (A-09). Уволился человек — его убирают из точки,
 * и приложение перестаёт что-либо показывать без правки ролей и токенов.
 */
@Injectable()
export class ClientGuard implements CanActivate {
  constructor(private readonly crm: CrmService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<ClientRequest>();
    const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const claims = token ? verifyJwt(token) : null;
    if (!claims) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    req.auth = claims;

    const sites = this.crm.locationsForPhone(claims.phone);
    if (sites.length === 0) {
      throw new ForbiddenException({
        code: 'NOT_A_SITE_REPRESENTATIVE',
        message: 'Этот номер не закреплён ни за одной точкой. Обратитесь к своему менеджеру SOZO.',
      });
    }
    const suspended = sites.every((s) => s.org.status !== 'active');
    if (suspended) {
      throw new ForbiddenException({
        code: 'ORG_SUSPENDED',
        message: 'Обслуживание организации приостановлено — операции недоступны.',
      });
    }
    req.client = { phone: claims.phone, sites };
    return true;
  }
}
