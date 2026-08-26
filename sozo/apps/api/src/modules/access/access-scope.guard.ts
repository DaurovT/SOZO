import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtClaims } from '../../common/jwt';
import { BuildingsService } from '../buildings/buildings.service';

/**
 * Доступ к нарядам-допускам, пропускам и отключениям ресурсов.
 *
 * В `access.controller.ts` не было ни одной проверки роли или принадлежности,
 * а лежит там ровно то, что открывает двери и перекрывает воду:
 * `POST /v1/passes` выписывал пропуск в любой дом и возвращал `qrToken` и
 * `fallbackCode`, по которым пускает охрана; `POST /buildings/:id/shutdowns`
 * с последующим `/start` отключал воду, отопление или лифт в любом доме.
 *
 * Как и в контуре «Дом», ролями это не закрывается: персонал оператора ходит
 * с ролью `client`. Проверяется принадлежность — свой объект или своя работа.
 * Мастер сюда допущен: наряд выписывает он, и «мастер» — не самоназначаемая
 * роль, она выводится из реестра мастеров.
 */
@Injectable()
export class AccessScopeGuard implements CanActivate {
  constructor(private readonly buildings: BuildingsService) {}

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{
      params: Record<string, string>;
      body?: Record<string, unknown>;
      auth?: JwtClaims;
    }>();
    const claims = req.auth;
    if (!claims) throw new ForbiddenException({ code: 'TOKEN_INVALID' });
    const roles = claims.roles ?? [];
    if (roles.some((r) => r === 'admin' || r === 'dispatcher' || r === 'master')) return true;

    const buildingId = req.params?.buildingId ?? (typeof req.body?.buildingId === 'string' ? req.body.buildingId : undefined);
    if (buildingId) {
      const b = this.buildings.listBuildings('t0').find((x) => x.id === buildingId);
      if (b?.operatorOrgId && this.buildings.isOperatorStaff('t0', claims.phone, b.operatorOrgId)) return true;
      throw new ForbiddenException({
        code: 'BUILDING_FORBIDDEN',
        message: 'Объект обслуживает другая эксплуатирующая организация',
      });
    }
    if (this.buildings.staffOfAnyBuilding('t0', claims.phone)) return true;
    throw new ForbiddenException({
      code: 'ACCESS_FORBIDDEN',
      message: 'Наряды-допуски и пропуска ведут диспетчерская, служба объекта и мастер на заявке',
    });
  }
}
