import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import { verifyJwt, type JwtClaims } from '../../common/jwt';
import { MastersService, type MasterRec } from '../masters/masters.module';

export interface MasterRequest {
  headers: Record<string, string>;
  auth?: JwtClaims;
  master?: MasterRec;
}

/**
 * Аутентификация приложения мастера (PRD-02 §2).
 * Токен → телефон → карточка мастера.
 *
 * Доступ к заявкам — решение администратора, а не результат прохождения
 * воронки: в приложении онбординга больше нет, и мастер, у которого доступ
 * ещё не открыт или закрыт, должен получить причину и телефон, а не пустой
 * экран и не анкету. Формулировки здесь видит мастер дословно.
 */
@Injectable()
export class MasterGuard implements CanActivate {
  constructor(private readonly masters: MastersService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<MasterRequest>();
    const token = req.headers['authorization']?.replace(/^Bearer\s+/i, '');
    const claims = token ? verifyJwt(token) : null;
    if (!claims) throw new UnauthorizedException({ code: 'TOKEN_INVALID' });
    req.auth = claims;

    const master = this.masters.list().find((m) => m.phone === claims.phone);
    if (!master) {
      throw new ForbiddenException({
        code: 'NOT_A_MASTER',
        message: 'Этот номер не привязан к карточке мастера. Обратитесь к диспетчеру.',
      });
    }
    if (master.status === 'blocked') {
      throw new ForbiddenException({
        code: 'MASTER_BLOCKED',
        message: 'Доступ к заявкам закрыт администратором. Свяжитесь с диспетчером.',
      });
    }
    if (master.status === 'candidate' || master.status === 'checking') {
      throw new ForbiddenException({
        code: 'ACCESS_NOT_OPEN',
        message: 'Доступ к заявкам ещё не открыт. Его открывает администратор — позвоните диспетчеру.',
      });
    }
    req.master = master;
    return true;
  }
}
