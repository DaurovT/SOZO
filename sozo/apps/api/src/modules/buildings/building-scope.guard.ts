import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { JwtClaims } from '../../common/jwt';
import { BuildingsService } from './buildings.service';

/**
 * Доступ к контуру «Дом».
 *
 * В `buildings.controller.ts` не было ни одного `@Roles`, и это не мелочь:
 * цепочка `GET /buildings → /units → /residents` возвращала ФИО и телефон
 * жителя любому, у кого есть валидный токен, а токен получает кто угодно с
 * узбекским номером. Там же без всякой проверки лежали создание дома,
 * вписывание себя жителем чужой квартиры, назначение персонала, активация
 * объекта и установка ставки сервисного сбора.
 *
 * Ролями это не закрывается: сотрудник эксплуатирующей организации в JWT
 * ходит с ролью `client` — в этом контуре человек существует как роль на
 * объекте, отдельного реестра пользователей оператора нет. Поэтому проверка
 * идёт по принадлежности: свой объект — можно, чужой — нет.
 */
@Injectable()
export class BuildingScopeGuard implements CanActivate {
  constructor(private readonly buildings: BuildingsService) {}

  /**
   * Справочники: подписи ресурсов, типы зон, категории замечаний, разбор
   * адреса и витрина спроса. Ничего личного в них нет, а нужны они всем —
   * от приложения жителя до кабинета оператора.
   */
  private static readonly DICTIONARIES = new Set([
    'resource-labels',
    'zone-types',
    'observation-categories',
    'resolve',
    'demand',
  ]);

  canActivate(ctx: ExecutionContext): boolean {
    const req = ctx.switchToHttp().getRequest<{ params: Record<string, string>; route?: { path?: string }; url: string; auth?: JwtClaims }>();
    const claims = req.auth;
    if (!claims) throw new ForbiddenException({ code: 'TOKEN_INVALID' });
    // Платформа видит все объекты: это работа диспетчера и администратора
    if (claims.roles?.some((r) => r === 'admin' || r === 'dispatcher')) return true;

    const id = req.params?.id;
    if (id && BuildingScopeGuard.DICTIONARIES.has(id)) return true;

    const buildingId = id ?? this.buildingOfUnit(req.params?.unitId);
    if (buildingId) {
      const b = this.buildings.listBuildings('t0').find((x) => x.id === buildingId);
      if (b?.operatorOrgId && this.buildings.isOperatorStaff('t0', claims.phone, b.operatorOrgId)) return true;
      throw new ForbiddenException({
        code: 'BUILDING_FORBIDDEN',
        message: 'Объект обслуживает другая эксплуатирующая организация',
      });
    }

    /**
     * Маршрут без объекта в адресе — заявка на подключение, очередь заявок,
     * решение по замечанию. Объект по вложенному идентификатору здесь не
     * восстанавливается, поэтому требование мягче и честнее названо: человек
     * должен состоять в штате хотя бы одного объекта. Клиентский токен без
     * штата сюда уже не проходит.
     */
    if (this.buildings.staffOfAnyBuilding('t0', claims.phone)) return true;
    throw new ForbiddenException({
      code: 'BUILDING_FORBIDDEN',
      message: 'Контур «Дом» доступен персоналу эксплуатирующей организации и диспетчерской',
    });
  }

  private buildingOfUnit(unitId?: string): string | undefined {
    if (!unitId) return undefined;
    try {
      return this.buildings.unitById('t0', unitId)?.buildingId ?? undefined;
    } catch {
      return undefined;
    }
  }
}
